"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import { ruleSchemas, type RuleKind } from "@/domain/rules";
import { toInstant, addDays } from "@/domain/time";
import { requireStaff } from "@/server/auth/viewer";
import { toChoices, windowsFor, type DayChoice } from "@/server/booking/availability";
import {
  cancelBooking,
  previewChange,
  rescheduleBooking,
  type ChangePreview,
} from "@/server/booking/change";
import { completeJob, markNoAccess } from "@/server/booking/jobs";
import { catalogTag, loadCatalog } from "@/server/catalog";
import { adminDb } from "@/server/db/admin";
import { CommandError, ensureOk, unwrap } from "@/server/db/errors";
import { toRange } from "@/server/db/ranges";
import { refundPayment } from "@/server/payments/service";

/**
 * Admin console actions. Each one checks the staff session; the cmd_* functions check the role again in the
 * database (owner or dispatcher of the booking's own business), so a forged request for another tenant's
 * booking fails there too.
 */

type Result = { ok: true; message?: string } | { ok: false; message: string };
const id = z.uuid();

function failure(error: unknown): Result {
  if (error instanceof CommandError) return { ok: false, message: error.message };
  throw error;
}

export async function reassignAction(bookingId: string, crewId: string): Promise<Result> {
  const viewer = await requireStaff();
  const result = await adminDb().rpc("cmd_reassign_booking", {
    p_booking_id: id.parse(bookingId),
    p_actor: viewer.userId,
    p_crew_id: id.parse(crewId),
  });
  if (result.error?.code === "23P01") {
    const { data: crew } = await adminDb().from("crews").select("name").eq("id", crewId).single();
    return {
      ok: false,
      message: `${crew?.name ?? "That crew"} is busy at that time. The database refused the overlap (23P01).`,
    };
  }
  try {
    ensureOk(result, "reassign booking");
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, message: "Reassigned." };
}

export async function staffPreviewAction(
  bookingId: string,
  reason: "cancel" | "reschedule",
): Promise<ChangePreview> {
  await requireStaff();
  return previewChange(id.parse(bookingId), reason);
}

export async function staffWindowsAction(bookingId: string, from: string): Promise<DayChoice[]> {
  const viewer = await requireStaff();
  const { data: booking } = await adminDb()
    .from("bookings")
    .select("id, tenant_id, duration_minutes, crew_id")
    .eq("id", id.parse(bookingId))
    .eq("tenant_id", viewer.staff.tenantId)
    .single();
  if (!booking) return [];
  const catalog = await loadCatalog(viewer.staff.slug);
  if (!catalog) return [];
  const start = z.iso.date().parse(from);
  const days = await windowsFor(catalog, {
    from: start,
    to: addDays(start, 13),
    durationMinutes: booking.duration_minutes,
    preferredCrewId: booking.crew_id,
    excludeBookingId: booking.id,
    ignoreBookingHorizon: true,
  });
  return toChoices(days);
}

export async function staffRescheduleAction(
  bookingId: string,
  date: string,
  localStart: string,
  waiveFee: boolean,
): Promise<Result> {
  const viewer = await requireStaff();
  try {
    const result = await rescheduleBooking(
      id.parse(bookingId),
      { kind: "staff", userId: viewer.userId },
      {
        date: z.iso.date().parse(date),
        localStart: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .parse(localStart),
      },
      { waiveFee },
    );
    if (!result.ok) return { ok: false, message: result.message };
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, message: "Moved." };
}

export async function staffCancelAction(
  bookingId: string,
  waiveFee: boolean,
  reason: string,
): Promise<Result> {
  const viewer = await requireStaff();
  try {
    await cancelBooking(
      id.parse(bookingId),
      { kind: "staff", userId: viewer.userId },
      {
        reason: reason.trim() || "Cancelled by the office",
        waiveFee,
      },
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, message: "Cancelled." };
}

export async function staffCompleteAction(bookingId: string): Promise<Result> {
  const viewer = await requireStaff();
  try {
    const { charge } = await completeJob({
      bookingId: id.parse(bookingId),
      actorUserId: viewer.userId,
      checklist: [],
      notes: "Marked done by the office",
      photoPaths: [],
    });
    refresh();
    return charge.status === "succeeded"
      ? { ok: true, message: "Completed and charged." }
      : {
          ok: true,
          message: `Completed, but the charge ${charge.status}: ${charge.failureMessage ?? ""}`,
        };
  } catch (error) {
    return failure(error);
  }
}

export async function staffNoAccessAction(bookingId: string, note: string): Promise<Result> {
  const viewer = await requireStaff();
  try {
    await markNoAccess({ bookingId: id.parse(bookingId), actorUserId: viewer.userId, note });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, message: "Marked as no access; the lockout fee was applied." };
}

export async function refundAction(
  paymentId: string,
  amountCents: number,
  reason: string,
): Promise<Result> {
  const viewer = await requireStaff();
  const { data: payment } = await adminDb()
    .from("payments")
    .select("id")
    .eq("id", id.parse(paymentId))
    .eq("tenant_id", viewer.staff.tenantId)
    .maybeSingle();
  if (!payment) return { ok: false, message: "Payment not found." };
  try {
    await refundPayment({
      paymentId: payment.id,
      amountCents: z.int().positive().parse(amountCents),
      reason: reason.trim() || "Refund",
      actor: { userId: viewer.userId, kind: "staff" },
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, message: "Refunded." };
}

export async function addNoteAction(clientId: string, body: string): Promise<Result> {
  const viewer = await requireStaff();
  try {
    unwrap(
      await adminDb().rpc("cmd_add_client_note", {
        p_client_id: id.parse(clientId),
        p_actor: viewer.userId,
        p_body: body,
      }),
      "add note",
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}

export async function resolveAlertAction(alertId: string): Promise<Result> {
  const viewer = await requireStaff();
  try {
    ensureOk(
      await adminDb().rpc("cmd_resolve_alert", {
        p_alert_id: id.parse(alertId),
        p_actor: viewer.userId,
      }),
      "resolve alert",
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}

export async function addTimeOffAction(
  crewId: string,
  date: string,
  days: number,
  note: string,
): Promise<Result> {
  const viewer = await requireStaff();
  const start = z.iso.date().parse(date);
  const length = z.int().min(1).max(30).parse(days);
  const result = await adminDb().rpc("cmd_add_time_off", {
    p_tenant_id: viewer.staff.tenantId,
    p_actor: viewer.userId,
    p_crew_id: id.parse(crewId),
    p_period: toRange(
      toInstant(start, "00:00", viewer.staff.timezone),
      toInstant(addDays(start, length), "00:00", viewer.staff.timezone),
    ),
    p_note: note,
  });
  if (result.error?.code === "23P01") {
    return { ok: false, message: "The crew has jobs on those days. Move them first." };
  }
  try {
    ensureOk(result, "add time off");
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}

export async function removeTimeOffAction(allocationId: string): Promise<Result> {
  const viewer = await requireStaff();
  try {
    ensureOk(
      await adminDb().rpc("cmd_remove_time_off", {
        p_allocation_id: id.parse(allocationId),
        p_actor: viewer.userId,
      }),
      "remove time off",
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}

/**
 * Publishes a new version of the business's rules. Bookings already made keep the version they were priced
 * with (their quote snapshot); new quotes use the new one as soon as the catalog cache is refreshed.
 */
export async function publishRulesAction(
  kind: RuleKind,
  rules: unknown,
  note: string,
): Promise<Result & { version?: number; issues?: string[] }> {
  const viewer = await requireStaff();
  if (viewer.staff.role !== "owner") return { ok: false, message: "Only the owner changes rules." };
  const parsed = ruleSchemas[kind].safeParse(rules);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Some values are not valid.",
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || kind}: ${i.message}`),
    };
  }
  try {
    const [row] = unwrap(
      await adminDb().rpc("cmd_publish_rules", {
        p_tenant_id: viewer.staff.tenantId,
        p_actor: viewer.userId,
        p_kind: kind,
        p_rules: parsed.data,
        p_note: note.trim() || `Updated ${kind} rules`,
      }),
      "publish rules",
    );
    updateTag(catalogTag(viewer.staff.slug));
    refresh();
    return { ok: true, version: row?.version, message: `Version ${row?.version} is live.` };
  } catch (error) {
    return failure(error);
  }
}
