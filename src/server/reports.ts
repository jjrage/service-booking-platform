import "server-only";

import { buildReport, type ReportBooking, type ReportPayment } from "@/domain/reports";
import {
  addDays,
  minutesOfDay,
  toInstant,
  toLocal,
  weekdayOf,
  type LocalDate,
} from "@/domain/time";

import type { StaffContext } from "./auth/viewer";
import { loadCatalog } from "./catalog";
import { unwrap } from "./db/errors";
import { parseRange } from "./db/ranges";
import { userDb } from "./db/user-client";

const weekIndex = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;

function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -weekIndex[weekdayOf(date)]);
}

/** Reports for the last `weeks` full weeks up to today, read through the staff member's own session. */
export async function loadReport(staff: StaffContext, weeks: number) {
  const db = await userDb();
  const catalog = await loadCatalog(staff.slug);
  if (!catalog) throw new Error("Unknown business");
  const tz = staff.timezone;
  const today = toLocal(new Date().toISOString(), tz).date;
  const from = addDays(mondayOf(today), -7 * (weeks - 1));
  const to = today;
  const start = toInstant(from, "00:00", tz);
  const end = toInstant(addDays(to, 1), "00:00", tz);

  const [bookingRows, crewRows, timeOffRows, plans] = await Promise.all([
    db
      .from("bookings")
      .select(
        "id, status, source, crew_id, client_id, recurring_plan_id, total_cents, deposit_cents, duration_minutes, arrival_window, created_at, quote, service:services!inner(name), property:properties!inner(zip), payments(purpose, status, amount_cents, refunds(amount_cents, status))",
      )
      .eq("tenant_id", staff.tenantId)
      .overlaps("arrival_window", `[${start},${end})`),
    db
      .from("crews")
      .select("id, name, color")
      .eq("tenant_id", staff.tenantId)
      .eq("active", true)
      .order("name"),
    db
      .from("crew_allocations")
      .select("crew_id, busy")
      .eq("tenant_id", staff.tenantId)
      .eq("kind", "time_off")
      .overlaps("busy", `[${start},${end})`),
    db
      .from("recurring_plans")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", staff.tenantId)
      .eq("status", "active"),
  ]);

  const zoneOfZip = new Map(
    catalog.pricing.rules.zones.flatMap((z) => z.zips.map((zip) => [zip, z.name])),
  );
  const bookings: ReportBooking[] = [];
  const payments: ReportPayment[] = [];
  for (const b of unwrap(bookingRows, "load bookings")) {
    const date = toLocal(parseRange(b.arrival_window).start, tz).date;
    const quoteZone = (b.quote as { zone?: { name?: string } } | null)?.zone?.name;
    bookings.push({
      id: b.id,
      status: b.status,
      source: b.source,
      service: b.service.name,
      crewId: b.crew_id,
      zone: quoteZone ?? zoneOfZip.get(b.property.zip) ?? "Other",
      clientId: b.client_id,
      planId: b.recurring_plan_id,
      totalCents: b.total_cents,
      depositCents: b.deposit_cents,
      durationMinutes: b.duration_minutes,
      date,
      week: mondayOf(date),
      createdInPeriod:
        Date.parse(b.created_at) >= Date.parse(start) && Date.parse(b.created_at) < Date.parse(end),
    });
    for (const p of b.payments) {
      payments.push({
        bookingId: b.id,
        purpose: p.purpose,
        status: p.status,
        netCents:
          p.amount_cents -
          p.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount_cents, 0),
      });
    }
  }

  // Working minutes per crew: opening hours on open days, minus days the crew is off.
  const crews = unwrap(crewRows, "load crews");
  const offDays = new Map<string, Set<string>>();
  for (const t of unwrap(timeOffRows, "load time off")) {
    const range = parseRange(t.busy);
    const set = offDays.get(t.crew_id) ?? new Set<string>();
    for (let d = toLocal(range.start, tz).date; d < toLocal(range.end, tz).date; d = addDays(d, 1))
      set.add(d);
    offDays.set(t.crew_id, set);
  }
  const available = new Map<string, number>();
  for (const crew of crews) {
    let minutes = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const hours = catalog.schedule.rules.business_hours[weekdayOf(d)];
      if (!hours || catalog.schedule.rules.closed_dates.includes(d) || offDays.get(crew.id)?.has(d))
        continue;
      minutes += minutesOfDay(hours[1]) - minutesOfDay(hours[0]);
    }
    available.set(crew.id, minutes);
  }

  return {
    from,
    to,
    crews,
    currency: catalog.tenant.currency,
    report: buildReport({
      bookings: bookings.filter((b) => b.date <= to),
      payments,
      availableMinutes: available,
      activePlans: plans.count ?? 0,
    }),
  };
}
