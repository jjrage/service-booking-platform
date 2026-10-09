import "server-only";

import { adminDb } from "../db/admin";
import { materializePlans } from "../plans";
import type { AppliedEvent } from "./service";

/**
 * Follow-up work after a provider event was applied. When the first visit of a plan is confirmed, the
 * database has just started the plan; its next visits are created right away instead of waiting for the
 * nightly job, so the client sees them in the portal immediately.
 */
export async function afterPaymentEvent(result: AppliedEvent): Promise<void> {
  if (!result.applied || result.bookingStatus !== "confirmed" || !result.bookingId) return;
  const { data } = await adminDb()
    .from("bookings")
    .select("tenant_id, recurring_plan_id, occurrence_date")
    .eq("id", result.bookingId)
    .single();
  if (!data?.recurring_plan_id) return;
  try {
    await materializePlans(data.tenant_id, { planId: data.recurring_plan_id });
  } catch (error) {
    // The scheduled job retries; the booking itself is already confirmed.
    console.error("materialize plan after confirmation", error);
  }
}
