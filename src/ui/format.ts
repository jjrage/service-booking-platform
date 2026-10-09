import type { Instant, LocalDate, LocalTime } from "@/domain/time";

export { formatMoney } from "@/domain/money";

/** "Monday, October 12" (long) or "Mon, Oct 12" (short) for a business-local date. */
export function formatDate(
  date: LocalDate,
  style: "long" | "short" = "short",
): string {
  // Noon UTC on that date never crosses a day boundary when formatted in UTC.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: style,
    month: style,
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function clock(time: LocalTime): { text: string; period: "AM" | "PM" } {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const hour = h % 12 === 0 ? 12 : h % 12;
  return {
    text: `${hour}:${String(m).padStart(2, "0")}`,
    period: h < 12 ? "AM" : "PM",
  };
}

/** "8:00 AM" */
export function formatTime(time: LocalTime): string {
  const { text, period } = clock(time);
  return `${text} ${period}`;
}

/** "8:00–9:00 AM", or "11:00 AM–12:00 PM" across noon. */
export function formatWindow(start: LocalTime, end: LocalTime): string {
  const a = clock(start);
  const b = clock(end);
  return a.period === b.period
    ? `${a.text}–${b.text} ${b.period}`
    : `${a.text} ${a.period}–${b.text} ${b.period}`;
}

/** An instant shown in the business's time zone. */
export function formatInstant(
  instant: Instant,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(
    new Date(instant),
  );
}

/** "3 h 45 min" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Adds days to a "YYYY-MM-DD" date without a time-zone library (keeps Temporal out of the browser bundle). */
export function shiftDate(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const brands: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

/** "Visa ending in 4242" */
export function cardLabel(card: { brand: string; last4: string }): string {
  return `${brands[card.brand] ?? card.brand} ending in ${card.last4}`;
}
