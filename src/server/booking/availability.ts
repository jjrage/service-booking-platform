import "server-only";

import {
  availableWindows,
  nextAvailable,
  type BusyInterval,
  type DayOption,
} from "@/domain/availability";
import { addDays, toInstant, type LocalDate } from "@/domain/time";

import { activeCrewIds, type Catalog } from "../catalog";
import { adminDb } from "../db/admin";
import { unwrap } from "../db/errors";
import { parseRange } from "../db/ranges";

/** Everything that occupies the tenant's crews between two local dates (inclusive), minus expired holds. */
export async function loadBusy(
  catalog: Catalog,
  from: LocalDate,
  to: LocalDate,
  options: { excludeBookingId?: string } = {},
): Promise<BusyInterval[]> {
  const { timezone, id: tenantId } = catalog.tenant;
  // A day of margin on both sides: occupancy that starts the evening before can reach into the morning.
  const start = toInstant(addDays(from, -1), "00:00", timezone);
  const end = toInstant(addDays(to, 2), "00:00", timezone);

  let query = adminDb()
    .from("crew_allocations")
    .select("crew_id, busy, kind, booking_id, hold_expires_at")
    .eq("tenant_id", tenantId)
    .overlaps("busy", `[${start},${end})`);
  if (options.excludeBookingId) {
    query = query.or(
      `booking_id.is.null,booking_id.neq.${options.excludeBookingId}`,
    );
  }
  const rows = unwrap(await query, "load crew time");

  const now = Date.now();
  return rows
    .filter(
      (row) => row.kind !== "hold" || Date.parse(row.hold_expires_at!) > now,
    )
    .map((row) => ({ crewId: row.crew_id, ...parseRange(row.busy) }));
}

export type WindowQuery = {
  from: LocalDate;
  to: LocalDate;
  durationMinutes: number;
  preferredCrewId?: string | null;
  ignoreBookingHorizon?: boolean;
  excludeBookingId?: string;
};

export async function windowsFor(
  catalog: Catalog,
  query: WindowQuery,
): Promise<DayOption[]> {
  const [crewIds, busy] = await Promise.all([
    activeCrewIds(catalog.tenant.id),
    loadBusy(catalog, query.from, query.to, {
      excludeBookingId: query.excludeBookingId,
    }),
  ]);
  return availableWindows({
    rules: catalog.schedule.rules,
    timeZone: catalog.tenant.timezone,
    now: new Date().toISOString(),
    from: query.from,
    to: query.to,
    durationMinutes: query.durationMinutes,
    crewIds,
    busy,
    preferredCrewId: query.preferredCrewId,
    ignoreBookingHorizon: query.ignoreBookingHorizon,
  });
}

/** A window as the browser sees it: no crew ids, just whether it can be booked. */
export type WindowChoice = {
  date: LocalDate;
  localStart: string;
  localEnd: string;
  start: string;
  end: string;
  status: "available" | "full" | "too_long";
};

export type DayChoice = {
  date: LocalDate;
  weekday: string;
  status: DayOption["status"];
  windows: WindowChoice[];
};

export function toChoices(days: DayOption[]): DayChoice[] {
  return days.map((day) => ({
    date: day.date,
    weekday: day.weekday,
    status: day.status,
    windows: day.windows.map((w) => ({
      date: day.date,
      localStart: w.localStart,
      localEnd: w.localEnd,
      start: w.start,
      end: w.end,
      status: w.status,
    })),
  }));
}

/** The next few free windows from a date: what to offer someone who just lost a slot. */
export async function alternativesFrom(
  catalog: Catalog,
  from: LocalDate,
  durationMinutes: number,
  limit = 3,
): Promise<WindowChoice[]> {
  const days = await windowsFor(catalog, {
    from,
    to: addDays(from, 14),
    durationMinutes,
  });
  return nextAvailable(days, limit).map((w) => ({
    date: w.date,
    localStart: w.localStart,
    localEnd: w.localEnd,
    start: w.start,
    end: w.end,
    status: w.status,
  }));
}
