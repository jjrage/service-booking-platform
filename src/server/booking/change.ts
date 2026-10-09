import "server-only";

import { findWindow } from "@/domain/availability";
import {
  cancellationFee,
  settleFee,
  type CancellationFee,
  type CancellationReason,
} from "@/domain/cancellation";
import { cancellationRulesSchema } from "@/domain/rules";
import { addMinutes, toLocal, type LocalDate, type LocalTime } from "@/domain/time";

import { activeCrewIds, loadCatalog } from "../catalog";
import { nullable } from "../db/args";
import { adminDb } from "../db/admin";
import { CommandError, ensureOk, unwrap } from "../db/errors";
import { parseRange, toRange } from "../db/ranges";
import { chargeSavedCard, refundPayment } from "../payments/service";
import { loadBusy } from "./availability";

/**
 * Cancelling and rescheduling a booking, for every surface: the client portal, the admin console and the
 * AI assistant. The fee comes from cancellationFee() with the rules the booking was made under, so the
 * preview a client sees is exactly what is charged. The database re-checks who may change the booking.
 */

export type Actor =
  | { kind: "client" | "ai"; userId: string }
  | { kind: "staff"; userId: string }
  | { kind: "system"; userId: null };

export type ChangePreview = CancellationFee & {
  paidCents: number;
  refundCents: number;
  chargeCents: number;
  currency: string;
};

async function loadBooking(bookingId: string) {
  return unwrap(
    await adminDb()
      .from("bookings")
      .select(
        "id, number, tenant_id, client_id, crew_id, status, arrival_window, duration_minutes, total_cents, currency, cancellation_version_id, tenant:tenants!inner(slug)",
      )
      .eq("id", bookingId)
      .single(),
    "load booking",
  );
}

async function cancellationRulesOf(versionId: string) {
  const row = unwrap(
    await adminDb().from("rule_versions").select("rules").eq("id", versionId).single(),
    "load cancellation rules",
  );
  return cancellationRulesSchema.parse(row.rules);
}

/** The deposit and anything else already paid for the visit, net of refunds, with the deposit payment. */
async function paidFor(bookingId: string) {
  const payments = unwrap(
    await adminDb()
      .from("payments")
      .select("id, purpose, amount_cents, refunds(amount_cents, status)")
      .eq("booking_id", bookingId)
      .eq("status", "succeeded")
      .in("purpose", ["deposit", "balance"]),
    "load payments",
  );
  const net = (p: (typeof payments)[number]) =>
    p.amount_cents -
    p.refunds.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amount_cents, 0);
  return {
    paidCents: payments.reduce((sum, p) => sum + net(p), 0),
    deposit: payments.find((p) => p.purpose === "deposit") ?? null,
    depositNet: (() => {
      const d = payments.find((p) => p.purpose === "deposit");
      return d ? net(d) : 0;
    })(),
  };
}

export async function previewChange(
  bookingId: string,
  reason: CancellationReason,
  now = new Date().toISOString(),
): Promise<ChangePreview> {
  const booking = await loadBooking(bookingId);
  const rules = await cancellationRulesOf(booking.cancellation_version_id);
  const window = parseRange(booking.arrival_window);
  const fee = cancellationFee(
    rules,
    {
      totalCents: booking.total_cents,
      arrivalStart: window.start,
      currency: booking.currency,
    },
    reason,
    now,
  );
  const { paidCents, depositNet } = await paidFor(bookingId);
  // A reschedule keeps the deposit on the booking; the fee is charged on its own.
  const settled =
    reason === "reschedule"
      ? { refundCents: 0, chargeCents: fee.feeCents }
      : settleFee(fee.feeCents, depositNet);
  return {
    ...fee,
    paidCents,
    refundCents: settled.refundCents,
    chargeCents: settled.chargeCents,
    currency: booking.currency,
  };
}

export type CancelResult = ChangePreview & {
  chargeStatus: "succeeded" | "failed" | "requires_action" | "none";
};

/**
 * Cancels a visit and settles the money: the fee is kept from the deposit, the rest of the deposit is
 * refunded, and any part of the fee the deposit does not cover is charged to the saved card. Staff may
 * waive the fee.
 */
export async function cancelBooking(
  bookingId: string,
  actor: Actor,
  options: { reason: string; waiveFee?: boolean },
): Promise<CancelResult> {
  const preview = await previewChange(bookingId, "cancel");
  const feeCents = actor.kind === "staff" && options.waiveFee ? 0 : preview.feeCents;

  ensureOk(
    await adminDb().rpc("cmd_cancel_booking", {
      p_booking_id: bookingId,
      p_actor: nullable<string>(actor.userId),
      p_actor_kind: actor.kind,
      p_reason: options.reason,
      p_fee_cents: feeCents,
    }),
    "cancel booking",
  );

  const { deposit, depositNet } = await paidFor(bookingId);
  const { refundCents, chargeCents } = settleFee(feeCents, depositNet);
  if (refundCents > 0 && deposit) {
    await refundPayment({
      paymentId: deposit.id,
      amountCents: refundCents,
      reason: feeCents > 0 ? "Deposit minus the cancellation fee" : "Cancelled in time",
      actor: { userId: null, kind: "system" },
    });
  }
  let chargeStatus: CancelResult["chargeStatus"] = "none";
  if (chargeCents > 0) {
    const booking = await loadBooking(bookingId);
    const charge = await chargeSavedCard({
      bookingId,
      purpose: "cancellation_fee",
      amountCents: chargeCents,
      description: `Late cancellation fee, booking #${booking.number}`,
    });
    chargeStatus =
      charge.status === "succeeded"
        ? "succeeded"
        : charge.status === "requires_action"
          ? "requires_action"
          : "failed";
  }
  return { ...preview, feeCents, refundCents, chargeCents, chargeStatus };
}

export type RescheduleResult =
  | { ok: true; fee: ChangePreview; chargeStatus: CancelResult["chargeStatus"] }
  | { ok: false; reason: "taken" | "unavailable"; message: string };

/**
 * Moves a visit to another arrival window, keeping its crew when free. The booking's own time does not count
 * against it, so moving within a crew's day works. A late reschedule is charged like a late cancellation.
 */
export async function rescheduleBooking(
  bookingId: string,
  actor: Actor,
  target: { date: LocalDate; localStart: LocalTime },
  options: { waiveFee?: boolean } = {},
): Promise<RescheduleResult> {
  const booking = await loadBooking(bookingId);
  const catalog = await loadCatalog(booking.tenant.slug);
  if (!catalog) throw new CommandError("not_found", "Unknown business");

  const [crewIds, busy] = await Promise.all([
    activeCrewIds(booking.tenant_id),
    loadBusy(catalog, target.date, target.date, {
      excludeBookingId: bookingId,
    }),
  ]);
  const { day, window } = findWindow(
    {
      rules: catalog.schedule.rules,
      timeZone: catalog.tenant.timezone,
      now: new Date().toISOString(),
      durationMinutes: booking.duration_minutes,
      crewIds,
      busy,
      preferredCrewId: booking.crew_id,
      ignoreBookingHorizon: actor.kind === "staff",
    },
    target.date,
    target.localStart,
  );
  if (!window || day.status !== "open" || window.status !== "available") {
    return {
      ok: false,
      reason: window?.status === "full" ? "taken" : "unavailable",
      message:
        window?.status === "full"
          ? "That window is fully booked."
          : "That window cannot be booked.",
    };
  }

  const fee = await previewChange(bookingId, "reschedule");
  const feeCents = actor.kind === "staff" && options.waiveFee ? 0 : fee.feeCents;
  const result = await adminDb().rpc("cmd_reschedule_booking", {
    p_booking_id: bookingId,
    p_actor: nullable<string>(actor.userId),
    p_actor_kind: actor.kind,
    p_arrival_window: toRange(window.start, window.end),
    p_busy: toRange(window.busyStart, window.busyEnd),
    p_crew_ids: window.freeCrewIds,
    p_fee_cents: feeCents,
  });
  if (result.error?.code === "23P01") {
    return {
      ok: false,
      reason: "taken",
      message: "Someone took that window a moment ago.",
    };
  }
  ensureOk(result, "reschedule booking");

  let chargeStatus: CancelResult["chargeStatus"] = "none";
  if (feeCents > 0) {
    const charge = await chargeSavedCard({
      bookingId,
      purpose: "cancellation_fee",
      amountCents: feeCents,
      description: `Late reschedule fee, booking #${booking.number}`,
    });
    chargeStatus =
      charge.status === "succeeded"
        ? "succeeded"
        : charge.status === "requires_action"
          ? "requires_action"
          : "failed";
  }
  return {
    ok: true,
    fee: { ...fee, feeCents, chargeCents: feeCents },
    chargeStatus,
  };
}

/** The local date of a booking's arrival, e.g. to start a reschedule picker on that week. */
export function localDateOf(arrivalWindow: string, timeZone: string): LocalDate {
  return toLocal(parseRange(arrivalWindow).start, timeZone).date;
}

/** The instant after which a plan's visits can be cancelled for free (for pausing or ending a plan). */
export async function freeCancellationBoundary(tenantSlug: string): Promise<string> {
  const catalog = await loadCatalog(tenantSlug);
  if (!catalog) throw new CommandError("not_found", "Unknown business");
  return addMinutes(new Date().toISOString(), catalog.cancellation.rules.free_before_hours * 60);
}
