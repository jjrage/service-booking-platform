import "server-only";

import { addDays, toInstant, toLocal, type LocalDate } from "@/domain/time";

import type { StaffContext } from "./auth/viewer";
import { unwrap } from "./db/errors";
import { parseRange } from "./db/ranges";
import { userDb } from "./db/user-client";

/**
 * What the admin console reads. Everything goes through the staff member's own session, so row-level
 * security limits it to their business: the console never sees another tenant's data, even by a bug here.
 */

export type BoardCrew = { id: string; name: string; color: string };

export type BoardBooking = {
  id: string;
  number: number;
  crewId: string;
  status: string;
  clientName: string;
  serviceName: string;
  city: string;
  date: LocalDate;
  /** Arrival window, latest finish (window end + duration) and end of the travel buffer, as instants. */
  windowStart: string;
  windowEnd: string;
  jobEnd: string;
  busyEnd: string;
  totalCents: number;
  planId: string | null;
  source: string;
};

export type BoardTimeOff = {
  id: string;
  crewId: string;
  start: string;
  end: string;
  note: string | null;
};

export async function crewBoard(staff: StaffContext, from: LocalDate, days: number) {
  const db = await userDb();
  const start = toInstant(from, "00:00", staff.timezone);
  const end = toInstant(addDays(from, days), "00:00", staff.timezone);

  const [crews, bookings, timeOff] = await Promise.all([
    db
      .from("crews")
      .select("id, name, color")
      .eq("tenant_id", staff.tenantId)
      .eq("active", true)
      .order("name"),
    db
      .from("bookings")
      .select(
        "id, number, crew_id, status, arrival_window, duration_minutes, total_cents, recurring_plan_id, source, client:clients!inner(full_name), service:services!inner(name), property:properties!inner(city), allocation:crew_allocations(busy)",
      )
      .eq("tenant_id", staff.tenantId)
      .overlaps("arrival_window", `[${start},${end})`)
      .in("status", ["pending_payment", "confirmed", "completed", "no_access"]),
    db
      .from("crew_allocations")
      .select("id, crew_id, busy, note")
      .eq("tenant_id", staff.tenantId)
      .eq("kind", "time_off")
      .overlaps("busy", `[${start},${end})`),
  ]);

  return {
    crews: unwrap(crews, "load crews") as BoardCrew[],
    bookings: unwrap(bookings, "load bookings").map((b): BoardBooking => {
      const window = parseRange(b.arrival_window);
      const allocation = Array.isArray(b.allocation) ? b.allocation[0] : b.allocation;
      const busy = allocation ? parseRange(allocation.busy) : null;
      const jobEnd = new Date(Date.parse(window.end) + b.duration_minutes * 60_000).toISOString();
      return {
        id: b.id,
        number: b.number,
        crewId: b.crew_id,
        status: b.status,
        clientName: b.client.full_name,
        serviceName: b.service.name,
        city: b.property.city,
        date: toLocal(window.start, staff.timezone).date,
        windowStart: window.start,
        windowEnd: window.end,
        jobEnd,
        busyEnd: busy?.end ?? jobEnd,
        totalCents: b.total_cents,
        planId: b.recurring_plan_id,
        source: b.source,
      };
    }),
    timeOff: unwrap(timeOff, "load time off").map((t): BoardTimeOff => ({
      id: t.id,
      crewId: t.crew_id,
      ...parseRange(t.busy),
      note: t.note,
    })),
  };
}

export async function bookingDetail(staff: StaffContext, bookingId: string) {
  const db = await userDb();
  const { data: booking } = await db
    .from("bookings")
    .select(
      "*, client:clients!inner(id, full_name, email, phone), service:services!inner(name, code), crew:crews!inner(id, name, color), property:properties!inner(*)",
    )
    .eq("id", bookingId)
    .eq("tenant_id", staff.tenantId)
    .maybeSingle();
  if (!booking) return null;

  const [payments, events, report, photos, crews] = await Promise.all([
    db.from("payments").select("*, refunds(*)").eq("booking_id", bookingId).order("created_at"),
    db.from("booking_events").select("*").eq("booking_id", bookingId).order("created_at"),
    db.from("job_reports").select("*").eq("booking_id", bookingId).maybeSingle(),
    db.from("job_photos").select("storage_path").eq("booking_id", bookingId),
    db
      .from("crews")
      .select("id, name, color")
      .eq("tenant_id", staff.tenantId)
      .eq("active", true)
      .order("name"),
  ]);

  const photoUrls = await Promise.all(
    unwrap(photos, "load photos").map(async (p) => {
      const { data } = await db.storage.from("job-photos").createSignedUrl(p.storage_path, 600);
      return data?.signedUrl ?? null;
    }),
  );

  const window = parseRange(booking.arrival_window);
  const start = toLocal(window.start, staff.timezone);
  const end = toLocal(window.end, staff.timezone);
  return {
    booking,
    date: start.date,
    localStart: start.time,
    localEnd: end.time,
    arrivalStart: window.start,
    /** Done / no access can be reported from 12 hours before the visit. */
    canFinish: Date.parse(window.start) <= Date.now() + 12 * 3600_000,
    payments: unwrap(payments, "load payments"),
    events: unwrap(events, "load events"),
    report: report.data,
    photoUrls: photoUrls.filter((url): url is string => url !== null),
    crews: unwrap(crews, "load crews") as BoardCrew[],
  };
}

export async function clientList(staff: StaffContext, search: string) {
  const db = await userDb();
  let query = db
    .from("clients")
    .select(
      "id, full_name, email, phone, source, created_at, properties(city, zip), bookings(status, total_cents, arrival_window), recurring_plans(status)",
    )
    .eq("tenant_id", staff.tenantId)
    .order("full_name");
  const term = search.trim().replace(/[%_,()]/g, "");
  if (term)
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  const rows = unwrap(await query, "load clients");
  const now = Date.now();
  return rows.map((c) => {
    const completed = c.bookings.filter((b) => b.status === "completed");
    const upcoming = c.bookings
      .filter((b) => b.status === "confirmed")
      .map((b) => parseRange(b.arrival_window).start)
      .filter((s) => Date.parse(s) > now)
      .sort();
    return {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      city: c.properties[0]?.city ?? "",
      visits: completed.length,
      lifetimeCents: completed.reduce((sum, b) => sum + b.total_cents, 0),
      nextVisit: upcoming[0] ?? null,
      onPlan: c.recurring_plans.some((p) => p.status === "active"),
    };
  });
}

export async function clientDetail(staff: StaffContext, clientId: string) {
  const db = await userDb();
  const { data: client } = await db
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .eq("tenant_id", staff.tenantId)
    .maybeSingle();
  if (!client) return null;
  const [homes, notes, bookings, plans, billing] = await Promise.all([
    db.from("properties").select("*").eq("client_id", clientId).order("created_at"),
    db
      .from("client_notes")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    db
      .from("bookings")
      .select(
        "id, number, status, arrival_window, total_cents, source, service:services!inner(name)",
      )
      .eq("client_id", clientId)
      .order("arrival_window", { ascending: false }),
    db.from("recurring_plans").select("*").eq("client_id", clientId),
    db
      .from("client_billing")
      .select("card_brand, card_last4, provider")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);
  return {
    client,
    homes: unwrap(homes, "load homes"),
    notes: unwrap(notes, "load notes"),
    bookings: unwrap(bookings, "load bookings").map((b) => ({
      ...b,
      date: toLocal(parseRange(b.arrival_window).start, staff.timezone).date,
    })),
    plans: unwrap(plans, "load plans"),
    card: billing.data,
  };
}

export async function paymentList(
  staff: StaffContext,
  filter: { status?: string; purpose?: string },
) {
  const db = await userDb();
  let query = db
    .from("payments")
    .select(
      "id, purpose, amount_cents, status, provider, off_session, failure_code, created_at, succeeded_at, booking:bookings!inner(id, number), client:clients!inner(id, full_name), refunds(amount_cents, status)",
    )
    .eq("tenant_id", staff.tenantId)
    .neq("purpose", "card_setup")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.status) query = query.eq("status", filter.status as "succeeded");
  if (filter.purpose) query = query.eq("purpose", filter.purpose as "deposit");
  return unwrap(await query, "load payments");
}

export async function openAlerts(staff: StaffContext) {
  const db = await userDb();
  return unwrap(
    await db
      .from("dispatch_alerts")
      .select(
        "id, kind, message, created_at, booking_id, plan_id, occurrence_date, booking:bookings(number)",
      )
      .eq("tenant_id", staff.tenantId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false }),
    "load alerts",
  );
}

export async function crewsOverview(staff: StaffContext) {
  const db = await userDb();
  const now = new Date().toISOString();
  const [crews, members, timeOff] = await Promise.all([
    db
      .from("crews")
      .select("id, name, color, active")
      .eq("tenant_id", staff.tenantId)
      .order("name"),
    db
      .from("crew_members")
      .select("crew_id, user_id, member:memberships!inner(display_name)")
      .eq("tenant_id", staff.tenantId),
    db
      .from("crew_allocations")
      .select("id, crew_id, busy, note")
      .eq("tenant_id", staff.tenantId)
      .eq("kind", "time_off")
      .overlaps("busy", `[${now},infinity)`),
  ]);
  return {
    crews: unwrap(crews, "load crews"),
    members: unwrap(members, "load crew members"),
    timeOff: unwrap(timeOff, "load time off").map((t) => ({
      id: t.id,
      crewId: t.crew_id,
      note: t.note,
      ...parseRange(t.busy),
    })),
  };
}

export async function ruleHistory(staff: StaffContext) {
  const db = await userDb();
  return unwrap(
    await db
      .from("rule_versions")
      .select("id, kind, version, effective_from, note, created_at")
      .eq("tenant_id", staff.tenantId)
      .order("version", { ascending: false }),
    "load rule versions",
  );
}
