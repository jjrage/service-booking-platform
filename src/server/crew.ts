import "server-only";

import { addDays, toInstant, toLocal, type LocalDate } from "@/domain/time";

import type { StaffContext } from "./auth/viewer";
import { unwrap } from "./db/errors";
import { parseRange } from "./db/ranges";
import { userDb } from "./db/user-client";

/**
 * The crew app's reads, through the cleaner's own session. Row-level security shows them their crew's jobs,
 * and a client's address, access notes and phone only for jobs from 7 days back to 14 days ahead.
 */

export type CrewJob = {
  id: string;
  number: number;
  status: string;
  date: LocalDate;
  localStart: string;
  localEnd: string;
  durationMinutes: number;
  serviceName: string;
  clientName: string | null;
  address: string | null;
  city: string | null;
};

export async function myCrew(staff: StaffContext, userId: string) {
  const db = await userDb();
  const { data } = await db
    .from("crew_members")
    .select("crew:crews!inner(id, name, color)")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.crew ?? null;
}

export async function myJobs(staff: StaffContext, crewId: string, from: LocalDate, days: number) {
  const db = await userDb();
  const start = toInstant(from, "00:00", staff.timezone);
  const end = toInstant(addDays(from, days), "00:00", staff.timezone);
  const rows = unwrap(
    await db
      .from("bookings")
      .select(
        "id, number, status, arrival_window, duration_minutes, service:services!inner(name), client:clients(full_name), property:properties(address_line1, city)",
      )
      .eq("crew_id", crewId)
      .overlaps("arrival_window", `[${start},${end})`)
      .in("status", ["confirmed", "completed", "no_access"])
      .order("arrival_window"),
    "load jobs",
  );
  return rows.map((row): CrewJob => {
    const window = parseRange(row.arrival_window);
    const s = toLocal(window.start, staff.timezone);
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      date: s.date,
      localStart: s.time,
      localEnd: toLocal(window.end, staff.timezone).time,
      durationMinutes: row.duration_minutes,
      serviceName: row.service.name,
      clientName: row.client?.full_name ?? null,
      address: row.property?.address_line1 ?? null,
      city: row.property?.city ?? null,
    };
  });
}

export async function crewJob(staff: StaffContext, bookingId: string) {
  const db = await userDb();
  const { data: booking } = await db
    .from("bookings")
    .select(
      "id, number, status, tenant_id, arrival_window, duration_minutes, quote, total_cents, service:services!inner(name, checklist), client:clients(full_name, phone), property:properties(address_line1, address_line2, city, state, zip, bedrooms, full_baths, half_baths, sqft, has_pets, pet_notes, access_notes, parking_notes)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;

  const [report, photos] = await Promise.all([
    db
      .from("job_reports")
      .select("checklist, notes, completed_at")
      .eq("booking_id", bookingId)
      .maybeSingle(),
    db.from("job_photos").select("storage_path").eq("booking_id", bookingId),
  ]);
  const photoUrls = await Promise.all(
    unwrap(photos, "load photos").map(async (p) => {
      const { data } = await db.storage.from("job-photos").createSignedUrl(p.storage_path, 600);
      return data?.signedUrl ?? null;
    }),
  );

  const window = parseRange(booking.arrival_window);
  const start = toLocal(window.start, staff.timezone);
  const quote = booking.quote as {
    firstVisit?: {
      totalCents: number;
      lines: { code: string; label: string; quantity?: number }[];
    };
    recurringVisit?: {
      totalCents: number;
      lines: { code: string; label: string; quantity?: number }[];
    } | null;
  };
  const visit =
    quote.recurringVisit?.totalCents === booking.total_cents
      ? quote.recurringVisit
      : quote.firstVisit;

  return {
    id: booking.id,
    number: booking.number,
    status: booking.status,
    tenantId: booking.tenant_id,
    date: start.date,
    localStart: start.time,
    localEnd: toLocal(window.end, staff.timezone).time,
    /** Done / no access can be reported from 12 hours before the visit. */
    canFinish: Date.parse(window.start) <= Date.now() + 12 * 3600_000,
    durationMinutes: booking.duration_minutes,
    serviceName: booking.service.name,
    checklist: booking.service.checklist,
    extras: (visit?.lines ?? [])
      .filter((line) => line.code.startsWith("addon:") || line.code === "condition")
      .map(
        (line) => `${line.label}${line.quantity && line.quantity > 1 ? ` × ${line.quantity}` : ""}`,
      ),
    client: booking.client,
    property: booking.property,
    report: report.data,
    photoUrls: photoUrls.filter((url): url is string => url !== null),
  };
}
