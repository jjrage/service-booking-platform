import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ClientContext } from "@/server/auth/viewer";
import type { AssistantContext } from "@/server/ai/handlers";
import { runLogged, toolSpecs } from "@/server/ai/tools";
import { loadCatalog, type Catalog } from "@/server/catalog";

import { createTestTenant } from "./test-tenant";

/**
 * The assistant's tools, exercised without a model (no API key needed): every answer comes from the same
 * server functions the booking page uses, a booking exists only when the tool created it, a guest's booking
 * waits for payment, a signed-in client cannot touch someone else's booking, and every call is logged.
 */

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;
let userId: string;
let client: ClientContext;

const visit = {
  service: "standard",
  bedrooms: 3,
  full_baths: 2,
  half_baths: 1,
  sqft: 2100,
  zip: "27609",
  addons: [],
  condition: "normal" as const,
  frequency: "one_time" as const,
  empty_home: false,
  recently_cleaned: false,
};

function tool(name: string) {
  const found = toolSpecs.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found as (typeof toolSpecs)[number] & {
    run: (ctx: AssistantContext, input: never) => Promise<unknown>;
  };
}

let calls = 0;
async function call(ctx: AssistantContext, name: string, input: object) {
  calls += 1;
  return runLogged(ctx, tool(name) as never, input as never, `toolu_test_${calls}`);
}

async function conversation(channel: "web" | "portal"): Promise<AssistantContext> {
  const { data, error } = await tenant.admin
    .from("ai_conversations")
    .insert({
      tenant_id: tenant.tenantId,
      channel,
      visitor_id: crypto.randomUUID(),
      model: "test",
      client_id: channel === "portal" ? client.clientId : null,
      user_id: channel === "portal" ? userId : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return {
    catalog,
    conversationId: data.id,
    channel,
    client: channel === "portal" ? client : null,
    userId: channel === "portal" ? userId : null,
  };
}

async function firstFreeWindow(ctx: AssistantContext) {
  const out = (await call(ctx, "check_availability", { visit, from_date: null, days: 14 }))
    .result as {
    days: { date: string; free_windows?: { window_start: string }[] }[];
  };
  const day = out.days.find((d) => d.free_windows && d.free_windows.length > 0)!;
  return { date: day.date, window_start: day.free_windows![0]!.window_start };
}

beforeAll(async () => {
  tenant = await createTestTenant({ crews: 2 });
  catalog = (await loadCatalog(tenant.slug))!;

  const { data: user } = await tenant.admin.auth.admin.createUser({
    email: `client-${tenant.slug}@it.example`,
    email_confirm: true,
  });
  userId = user.user!.id;
  const { data: row } = await tenant.admin
    .from("clients")
    .insert({
      tenant_id: tenant.tenantId,
      user_id: userId,
      full_name: "Portal Pat",
      email: `client-${tenant.slug}@it.example`,
      source: "web",
    })
    .select("id")
    .single();
  await tenant.admin.from("properties").insert({
    tenant_id: tenant.tenantId,
    client_id: row!.id,
    address_line1: "9 Home Rd",
    city: "Raleigh",
    state: "NC",
    zip: "27609",
    bedrooms: 3,
    full_baths: 2,
    half_baths: 1,
    sqft: 2100,
  });
  await tenant.admin.rpc("cmd_save_billing", {
    p_tenant_id: tenant.tenantId,
    p_client_id: row!.id,
    p_provider: "simulated",
    p_customer_ref: `sim_cus_${row!.id}`,
    p_card: {
      payment_method_ref: "sim_pm_visa",
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2030,
    },
  });
  client = {
    tenantId: tenant.tenantId,
    slug: tenant.slug,
    name: "Test",
    timezone: "America/New_York",
    clientId: row!.id,
    fullName: "Portal Pat",
  };
});

afterAll(async () => {
  await tenant?.cleanup();
  if (userId) await tenant.admin.auth.admin.deleteUser(userId);
});

describe("assistant tools", () => {
  it("answers prices from the pricing rules, never from the model", async () => {
    const ctx = await conversation("web");
    const out = await call(ctx, "get_quote", { visit });
    expect(out.result).toMatchObject({ first_visit: { total: "$255" }, deposit_due_now: "$63.75" });
    expect(out.card).toMatchObject({ kind: "quote", totalCents: 25500 });
  });

  it("refuses an address outside the service area with the business's own words, and logs the failure", async () => {
    const ctx = await conversation("web");
    await expect(call(ctx, "get_quote", { visit: { ...visit, zip: "90210" } })).rejects.toThrow(
      /outside our service area/,
    );
    const { data } = await tenant.admin
      .from("ai_tool_calls")
      .select("tool_name, ok, error")
      .eq("conversation_id", ctx.conversationId);
    expect(data).toEqual([
      { tool_name: "get_quote", ok: false, error: "ZIP 90210 is outside our service area." },
    ]);
  });

  it("never offers a Sunday or a holiday", async () => {
    const ctx = await conversation("web");
    const out = (await call(ctx, "check_availability", { visit, from_date: null, days: 14 }))
      .result as {
      days: { date: string; closed?: string; free_windows?: unknown[] }[];
    };
    const sundays = out.days.filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === 0);
    expect(sundays.length).toBeGreaterThan(0);
    expect(sundays.every((d) => d.closed === "closed" && !d.free_windows)).toBe(true);
  });

  it("keeps the hold token on the server and books a guest as pending payment", async () => {
    const ctx = await conversation("web");
    await expect(
      call(ctx, "create_booking", {
        visit,
        full_name: "Gail Guest",
        email: "gail@it.example",
        phone: "919-555-0101",
        address_line1: "1 Guest Ln",
        address_line2: null,
        city: "Raleigh",
        state: "NC",
        access_notes: null,
        has_pets: false,
        pet_notes: null,
      }),
    ).rejects.toThrow(/hold_slot first/);

    const slot = await firstFreeWindow(ctx);
    const held = await call(ctx, "hold_slot", { visit, ...slot });
    expect(held.result).toMatchObject({ held: true });
    expect(JSON.stringify(held.result)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no token or ids for the model

    const booked = await call(ctx, "create_booking", {
      visit,
      full_name: "Gail Guest",
      email: "gail@it.example",
      phone: "919-555-0101",
      address_line1: "1 Guest Ln",
      address_line2: null,
      city: "Raleigh",
      state: "NC",
      access_notes: "Code 1111",
      has_pets: false,
      pet_notes: null,
    });
    expect(booked.result).toMatchObject({
      status: "pending_payment",
      total: "$255",
      deposit: "$63.75",
    });
    expect(booked.card).toMatchObject({ kind: "booking", status: "pending_payment" });
    expect((booked.card as { payUrl: string }).payUrl).toContain("/pay/");

    const { data } = await tenant.admin
      .from("bookings")
      .select("status, source")
      .eq("id", booked.bookingId!)
      .single();
    expect(data).toEqual({ status: "pending_payment", source: "ai" });
  });

  it("books a signed-in client with their saved card: confirmed, deposit paid", async () => {
    const ctx = await conversation("portal");
    const slot = await firstFreeWindow(ctx);
    await call(ctx, "hold_slot", { visit, ...slot });
    const booked = await call(ctx, "create_booking", {
      visit,
      full_name: null,
      email: null,
      phone: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      access_notes: null,
      has_pets: false,
      pet_notes: null,
    });
    expect(booked.result).toMatchObject({ status: "confirmed" });

    const visits = (await call(ctx, "list_my_visits", {})).result as {
      upcoming_visits: { booking_number: number }[];
    };
    expect(visits.upcoming_visits.map((v) => v.booking_number)).toContain(
      (booked.result as { booking_number: number }).booking_number,
    );
  });

  it("previews a cancellation fee before acting, and refuses someone else's booking", async () => {
    const ctx = await conversation("portal");
    const visits = (await call(ctx, "list_my_visits", {})).result as {
      upcoming_visits: { booking_number: number }[];
    };
    const mine = visits.upcoming_visits[0]!.booking_number;

    const preview = await call(ctx, "cancel_booking", { booking_number: mine, confirm: false });
    expect(preview.result).toHaveProperty("fee");
    const { data: still } = await tenant.admin
      .from("bookings")
      .select("status")
      .eq("number", mine)
      .single();
    expect(still?.status).toBe("confirmed");

    const { data: guest } = await tenant.admin
      .from("bookings")
      .select("number")
      .eq("tenant_id", tenant.tenantId)
      .eq("source", "ai")
      .eq("status", "pending_payment")
      .limit(1)
      .single();
    await expect(
      call(ctx, "cancel_booking", { booking_number: guest!.number, confirm: true }),
    ).rejects.toThrow(/not one of this client's bookings/);
  });

  it("does not give guests the visit-changing tools", async () => {
    const ctx = await conversation("web");
    await expect(call(ctx, "list_my_visits", {})).rejects.toThrow(/signed-in client/);
  });

  it("hands a conversation to the office", async () => {
    const ctx = await conversation("web");
    await call(ctx, "handoff_to_human", {
      reason: "Asked for a discount",
      summary: "Wants 20% off a deep clean",
    });
    const { data } = await tenant.admin
      .from("dispatch_alerts")
      .select("kind, message")
      .eq("conversation_id", ctx.conversationId)
      .single();
    expect(data?.kind).toBe("handoff");
    expect(data?.message).toContain("Asked for a discount");
  });
});
