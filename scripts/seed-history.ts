import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { generateHistory, type HistoryInput, type PlanSpec } from "@/demo/history";
import { formatMoney } from "@/domain/money";

type Admin = SupabaseClient<Database>;

const range = (start: string, end: string) => `[${start},${end})`;

async function insertAll<T extends Record<string, unknown>>(
  admin: Admin,
  table: string,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table as "bookings").insert(rows.slice(i, i + 500) as never);
    if (error) throw new Error(`insert into ${table}: ${error.message}`);
  }
}

/**
 * Writes the generated history (see src/demo/history.ts) for a freshly seeded tenant: plans, bookings,
 * crew time, booking events, payments, refunds, saved cards, time off and one open payment alert.
 * Rows are written directly with the service role: the cmd_* functions refuse to create completed or past
 * bookings, which is exactly what history is.
 */
export async function insertHistory(
  admin: Admin,
  tenantId: string,
  input: HistoryInput,
  plans: PlanSpec[],
  badCardClients: string[],
) {
  const history = generateHistory(input, plans, badCardClients);
  const actorFor = {
    web: "guest",
    portal: "client",
    admin: "staff",
    ai: "ai",
    plan: "system",
  } as const;

  // Plans --------------------------------------------------------------------------------------------
  const planIds = history.plans.map(() => crypto.randomUUID());
  await insertAll(
    admin,
    "recurring_plans",
    history.plans.map((plan, i) => ({
      id: planIds[i],
      tenant_id: tenantId,
      client_id: plan.clientId,
      property_id: plan.propertyId,
      service_id: input.serviceIds.standard,
      frequency: plan.spec.frequency,
      first_date: plan.firstDate,
      window_start_local: plan.windowStart,
      window_end_local: plan.windowEnd,
      timezone: input.timeZone,
      preferred_crew_id: plan.crewId,
      quote: plan.quote,
      price_cents: plan.priceCents,
      duration_minutes: plan.durationMinutes,
      pricing_version_id: input.rules.pricing.id,
      materialized_through: history.bookings
        .filter((b) => b.planIndex === i)
        .map((b) => b.occurrenceDate!)
        .sort()
        .at(-1),
      created_at: plan.createdAt,
    })),
  );

  // Bookings and crew time ---------------------------------------------------------------------------
  await insertAll(
    admin,
    "bookings",
    history.bookings.map((b) => ({
      id: b.id,
      tenant_id: tenantId,
      client_id: b.clientId,
      property_id: b.propertyId,
      service_id: b.serviceId,
      crew_id: b.crewId,
      status: b.status,
      arrival_window: range(b.arrivalStart, b.arrivalEnd),
      duration_minutes: b.durationMinutes,
      quote: b.quote,
      total_cents: b.totalCents,
      deposit_cents: b.depositCents,
      pricing_version_id: input.rules.pricing.id,
      cancellation_version_id: input.rules.cancellation.id,
      recurring_plan_id: b.planIndex === null ? null : planIds[b.planIndex],
      occurrence_date: b.occurrenceDate,
      source: b.source,
      created_by: b.source === "admin" ? input.staff.dispatcherId : null,
      created_at: b.createdAt,
      confirmed_at: b.confirmedAt,
      completed_at: b.status === "completed" ? b.completedAt : null,
      cancelled_at: b.cancelledAt,
      cancel_reason: b.cancelReason,
    })),
  );

  await insertAll(admin, "crew_allocations", [
    ...history.bookings
      .filter((b) => b.status !== "cancelled")
      .map((b) => ({
        tenant_id: tenantId,
        crew_id: b.crewId,
        kind: "booking" as const,
        busy: range(b.busyStart, b.busyEnd),
        booking_id: b.id,
        created_at: b.createdAt,
      })),
    ...history.timeOff.map((t) => ({
      tenant_id: tenantId,
      crew_id: t.crewId,
      kind: "time_off" as const,
      busy: range(t.start, t.end),
      note: t.note,
      // Rows in one insert share their columns: a missing key would be sent as null, not as the default.
      created_at: input.now,
    })),
  ]);

  // Booking history ----------------------------------------------------------------------------------
  const events: Record<string, unknown>[] = [];
  for (const b of history.bookings) {
    const base = { tenant_id: tenantId, booking_id: b.id };
    const plan = b.source === "plan";
    events.push({
      ...base,
      event: "created",
      to_status: plan ? "confirmed" : "pending_payment",
      actor_kind: actorFor[b.source],
      actor_user_id: b.source === "admin" ? input.staff.dispatcherId : null,
      data: { source: b.source, crew_id: b.crewId, total_cents: b.totalCents },
      created_at: b.createdAt,
    });
    if (!plan) {
      events.push({
        ...base,
        event: "confirmed",
        from_status: "pending_payment",
        to_status: "confirmed",
        actor_kind: "system",
        data: { purpose: "deposit", amount_cents: b.depositCents },
        created_at: b.confirmedAt,
      });
    }
    if (b.status === "completed" || b.status === "no_access") {
      events.push({
        ...base,
        event: b.status,
        from_status: "confirmed",
        to_status: b.status,
        actor_kind: "crew",
        data: b.status === "no_access" ? { fee_cents: b.feeCents } : {},
        created_at: b.completedAt,
      });
    }
    if (b.status === "cancelled") {
      events.push({
        ...base,
        event: "cancelled",
        from_status: "confirmed",
        to_status: "cancelled",
        actor_kind: "client",
        data: { reason: b.cancelReason, fee_cents: b.feeCents },
        created_at: b.cancelledAt,
      });
    }
  }

  // Payments and refunds -----------------------------------------------------------------------------
  const paymentRows = history.payments.map((p, i) => {
    const b = history.bookings[p.bookingIndex]!;
    return {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      booking_id: b.id,
      client_id: b.clientId,
      purpose: p.purpose,
      amount_cents: p.amountCents,
      provider: "simulated" as const,
      provider_payment_id: `sim_seed_${i}_${b.id.slice(0, 8)}`,
      status: p.status,
      off_session: p.offSession,
      failure_code: p.failureCode ?? null,
      failure_message: p.failureCode ? "Your card was declined." : null,
      created_at: p.at,
      succeeded_at: p.status === "succeeded" ? p.at : null,
      refund: p.refundCents ?? 0,
      at: p.at,
    };
  });
  await insertAll(
    admin,
    "payments",
    paymentRows.map(({ refund: _refund, at: _at, ...row }) => row),
  );
  await insertAll(
    admin,
    "refunds",
    paymentRows
      .filter((p) => p.refund > 0)
      .map((p, i) => ({
        tenant_id: tenantId,
        payment_id: p.id,
        amount_cents: p.refund,
        status: "succeeded" as const,
        provider_refund_id: `sim_seed_re_${i}`,
        reason: "Cancelled within the policy",
        created_at: p.at,
      })),
  );
  for (const p of paymentRows) {
    if (p.amount_cents === 0) continue;
    events.push({
      tenant_id: tenantId,
      booking_id: p.booking_id,
      event:
        p.status === "failed"
          ? "payment_failed"
          : p.purpose === "cancellation_fee" || p.purpose === "no_access_fee"
            ? "fee_charged"
            : "payment_received",
      actor_kind: "system",
      data: {
        payment_id: p.id,
        purpose: p.purpose,
        amount_cents: p.amount_cents,
        ...(p.failure_code ? { failure_code: p.failure_code } : {}),
      },
      created_at: p.at,
    });
  }
  events.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  await insertAll(admin, "booking_events", events);

  // Saved cards: every client has one; a few have Stripe's "charges fail later" test card.
  await insertAll(
    admin,
    "client_billing",
    input.clients.map((c) => {
      const bad = history.badCardClientIds.includes(c.id);
      return {
        tenant_id: tenantId,
        client_id: c.id,
        provider: "simulated" as const,
        customer_ref: `sim_cus_${c.id}`,
        payment_method_ref: bad ? "sim_pm_fails_later" : "sim_pm_visa",
        card_brand: "visa",
        card_last4: bad ? "0341" : "4242",
        card_exp_month: 12,
        card_exp_year: 2030,
      };
    }),
  );

  // The declined balance waits in the dispatcher's queue.
  const failed = paymentRows.filter((p) => p.status === "failed");
  if (failed.length > 0) {
    const { data: numbered } = await admin
      .from("bookings")
      .select("id, number")
      .in(
        "id",
        failed.map((p) => p.booking_id),
      );
    await insertAll(
      admin,
      "dispatch_alerts",
      failed.map((p) => ({
        tenant_id: tenantId,
        kind: "payment_failed" as const,
        booking_id: p.booking_id,
        message: `Balance of ${formatMoney(p.amount_cents)} for booking #${
          numbered?.find((n) => n.id === p.booking_id)?.number ?? "?"
        } was declined (card_declined).`,
        created_at: p.at,
      })),
    );
  }

  // Clients joined a little before their first booking, not on the day the demo was seeded.
  for (const client of input.clients) {
    const first = history.bookings
      .filter((b) => b.clientId === client.id)
      .map((b) => b.createdAt)
      .sort()[0];
    if (first) {
      const joined = new Date(Date.parse(first) - 3 * 86_400_000).toISOString();
      const { error } = await admin
        .from("clients")
        .update({ created_at: joined })
        .eq("id", client.id);
      if (error) throw new Error(`backdate client: ${error.message}`);
    }
  }

  // Upcoming visits get their reminders, as if they had been booked live.
  const { error: reminderError } = await admin.rpc("cmd_schedule_reminders", {
    p_tenant_id: tenantId,
  });
  if (reminderError) throw new Error(`schedule reminders: ${reminderError.message}`);

  return {
    plans: history.plans.length,
    bookings: history.bookings.length,
    payments: paymentRows.length,
  };
}
