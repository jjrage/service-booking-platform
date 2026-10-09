import "server-only";

import { occupancy } from "@/domain/availability";
import { expandSeries, type PlanFrequency } from "@/domain/series";
import { addDays, toLocal, type LocalDate } from "@/domain/time";

import { activeCrewIds, loadCatalog } from "./catalog";
import { nullable } from "./db/args";
import { adminDb } from "./db/admin";
import { CommandError, ensureOk, unwrap } from "./db/errors";
import { toRange } from "./db/ranges";
import { freeCancellationBoundary, type Actor } from "./booking/change";

/**
 * Recurring plans. A plan is a rule in the business's local time; its visits are created ahead of time as
 * ordinary bookings (cmd_create_booking), so each one passes the same exclusion constraint as any other.
 * The preferred crew is tried first, then the others; when nobody is free the visit goes to the
 * dispatcher's queue instead of being double-booked.
 */

export async function materializePlans(
  tenantId: string,
  options: { planId?: string; today?: LocalDate } = {},
): Promise<{ created: number; conflicts: number }> {
  const db = adminDb();
  const tenant = unwrap(
    await db.from("tenants").select("slug").eq("id", tenantId).single(),
    "load tenant",
  );
  const catalog = await loadCatalog(tenant.slug);
  if (!catalog) throw new CommandError("not_found", "Unknown business");
  const { schedule } = catalog;
  const today = options.today ?? toLocal(new Date().toISOString(), catalog.tenant.timezone).date;
  const through = addDays(today, schedule.rules.horizon_days);

  let query = db
    .from("recurring_plans")
    .select(
      "id, client_id, property_id, service_id, frequency, first_date, window_start_local, window_end_local, timezone, preferred_crew_id, quote, price_cents, duration_minutes, pricing_version_id, status, paused_until, materialized_through",
    )
    .eq("tenant_id", tenantId)
    .in("status", ["active", "paused"]);
  if (options.planId) query = query.eq("id", options.planId);
  const plans = unwrap(await query, "load plans");
  const crewIds = await activeCrewIds(tenantId);

  let created = 0;
  let conflicts = 0;
  for (const plan of plans) {
    const existing = new Set(
      unwrap(
        await db.from("bookings").select("occurrence_date").eq("recurring_plan_id", plan.id),
        "load plan visits",
      ).map((row) => row.occurrence_date!),
    );
    const pausedThrough = plan.status === "paused" && plan.paused_until ? plan.paused_until : null;

    const visits = expandSeries(
      {
        frequency: plan.frequency as PlanFrequency,
        firstDate: plan.first_date,
        windowStart: plan.window_start_local.slice(0, 5),
        windowEnd: plan.window_end_local.slice(0, 5),
        timeZone: plan.timezone,
      },
      {
        from: addDays(today, 1),
        through,
        closedDates: schedule.rules.closed_dates,
      },
    );

    for (const visit of visits) {
      if (visit.closed || existing.has(visit.date)) continue;
      if (pausedThrough && visit.date <= pausedThrough) continue;

      const busy = occupancy(
        visit.start,
        visit.end,
        plan.duration_minutes,
        schedule.rules.travel_buffer_minutes,
      );
      const candidates = [
        ...(plan.preferred_crew_id ? [plan.preferred_crew_id] : []),
        ...crewIds.filter((id) => id !== plan.preferred_crew_id),
      ];
      const result = await db.rpc("cmd_create_booking", {
        p_tenant_id: tenantId,
        p_actor: nullable<string>(null),
        p_actor_kind: "system",
        p_source: "plan",
        p_status: "confirmed",
        p_client: { id: plan.client_id },
        p_property: { id: plan.property_id },
        p_service_id: plan.service_id,
        p_arrival_window: toRange(visit.start, visit.end),
        p_busy: toRange(busy.start, busy.end),
        p_duration_minutes: plan.duration_minutes,
        p_quote: plan.quote,
        p_total_cents: plan.price_cents,
        p_deposit_cents: 0,
        p_pricing_version_id: plan.pricing_version_id,
        p_cancellation_version_id: catalog.cancellation.id,
        p_crew_ids: candidates,
        p_recurring_plan_id: plan.id,
        p_occurrence_date: visit.date,
      });

      if (result.error?.code === "23P01") {
        conflicts += 1;
        ensureOk(
          await db.rpc("cmd_raise_plan_conflict", {
            p_plan_id: plan.id,
            p_occurrence_date: visit.date,
            p_message: `No crew is free for a regular visit on ${visit.date} at ${plan.window_start_local.slice(0, 5)}. Move the visit or free a crew.`,
          }),
          "raise plan conflict",
        );
      } else if (result.error?.code === "23505") {
        // Created concurrently by another run: the unique (plan, date) key kept it single.
      } else {
        ensureOk(result, "create plan visit");
        created += 1;
      }
    }

    ensureOk(
      await db.rpc("cmd_mark_plan_materialized", {
        p_plan_id: plan.id,
        p_through: through,
      }),
      "mark plan materialized",
    );
  }
  return { created, conflicts };
}

async function planTenant(planId: string) {
  return unwrap(
    await adminDb()
      .from("recurring_plans")
      .select("id, tenant_id, tenant:tenants!inner(slug)")
      .eq("id", planId)
      .single(),
    "load plan",
  );
}

/** Pauses a plan until a date. Visits that can still be cancelled for free are cancelled. */
export async function pausePlan(planId: string, actor: Actor, until: LocalDate) {
  const plan = await planTenant(planId);
  return unwrap(
    await adminDb().rpc("cmd_pause_plan", {
      p_plan_id: planId,
      p_actor: nullable<string>(actor.userId),
      p_actor_kind: actor.kind,
      p_until: until,
      p_free_after: await freeCancellationBoundary(plan.tenant.slug),
    }),
    "pause plan",
  );
}

export async function resumePlan(planId: string, actor: Actor) {
  const plan = await planTenant(planId);
  ensureOk(
    await adminDb().rpc("cmd_resume_plan", {
      p_plan_id: planId,
      p_actor: nullable<string>(actor.userId),
      p_actor_kind: actor.kind,
    }),
    "resume plan",
  );
  return materializePlans(plan.tenant_id, { planId });
}

export async function cancelPlan(planId: string, actor: Actor) {
  const plan = await planTenant(planId);
  return unwrap(
    await adminDb().rpc("cmd_cancel_plan", {
      p_plan_id: planId,
      p_actor: nullable<string>(actor.userId),
      p_actor_kind: actor.kind,
      p_free_after: await freeCancellationBoundary(plan.tenant.slug),
    }),
    "cancel plan",
  );
}
