import type { ScheduleRules, Weekday } from "./rules";
import {
  addDays,
  addMinutes,
  minutesOfDay,
  overlaps,
  toInstant,
  toLocal,
  weekdayOf,
  type Instant,
  type LocalDate,
  type LocalTime,
} from "./time";

/**
 * Free arrival windows for a visit of a given length. The same function serves the booking form, the client
 * portal (reschedule), the admin console and the AI assistant. It only proposes: the database's exclusion
 * constraint has the final word when a slot is actually held, so a race between two clients is still safe.
 */

export type BusyInterval = { crewId: string; start: Instant; end: Instant };

export type WindowOption = {
  localStart: LocalTime;
  localEnd: LocalTime;
  /** The arrival window the client sees. */
  start: Instant;
  end: Instant;
  /** What the crew is busy for: from the window start until the latest finish plus travel buffer. */
  busyStart: Instant;
  busyEnd: Instant;
  /** Free crews, best candidate first. */
  freeCrewIds: string[];
  status: "available" | "full" | "too_long";
};

export type DayStatus =
  "open" | "closed" | "holiday" | "too_soon" | "beyond_horizon";

export type DayOption = {
  date: LocalDate;
  weekday: Weekday;
  status: DayStatus;
  windows: WindowOption[];
};

export type AvailabilityQuery = {
  rules: ScheduleRules;
  timeZone: string;
  now: Instant;
  from: LocalDate;
  to: LocalDate;
  durationMinutes: number;
  crewIds: string[];
  busy: BusyInterval[];
  /** Tried first when free, e.g. the crew a regular client is used to. */
  preferredCrewId?: string | null;
  /** Staff may book inside the cutoff and past the horizon; closed days still apply. */
  ignoreBookingHorizon?: boolean;
};

/** The first and last local dates a client can book at `now`. */
export function bookableDates(
  rules: ScheduleRules,
  timeZone: string,
  now: Instant,
): { first: LocalDate; last: LocalDate } {
  const local = toLocal(now, timeZone);
  const daysAhead =
    minutesOfDay(local.time) < minutesOfDay(rules.next_day_cutoff) ? 1 : 2;
  return {
    first: addDays(local.date, daysAhead),
    last: addDays(local.date, rules.horizon_days),
  };
}

/** The crew occupancy for a visit that may start anywhere in its arrival window. */
export function occupancy(
  windowStart: Instant,
  windowEnd: Instant,
  durationMinutes: number,
  travelBufferMinutes: number,
): { start: Instant; end: Instant } {
  return {
    start: windowStart,
    end: addMinutes(windowEnd, durationMinutes + travelBufferMinutes),
  };
}

export function availableWindows(query: AvailabilityQuery): DayOption[] {
  const { rules, timeZone } = query;
  const bounds = bookableDates(rules, timeZone, query.now);
  const closedDates = new Set(rules.closed_dates);
  const days: DayOption[] = [];

  for (let date = query.from; date <= query.to; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    const hours = rules.business_hours[weekday];
    const day: DayOption = { date, weekday, status: "open", windows: [] };
    days.push(day);

    if (!query.ignoreBookingHorizon && date < bounds.first) {
      day.status = "too_soon";
    } else if (!query.ignoreBookingHorizon && date > bounds.last) {
      day.status = "beyond_horizon";
    } else if (closedDates.has(date)) {
      day.status = "holiday";
    } else if (!hours) {
      day.status = "closed";
    }
    if (day.status !== "open" || !hours) continue;

    const [open, close] = hours;
    const load = dailyLoad(query.busy, date, timeZone);

    for (const [localStart, localEnd] of rules.arrival_windows) {
      if (localStart < open || localEnd > close) continue;

      const start = toInstant(date, localStart, timeZone);
      const end = toInstant(date, localEnd, timeZone);
      const busy = occupancy(
        start,
        end,
        query.durationMinutes,
        rules.travel_buffer_minutes,
      );
      const option: WindowOption = {
        localStart,
        localEnd,
        start,
        end,
        busyStart: busy.start,
        busyEnd: busy.end,
        freeCrewIds: [],
        status: "available",
      };
      day.windows.push(option);

      // A visit that starts at the end of its window must still finish by closing time.
      if (
        minutesOfDay(localEnd) + query.durationMinutes >
        minutesOfDay(close)
      ) {
        option.status = "too_long";
        continue;
      }

      option.freeCrewIds = query.crewIds
        .filter(
          (crewId) =>
            !query.busy.some(
              (interval) =>
                interval.crewId === crewId && overlaps(interval, busy),
            ),
        )
        .sort(
          (a, b) =>
            Number(b === query.preferredCrewId) -
              Number(a === query.preferredCrewId) ||
            (load.get(a) ?? 0) - (load.get(b) ?? 0) ||
            query.crewIds.indexOf(a) - query.crewIds.indexOf(b),
        );
      if (option.freeCrewIds.length === 0) option.status = "full";
    }
  }
  return days;
}

/** The window with this local start on this date, as availableWindows() sees it. */
export function findWindow(
  query: Omit<AvailabilityQuery, "from" | "to">,
  date: LocalDate,
  localStart: LocalTime,
): { day: DayOption; window: WindowOption | undefined } {
  const [day] = availableWindows({ ...query, from: date, to: date });
  return {
    day: day!,
    window: day!.windows.find((w) => w.localStart === localStart),
  };
}

/** The first `limit` available windows, in time order — the alternatives offered after a lost race. */
export function nextAvailable(
  days: DayOption[],
  limit: number,
): (WindowOption & { date: LocalDate })[] {
  return days
    .flatMap((day) =>
      day.windows.map((window) => ({ ...window, date: day.date })),
    )
    .filter((window) => window.status === "available")
    .slice(0, limit);
}

/** Busy intervals per crew that start on a local date: spreads new work across crews. */
function dailyLoad(
  busy: BusyInterval[],
  date: LocalDate,
  timeZone: string,
): Map<string, number> {
  const load = new Map<string, number>();
  for (const interval of busy) {
    if (toLocal(interval.start, timeZone).date === date) {
      load.set(interval.crewId, (load.get(interval.crewId) ?? 0) + 1);
    }
  }
  return load;
}
