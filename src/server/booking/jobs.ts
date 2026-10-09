import "server-only";

import { cancellationFee, settleFee } from "@/domain/cancellation";
import { cancellationRulesSchema } from "@/domain/rules";

import { adminDb } from "../db/admin";
import { ensureOk, unwrap } from "../db/errors";
import { parseRange } from "../db/ranges";
import { chargeSavedCard, refundPayment, type ChargeResult } from "../payments/service";

/**
 * The end of a visit, from the crew app or the admin console: done (report, checklist, photos, then the
 * balance is charged to the saved card) or no access (the lockout fee from the booking's own rules, kept
 * from the deposit first). The database checks that the actor is on the booking's crew or is staff.
 */

async function loadBooking(bookingId: string) {
  return unwrap(
    await adminDb()
      .from("bookings")
      .select("id, number, total_cents, currency, arrival_window, cancellation_version_id")
      .eq("id", bookingId)
      .single(),
    "load booking",
  );
}

async function netPaid(bookingId: string) {
  const rows = unwrap(
    await adminDb()
      .from("payments")
      .select("id, purpose, amount_cents, refunds(amount_cents, status)")
      .eq("booking_id", bookingId)
      .eq("status", "succeeded"),
    "load payments",
  );
  const net = (p: (typeof rows)[number]) =>
    p.amount_cents -
    p.refunds.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amount_cents, 0);
  const deposit = rows.find((p) => p.purpose === "deposit") ?? null;
  return {
    paid: rows.reduce((sum, p) => sum + net(p), 0),
    deposit,
    depositNet: deposit ? net(deposit) : 0,
  };
}

export async function completeJob(input: {
  bookingId: string;
  actorUserId: string;
  checklist: { item: string; done: boolean }[];
  notes: string;
  photoPaths: string[];
}): Promise<{ charge: ChargeResult }> {
  ensureOk(
    await adminDb().rpc("cmd_complete_job", {
      p_booking_id: input.bookingId,
      p_actor: input.actorUserId,
      p_checklist: input.checklist,
      p_notes: input.notes,
      p_photo_paths: input.photoPaths,
    }),
    "complete job",
  );

  const booking = await loadBooking(input.bookingId);
  const { paid } = await netPaid(input.bookingId);
  const charge = await chargeSavedCard({
    bookingId: input.bookingId,
    purpose: "balance",
    amountCents: Math.max(0, booking.total_cents - paid),
    description: `Cleaning visit #${booking.number}`,
  });
  return { charge };
}

export async function markNoAccess(input: {
  bookingId: string;
  actorUserId: string;
  note: string;
}): Promise<{ feeCents: number; charge: ChargeResult | null }> {
  const booking = await loadBooking(input.bookingId);
  const rules = cancellationRulesSchema.parse(
    unwrap(
      await adminDb()
        .from("rule_versions")
        .select("rules")
        .eq("id", booking.cancellation_version_id)
        .single(),
      "load cancellation rules",
    ).rules,
  );
  const fee = cancellationFee(
    rules,
    {
      totalCents: booking.total_cents,
      arrivalStart: parseRange(booking.arrival_window).start,
      currency: booking.currency,
    },
    "no_access",
    new Date().toISOString(),
  );

  ensureOk(
    await adminDb().rpc("cmd_mark_no_access", {
      p_booking_id: input.bookingId,
      p_actor: input.actorUserId,
      p_note: input.note,
      p_fee_cents: fee.feeCents,
    }),
    "mark no access",
  );

  const { deposit, depositNet } = await netPaid(input.bookingId);
  const { refundCents, chargeCents } = settleFee(fee.feeCents, depositNet);
  if (refundCents > 0 && deposit) {
    await refundPayment({
      paymentId: deposit.id,
      amountCents: refundCents,
      reason: "Deposit minus the lockout fee",
      actor: { userId: null, kind: "system" },
    });
  }
  const charge =
    chargeCents > 0
      ? await chargeSavedCard({
          bookingId: input.bookingId,
          purpose: "no_access_fee",
          amountCents: chargeCents,
          description: `Lockout fee, visit #${booking.number}`,
        })
      : null;
  return { feeCents: fee.feeCents, charge };
}
