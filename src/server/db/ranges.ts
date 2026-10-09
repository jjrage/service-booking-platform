import { normalizeInstant, type Instant } from "@/domain/time";

/** A half-open [start, end) range as a Postgres tstzrange literal. */
export function toRange(start: Instant, end: Instant): string {
  return `[${start},${end})`;
}

/**
 * Parses a tstzrange as PostgREST returns it, e.g. ["2026-10-12 12:00:00+00","2026-10-12 15:30:00+00").
 * Only bounded, half-open ranges are used in this schema (enforced by check constraints).
 */
export function parseRange(value: unknown): { start: Instant; end: Instant } {
  const match =
    typeof value === "string" ? /^\[\s*"?([^",]+)"?\s*,\s*"?([^",)]+)"?\s*\)$/.exec(value) : null;
  if (!match) {
    throw new Error(`Not a bounded [start, end) range: ${String(value)}`);
  }
  return {
    start: normalizeInstant(match[1]!),
    end: normalizeInstant(match[2]!),
  };
}
