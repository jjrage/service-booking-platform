import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, addMinutes, toLocal } from "@/domain/time";
import { rescheduleBooking } from "@/server/booking/change";
import { loadCatalog, type Catalog } from "@/server/catalog";
import { sendDueOutbox } from "@/server/notifications/sender";

import { createTestTenant } from "./test-tenant";

/**
 * Notifications end to end: a confirmed booking queues its messages in the same transaction, the sender
 * delivers each exactly once (running it again sends nothing), and a reschedule replaces the reminders.
 */

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;
let bookingId: string;

async function outbox() {
  const { data } = await tenant.admin
    .from("outbox")
    .select("kind, channel, status, provider, subject, send_after")
    .eq("booking_id", bookingId)
    .order("created_at");
  return data ?? [];
}

beforeAll(async () => {
  tenant = await createTestTenant({ crews: 1 });
  catalog = (await loadCatalog(tenant.slug))!;
  const start = new Date(Date.now() + 5 * 86_400_000);
  start.setUTCHours(13, 0, 0, 0);
  const windowStart = start.toISOString();
  const windowEnd = addMinutes(windowStart, 60);
  const { data, error } = await tenant.admin.rpc("cmd_create_booking", {
    p_tenant_id: tenant.tenantId,
    p_actor: null as unknown as string,
    p_actor_kind: "system",
    p_source: "admin",
    p_status: "confirmed",
    p_client: { full_name: "Note Client", email: "notes@it.example", phone: "(919) 555-0177" },
    p_property: {
      address_line1: "1 Mail St",
      city: "Raleigh",
      state: "NC",
      zip: "27609",
      bedrooms: 2,
      full_baths: 1,
    },
    p_service_id: catalog.services.find((s) => s.code === "standard")!.id,
    p_arrival_window: `[${windowStart},${windowEnd})`,
    p_busy: `[${windowStart},${addMinutes(windowEnd, 150)})`,
    p_duration_minutes: 120,
    p_quote: {},
    p_total_cents: 20000,
    p_deposit_cents: 0,
    p_pricing_version_id: catalog.pricing.id,
    p_cancellation_version_id: catalog.cancellation.id,
    p_crew_ids: tenant.crewIds,
  });
  if (error) throw error;
  bookingId = data[0]!.booking_id;
});

afterAll(async () => {
  await tenant?.cleanup();
});

describe("outbox", () => {
  it("queues the confirmation and reminders with the booking", async () => {
    expect((await outbox()).map((m) => `${m.kind}/${m.channel}/${m.status}`).sort()).toEqual([
      "booking_confirmed/email/pending",
      "reminder_24h/email/pending",
      "reminder_24h/sms_log/pending",
      "reminder_72h/email/pending",
    ]);
  });

  it("sends a message once, however often the job runs", async () => {
    await sendDueOutbox(100);
    const afterFirst = (await outbox()).find((m) => m.kind === "booking_confirmed");
    expect(afterFirst).toMatchObject({ status: "sent", provider: "log" });
    expect(afterFirst?.subject).toMatch(/^You're booked/);

    await sendDueOutbox(100);
    await sendDueOutbox(100);
    const { count } = await tenant.admin
      .from("outbox")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId)
      .eq("status", "sent");
    expect(count).toBe(1);
  });

  it("replaces the reminders when the visit is rescheduled", async () => {
    const today = toLocal(new Date().toISOString(), catalog.tenant.timezone).date;
    let date = addDays(today, 9);
    if (toLocal(`${date}T16:00:00Z`, catalog.tenant.timezone).weekday === "sun")
      date = addDays(date, 1);

    const moved = await rescheduleBooking(
      bookingId,
      { kind: "system", userId: null },
      { date, localStart: "11:00" },
    );
    expect(moved.ok).toBe(true);

    const messages = await outbox();
    const reminders = messages.filter((m) => m.kind.startsWith("reminder"));
    expect(reminders.filter((m) => m.status === "cancelled")).toHaveLength(3);
    expect(reminders.filter((m) => m.status === "pending")).toHaveLength(3);
    expect(messages.some((m) => m.kind === "booking_rescheduled" && m.status === "pending")).toBe(
      true,
    );
  });
});
