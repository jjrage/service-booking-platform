import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { quote, type QuoteRequest } from "@/domain/quote";
import { addDays, addMinutes, toLocal } from "@/domain/time";
import { cancelBooking, previewChange, rescheduleBooking } from "@/server/booking/change";
import { quoteSnapshot } from "@/server/booking/place";
import { loadCatalog, type Catalog } from "@/server/catalog";
import { pausePlan } from "@/server/plans";
import { afterPaymentEvent } from "@/server/payments/after-event";
import { completeSimulatedCheckout, startBookingCheckout } from "@/server/payments/service";

import { createTestTenant } from "./test-tenant";

/**
 * The portal's money rules end to end: the fee a client is shown before cancelling or rescheduling is the
 * fee they are charged, a plan starts itself when its first visit is confirmed, and pausing a plan cancels
 * only the visits that can still be cancelled for free.
 */

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;
const system = { kind: "system" as const, userId: null };
const home = { bedrooms: 3, fullBaths: 2, halfBaths: 1, sqft: 2100 };

/** A confirmed booking whose arrival window starts `hoursAhead` from now, paid through the simulator. */
async function paidBooking(n: number, hoursAhead: number, request: QuoteRequest) {
  const priced = quote(catalog.pricing.rules, request);
  if (!priced.ok) throw new Error(priced.error.message);
  const q = priced.quote;
  const start = new Date(Date.now() + hoursAhead * 3600_000);
  start.setUTCMinutes(0, 0, 0);
  const windowStart = start.toISOString();
  const windowEnd = addMinutes(windowStart, 60);
  const busyEnd = addMinutes(windowEnd, q.firstVisit.durationMinutes + 30);

  const { data, error } = await tenant.admin.rpc("cmd_create_booking", {
    p_tenant_id: tenant.tenantId,
    p_actor: null as unknown as string,
    p_actor_kind: "guest",
    p_source: "web",
    p_status: "pending_payment",
    p_client: {
      full_name: `Portal Client ${n}`,
      email: `portal${n}@it.example`,
    },
    p_property: {
      address_line1: `${n} Portal Way`,
      city: "Raleigh",
      state: "NC",
      zip: request.zip,
      bedrooms: home.bedrooms,
      full_baths: home.fullBaths,
      half_baths: home.halfBaths,
      sqft: home.sqft,
    },
    p_service_id: catalog.services.find((s) => s.code === q.firstVisit.service)!.id,
    p_arrival_window: `[${windowStart},${windowEnd})`,
    p_busy: `[${windowStart},${busyEnd})`,
    p_duration_minutes: q.firstVisit.durationMinutes,
    p_quote: quoteSnapshot(catalog, q),
    p_total_cents: q.firstVisit.totalCents,
    p_deposit_cents: q.depositCents,
    p_pricing_version_id: catalog.pricing.id,
    p_cancellation_version_id: catalog.cancellation.id,
    p_crew_ids: tenant.crewIds,
    p_payment_due_by: addMinutes(new Date().toISOString(), 30),
  });
  if (error) throw error;
  const bookingId = data[0]!.booking_id;
  await startBookingCheckout(bookingId);
  const paid = await completeSimulatedCheckout(bookingId, "visa");
  await afterPaymentEvent(paid);
  return { bookingId, quote: q };
}

async function payments(bookingId: string) {
  const { data } = await tenant.admin
    .from("payments")
    .select("purpose, amount_cents, status, refunds(amount_cents)")
    .eq("booking_id", bookingId)
    .order("created_at");
  return data ?? [];
}

beforeAll(async () => {
  tenant = await createTestTenant({ crews: 2 });
  catalog = (await loadCatalog(tenant.slug))!;
});

afterAll(async () => {
  await tenant?.cleanup();
});

describe("cancelling 30 hours ahead", () => {
  it("keeps the $40 fee from the deposit and refunds the rest, as previewed", async () => {
    const { bookingId } = await paidBooking(1, 30, {
      service: "standard",
      home,
      zip: "27609",
    });

    const preview = await previewChange(bookingId, "cancel");
    expect(preview).toMatchObject({
      tier: "flat",
      feeCents: 4000,
      refundCents: 2375,
      chargeCents: 0,
    });

    const result = await cancelBooking(bookingId, system, { reason: "Test" });
    expect([result.feeCents, result.refundCents, result.chargeCents]).toEqual([4000, 2375, 0]);

    const rows = await payments(bookingId);
    expect(rows.find((p) => p.purpose === "deposit")?.refunds).toEqual([{ amount_cents: 2375 }]);
  });

  it("charges the $40 to the saved card when nothing was paid up front (a plan visit)", async () => {
    const { bookingId } = await paidBooking(2, 30, {
      service: "standard",
      home,
      zip: "27609",
      frequency: "weekly",
      recentlyCleaned: true,
    });

    const preview = await previewChange(bookingId, "cancel");
    expect(preview).toMatchObject({
      feeCents: 4000,
      refundCents: 0,
      chargeCents: 4000,
    });

    const result = await cancelBooking(bookingId, system, { reason: "Test" });
    expect(result.chargeStatus).toBe("succeeded");
    expect((await payments(bookingId)).filter((p) => p.purpose === "cancellation_fee")).toEqual([
      {
        purpose: "cancellation_fee",
        amount_cents: 4000,
        status: "succeeded",
        refunds: [],
      },
    ]);
  });
});

describe("recurring plans", () => {
  it("starts the plan when its first visit is confirmed and schedules the next visits", async () => {
    const { bookingId, quote: q } = await paidBooking(3, 24 * 4, {
      service: "standard",
      home,
      zip: "27609",
      frequency: "weekly",
      recentlyCleaned: true,
    });

    const { data: booking } = await tenant.admin
      .from("bookings")
      .select("recurring_plan_id, occurrence_date, arrival_window")
      .eq("id", bookingId)
      .single();
    expect(booking?.recurring_plan_id).toBeTruthy();

    const { data: plan } = await tenant.admin
      .from("recurring_plans")
      .select("frequency, price_cents, status, preferred_crew_id")
      .eq("id", booking!.recurring_plan_id!)
      .single();
    expect(plan).toMatchObject({
      frequency: "weekly",
      price_cents: q.recurringVisit!.totalCents,
      status: "active",
    });

    const { count } = await tenant.admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("recurring_plan_id", booking!.recurring_plan_id!);
    // The first visit plus weekly visits for the 60-day horizon (some may land on closed dates).
    expect(count).toBeGreaterThanOrEqual(7);

    // Pausing for three weeks cancels the visits in that period that are more than 48 hours away.
    const today = toLocal(new Date().toISOString(), catalog.tenant.timezone).date;
    const cancelled = await pausePlan(booking!.recurring_plan_id!, system, addDays(today, 21));
    expect(cancelled).toBeGreaterThanOrEqual(2);
  });
});

describe("rescheduling 30 hours ahead", () => {
  it("moves the visit and charges the previewed $40", async () => {
    const { bookingId } = await paidBooking(4, 30, {
      service: "standard",
      home,
      zip: "27609",
    });
    const preview = await previewChange(bookingId, "reschedule");
    expect(preview.feeCents).toBe(4000);

    // Find an open weekday 10+ days out for the new window.
    let date = addDays(toLocal(new Date().toISOString(), catalog.tenant.timezone).date, 10);
    while (["sun"].includes(toLocal(`${date}T16:00:00Z`, catalog.tenant.timezone).weekday)) {
      date = addDays(date, 1);
    }
    const result = await rescheduleBooking(bookingId, system, {
      date,
      localStart: "08:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chargeStatus).toBe("succeeded");

    const fees = (await payments(bookingId)).filter((p) => p.purpose === "cancellation_fee");
    expect(fees.map((p) => p.amount_cents)).toEqual([4000]);
  });
});
