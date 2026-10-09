"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { bookableDates } from "@/domain/availability";
import type { BookingRequestInput } from "@/domain/booking-request";
import { quote, quoteInputSchema, type QuoteRequest } from "@/domain/quote";
import { addDays } from "@/domain/time";
import {
  toChoices,
  windowsFor,
  type DayChoice,
  type WindowChoice,
} from "@/server/booking/availability";
import { holdWindow, releaseHold, type Hold } from "@/server/booking/hold";
import { placeHeldBooking } from "@/server/booking/place";
import { getCatalog, loadCatalog } from "@/server/catalog";
import { CommandError } from "@/server/db/errors";
import { bookingAccessToken, openJson, sealJson } from "@/server/signing";

/**
 * The public booking wizard's server side. Every action re-reads the tenant's rules and re-prices the visit:
 * the browser computes a quote for display only.
 */

const slugSchema = z.string().regex(/^[a-z0-9-]{2,40}$/);
const dateSchema = z.iso.date();
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

type Failure = { ok: false; message: string };

function holdCookieName(slug: string) {
  return `hold-${slug}`;
}

async function catalogFor(slug: unknown, fresh = false) {
  const parsed = slugSchema.safeParse(slug);
  const catalog = parsed.success
    ? await (fresh ? loadCatalog(parsed.data) : getCatalog(parsed.data))
    : null;
  if (!catalog) throw new CommandError("not_found", "Unknown business");
  return catalog;
}

export type WindowsResponse =
  | {
      ok: true;
      days: DayChoice[];
      first: string;
      last: string;
      durationMinutes: number;
    }
  | Failure;

export async function loadWindowsAction(input: {
  slug: string;
  quote: QuoteRequest;
  from?: string;
}): Promise<WindowsResponse> {
  const catalog = await catalogFor(input.slug);
  const request = quoteInputSchema.safeParse(input.quote);
  if (!request.success) return { ok: false, message: "Check the home details." };
  const priced = quote(catalog.pricing.rules, request.data);
  if (!priced.ok) return { ok: false, message: priced.error.message };

  const bounds = bookableDates(
    catalog.schedule.rules,
    catalog.tenant.timezone,
    new Date().toISOString(),
  );
  const requested = dateSchema.safeParse(input.from);
  const from = requested.success && requested.data > bounds.first ? requested.data : bounds.first;
  const to = [addDays(from, 13), bounds.last].sort()[0]!;
  const durationMinutes = priced.quote.firstVisit.durationMinutes;

  const days = await windowsFor(catalog, { from, to, durationMinutes });
  return {
    ok: true,
    days: toChoices(days),
    first: bounds.first,
    last: bounds.last,
    durationMinutes,
  };
}

export type HoldResponse = { ok: true; hold: Hold } | (Failure & { alternatives: WindowChoice[] });

export async function holdWindowAction(input: {
  slug: string;
  quote: QuoteRequest;
  date: string;
  localStart: string;
}): Promise<HoldResponse> {
  const catalog = await catalogFor(input.slug);
  const request = quoteInputSchema.safeParse(input.quote);
  const date = dateSchema.safeParse(input.date);
  const localStart = timeSchema.safeParse(input.localStart);
  if (!request.success || !date.success || !localStart.success) {
    return { ok: false, message: "Pick a date and window.", alternatives: [] };
  }
  const priced = quote(catalog.pricing.rules, request.data);
  if (!priced.ok) {
    return { ok: false, message: priced.error.message, alternatives: [] };
  }

  // One hold per visitor: picking another window gives up the previous one.
  const jar = await cookies();
  const previous = openJson<{ token: string }>(
    "hold",
    jar.get(holdCookieName(catalog.tenant.slug))?.value,
  );
  if (previous) await releaseHold(previous.token);

  const result = await holdWindow(catalog, {
    date: date.data,
    localStart: localStart.data,
    durationMinutes: priced.quote.firstVisit.durationMinutes,
  });
  if (!result.ok) {
    jar.delete(holdCookieName(catalog.tenant.slug));
    return {
      ok: false,
      message: result.message,
      alternatives: result.alternatives,
    };
  }

  jar.set(holdCookieName(catalog.tenant.slug), sealJson("hold", { token: result.hold.token }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: catalog.schedule.rules.hold_minutes * 60,
  });
  return { ok: true, hold: result.hold };
}

export async function releaseHoldAction(input: { slug: string }): Promise<void> {
  const slug = slugSchema.parse(input.slug);
  const jar = await cookies();
  const hold = openJson<{ token: string }>("hold", jar.get(holdCookieName(slug))?.value);
  if (hold) await releaseHold(hold.token);
  jar.delete(holdCookieName(slug));
}

export type PlaceResponse =
  | { ok: true; url: string }
  | (Failure & {
      code: "hold_expired" | "slot_taken" | "invalid";
      fieldErrors?: Record<string, string>;
    });

export async function placeBookingAction(input: {
  slug: string;
  request: BookingRequestInput;
}): Promise<PlaceResponse> {
  const catalog = await catalogFor(input.slug, true);
  const jar = await cookies();
  const hold = openJson<{ token: string }>(
    "hold",
    jar.get(holdCookieName(catalog.tenant.slug))?.value,
  );
  if (!hold) {
    return {
      ok: false,
      code: "hold_expired",
      message: "Your held window expired. Please pick a window again.",
    };
  }

  try {
    const placed = await placeHeldBooking(catalog, input.request, hold.token, {
      kind: "guest",
      userId: null,
      source: "web",
    });
    jar.delete(holdCookieName(catalog.tenant.slug));
    return {
      ok: true,
      url: `/${catalog.tenant.slug}/pay/${placed.bookingId}?t=${bookingAccessToken(placed.bookingId)}`,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        code: "invalid",
        message: "Please check the highlighted fields.",
        fieldErrors: Object.fromEntries(
          error.issues.map((issue) => [issue.path.join("."), issue.message]),
        ),
      };
    }
    if (error instanceof CommandError) {
      if (error.code === "hold_expired") {
        jar.delete(holdCookieName(catalog.tenant.slug));
        return {
          ok: false,
          code: "hold_expired",
          message: "Your held window expired. Please pick a window again.",
        };
      }
      if (error.code === "slot_taken") {
        return {
          ok: false,
          code: "slot_taken",
          message: "That window is no longer free. Please pick another one.",
        };
      }
      return { ok: false, code: "invalid", message: error.message };
    }
    throw error;
  }
}
