import { Temporal } from "temporal-polyfill";

import type { Weekday } from "./rules";

/**
 * Time conventions for the domain:
 * - an instant is an ISO-8601 string in UTC ("2026-11-09T13:00:00Z"), as stored in timestamptz;
 * - a local date is "YYYY-MM-DD" and a local time is "HH:MM", both in the business's IANA time zone.
 *
 * Local wall-clock time is converted to an instant per date, so a series that starts at 8:00 stays at 8:00
 * across a daylight-saving change while its UTC time moves by an hour.
 */

export type Instant = string;
export type LocalDate = string;
export type LocalTime = string;

const weekdayByIsoNumber: Record<number, Weekday> = {
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
  7: "sun",
};

/** The instant at which the business's clocks show `time` on `date`. */
export function toInstant(date: LocalDate, time: LocalTime, timeZone: string): Instant {
  return Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from(time) })
    .toInstant()
    .toString();
}

export function addMinutes(instant: Instant, minutes: number): Instant {
  return Temporal.Instant.from(instant).add({ minutes }).toString();
}

export function minutesBetween(from: Instant, to: Instant): number {
  return Temporal.Instant.from(to).since(Temporal.Instant.from(from)).total("minutes");
}

export function compareInstants(a: Instant, b: Instant): number {
  return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));
}

/** Normalizes any ISO or Postgres timestamp ("2026-11-09 13:00:00+00") to the canonical UTC form. */
export function normalizeInstant(value: string): Instant {
  return Temporal.Instant.from(value).toString();
}

/** The business's local date and time at an instant. */
export function toLocal(
  instant: Instant,
  timeZone: string,
): { date: LocalDate; time: LocalTime; weekday: Weekday } {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return {
    date: zoned.toPlainDate().toString(),
    time: zoned.toPlainTime().toString({ smallestUnit: "minute" }),
    weekday: weekdayByIsoNumber[zoned.dayOfWeek]!,
  };
}

export function weekdayOf(date: LocalDate): Weekday {
  return weekdayByIsoNumber[Temporal.PlainDate.from(date).dayOfWeek]!;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Temporal.PlainDate.from(to).since(Temporal.PlainDate.from(from)).total("days");
}

/** Minutes since midnight for an "HH:MM" local time. */
export function minutesOfDay(time: LocalTime): number {
  const [hours, mins] = time.split(":").map(Number);
  return hours! * 60 + mins!;
}

/** Half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap. */
export function overlaps(
  a: { start: Instant; end: Instant },
  b: { start: Instant; end: Instant },
): boolean {
  return compareInstants(a.start, b.end) < 0 && compareInstants(b.start, a.end) < 0;
}
