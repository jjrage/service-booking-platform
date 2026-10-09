import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { quote, type QuoteRequest } from "@/domain/quote";
import { addMinutes } from "@/domain/time";
import { completeJob, markNoAccess } from "@/server/booking/jobs";
import { quoteSnapshot } from "@/server/booking/place";
import { loadCatalog, type Catalog } from "@/server/catalog";
import { completeSimulatedCheckout, startBookingCheckout } from "@/server/payments/service";

import { createTestTenant } from "./test-tenant";

/**
 * Operations end to end: a new price version changes new quotes but not booked visits, finishing a job
 * charges the balance to the saved card, and a lockout keeps the fee from the deposit.
 */

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;
let ownerId: string;
const home = { bedrooms: 3, fullBaths: 2, halfBaths: 1, sqft: 2100 };
const request: QuoteRequest = { service: "standard", home, zip: "27609" };

/** A paid, confirmed one-time visit starting `hoursAhead` from now (negative: already started). */
async function paidVisit(n: number, hoursAhead: number) {
  const priced = quote(catalog.pricing.rules, request);
  if (!priced.ok) throw new Error(priced.error.message);
  const q = priced.quote;
  const start = new Date(Date.now() + hoursAhead * 3600_000);
  start.setUTCMinutes(0, 0, 0);
  const windowStart = start.toISOString();
  const windowEnd = addMinutes(windowStart, 60);
  const { data, error } = await tenant.admin.rpc("cmd_create_booking", {
    p_tenant_id: tenant.tenantId,
    p_actor: ownerId,
    p_actor_kind: "staff",
    p_source: "admin",
    p_status: "pending_payment",
    p_client: { full_name: `Ops Client ${n}`, email: `ops${n}@it.example` },
    p_property: {
      address_line1: `${n} Ops St`,
      city: "Raleigh",
      state: "NC",
      zip: "27609",
      bedrooms: 3,
      full_baths: 2,
      half_baths: 1,
      sqft: 2100,
    },
    p_service_id: catalog.services.find((s) => s.code === "standard")!.id,
    p_arrival_window: `[${windowStart},${windowEnd})`,
    p_busy: `[${windowStart},${addMinutes(windowEnd, q.firstVisit.durationMinutes + 30)})`,
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
  await completeSimulatedCheckout(bookingId, "visa");
  return bookingId;
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
  const { data: user } = await tenant.admin.auth.admin.createUser({
    email: `owner-${tenant.slug}@it.example`,
    email_confirm: true,
  });
  ownerId = user.user!.id;
  await tenant.admin
    .from("memberships")
    .insert({ tenant_id: tenant.tenantId, user_id: ownerId, role: "owner" });
});

afterAll(async () => {
  await tenant?.cleanup();
  if (ownerId) await tenant.admin.auth.admin.deleteUser(ownerId);
});

describe("rule versions", () => {
  it("prices new quotes with a new version and leaves booked visits alone", async () => {
    const bookingId = await paidVisit(1, 72);
    const before = quote(catalog.pricing.rules, request);

    const raised = structuredClone(catalog.pricing.rules);
    raised.services.standard!.base_cents += 2000;
    const { data, error } = await tenant.admin.rpc("cmd_publish_rules", {
      p_tenant_id: tenant.tenantId,
      p_actor: ownerId,
      p_kind: "pricing",
      p_rules: raised,
      p_note: "Standard +$20",
    });
    expect(error).toBeNull();
    expect(data?.[0]?.version).toBe(2);

    const fresh = (await loadCatalog(tenant.slug))!;
    expect(fresh.pricing.version).toBe(2);
    const after = quote(fresh.pricing.rules, request);
    expect(
      after.ok &&
        before.ok &&
        after.quote.firstVisit.totalCents - before.quote.firstVisit.totalCents,
    ).toBe(2000);

    const { data: booking } = await tenant.admin
      .from("bookings")
      .select("total_cents, pricing_version_id")
      .eq("id", bookingId)
      .single();
    expect(booking).toEqual({
      total_cents: before.ok ? before.quote.firstVisit.totalCents : -1,
      pricing_version_id: catalog.pricing.id,
    });
    catalog = fresh;
  });
});

describe("finishing a visit", () => {
  it("charges the balance to the saved card when the job is done", async () => {
    const bookingId = await paidVisit(2, -1);
    const { data: booking } = await tenant.admin
      .from("bookings")
      .select("total_cents, deposit_cents")
      .eq("id", bookingId)
      .single();

    const { charge } = await completeJob({
      bookingId,
      actorUserId: ownerId,
      checklist: [{ item: "Kitchen", done: true }],
      notes: "All good",
      photoPaths: [],
    });
    expect(charge.status).toBe("succeeded");
    expect((await payments(bookingId)).map((p) => [p.purpose, p.amount_cents])).toEqual([
      ["deposit", booking!.deposit_cents],
      ["balance", booking!.total_cents - booking!.deposit_cents],
    ]);
  });

  it("keeps half the price as a lockout fee: the deposit first, the rest from the card", async () => {
    const bookingId = await paidVisit(3, -1);
    const { data: booking } = await tenant.admin
      .from("bookings")
      .select("total_cents, deposit_cents")
      .eq("id", bookingId)
      .single();

    const { feeCents } = await markNoAccess({
      bookingId,
      actorUserId: ownerId,
      note: "Locked gate",
    });
    expect(feeCents).toBe(Math.round(booking!.total_cents / 2));
    const rows = await payments(bookingId);
    expect(rows.find((p) => p.purpose === "no_access_fee")?.amount_cents).toBe(
      feeCents - booking!.deposit_cents,
    );
  });

  it("refuses to complete a job days before it happens", async () => {
    const bookingId = await paidVisit(4, 96);
    await expect(
      completeJob({ bookingId, actorUserId: ownerId, checklist: [], notes: "", photoPaths: [] }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
