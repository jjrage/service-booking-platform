import type { Frequency } from "./rules";
import {
  addDays,
  daysBetween,
  toInstant,
  type Instant,
  type LocalDate,
  type LocalTime,
} from "./time";

/**
 * A recurring plan is stored as a rule in the business's local time ("every other Monday, 8:00–9:00,
 * America/New_York"). Each visit is converted to UTC on its own date, so the local arrival window survives
 * daylight-saving changes.
 */

export type PlanFrequency = Exclude<Frequency, "one_time">;

export type SeriesRule = {
  frequency: PlanFrequency;
  firstDate: LocalDate;
  windowStart: LocalTime;
  windowEnd: LocalTime;
  timeZone: string;
};

export type Occurrence = {
  date: LocalDate;
  start: Instant;
  end: Instant;
  /** The business is closed that day (holiday); the visit is not scheduled automatically. */
  closed: boolean;
};

/** "Monthly" is every 4 weeks: the visit keeps its weekday and never lands on a closed Sunday. */
const intervalDays: Record<PlanFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 28,
};

export function expandSeries(
  rule: SeriesRule,
  range: {
    from: LocalDate;
    through: LocalDate;
    closedDates?: readonly LocalDate[];
    skipDates?: readonly LocalDate[];
  },
): Occurrence[] {
  const step = intervalDays[rule.frequency];
  const closed = new Set(range.closedDates ?? []);
  const skipped = new Set(range.skipDates ?? []);
  const start = range.from > rule.firstDate ? range.from : rule.firstDate;
  const firstIndex = Math.ceil(daysBetween(rule.firstDate, start) / step);

  const occurrences: Occurrence[] = [];
  for (
    let date = addDays(rule.firstDate, firstIndex * step);
    date <= range.through;
    date = addDays(date, step)
  ) {
    if (skipped.has(date)) continue;
    occurrences.push({
      date,
      start: toInstant(date, rule.windowStart, rule.timeZone),
      end: toInstant(date, rule.windowEnd, rule.timeZone),
      closed: closed.has(date),
    });
  }
  return occurrences;
}
