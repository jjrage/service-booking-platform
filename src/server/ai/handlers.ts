import "server-only";

import { z } from "zod";

import { bookableDates } from "@/domain/availability";
import { formatMoney } from "@/domain/money";
import { frequencyLabel, quote, type QuoteRequest } from "@/domain/quote";
import { frequencies, weekdays } from "@/domain/rules";
import { addDays, toLocal } from "@/domain/time";
import { formatDate, formatWindow } from "@/ui/format";

import type { ClientContext } from "../auth/viewer";
import { appUrl } from "@/config/public-env";
import { windowsFor } from "../booking/availability";
import { cancelBooking, previewChange, rescheduleBooking } from "../booking/change";
import { holdWindow, releaseHold } from "../booking/hold";
import { placeHeldBooking, placeHeldBookingForClient } from "../booking/place";
import type { Catalog } from "../catalog";
import { adminDb } from "../db/admin";
import { CommandError, unwrap } from "../db/errors";
import { parseRange } from "../db/ranges";
import { afterPaymentEvent } from "../payments/after-event";
import { chargeSavedCard } from "../payments/service";
import { bookingAccessToken } from "../signing";

/**
 * The assistant's tools, as plain server functions: the same booking, pricing and change code the forms and
 * the portal use. Each returns the data the model reads (`result`) and, where useful, a card the chat UI
 * draws from the server's own answer (`card`) - a confirmation card never comes from the model's text.
 */

export type AssistantContext = {
  catalog: Catalog;
  conversationId: string;
  channel: "web" | "portal";
  /** The signed-in client, in the portal. */
  client: ClientContext | null;
  userId: string | null;
};

export type ChatCard =
  | {
      kind: "quote";
      service: string;
      totalCents: number;
      depositCents: number;
      durationMinutes: number;
      regularCents: number | null;
    }
  | { kind: "windows"; days: { date: string; windows: { start: string; end: string }[] }[] }
  | { kind: "hold"; date: string; start: string; end: string; expiresAt: string }
  | {
      kind: "booking";
      number: number;
      status: "pending_payment" | "confirmed";
      date: string;
      start: string;
      end: string;
      totalCents: number;
      depositCents: number;
      payUrl: string | null;
      bookingUrl: string;
    }
  | {
      kind: "change";
      action: "rescheduled" | "cancelled";
      number: number;
      feeCents: number;
      date?: string;
      start?: string;
      end?: string;
    }
  | { kind: "handoff" };

export type ToolOutput = { result: unknown; card?: ChatCard; bookingId?: string };

const nullableString = (max: number) => z.string().max(max).nullable();

/** The visit details every pricing tool takes. Strict tool schemas: every field is required, null means "not given". */
export const visitSchema = z.strictObject({
  service: z.string().describe("Service code from list_services, e.g. standard, deep, move_in_out"),
  bedrooms: z.int().min(0).max(10),
  full_baths: z.int().min(0).max(10),
  half_baths: z.int().min(0).max(10),
  sqft: z
    .int()
    .min(200)
    .max(10000)
    .nullable()
    .describe(
      "Square footage if the client knows it (for a range, its upper end). Null if they don't: the price is then by bedrooms and bathrooms, which is how to explain it",
    ),
  zip: z.string().describe("5-digit ZIP code of the home"),
  addons: z
    .array(z.strictObject({ code: z.string(), quantity: z.int().min(1).max(50) }))
    .describe("Extras by code from list_services; quantity is 1 unless the extra is per unit"),
  condition: z.enum(["normal", "heavy"]),
  frequency: z.enum(frequencies),
  empty_home: z.boolean().describe("True only for move-in / move-out cleans of an empty home"),
  recently_cleaned: z
    .boolean()
    .describe(
      "For regular plans: the home had a professional cleaning recently (see first_visit in list_services)",
    ),
});

type VisitArgs = z.infer<typeof visitSchema>;

function toQuoteRequest(visit: VisitArgs): QuoteRequest {
  return {
    service: visit.service,
    home: {
      bedrooms: visit.bedrooms,
      fullBaths: visit.full_baths,
      halfBaths: visit.half_baths,
      sqft: visit.sqft,
    },
    addons: Object.fromEntries(visit.addons.map((a) => [a.code, a.quantity])),
    condition: visit.condition,
    frequency: visit.frequency,
    zip: visit.zip,
    emptyHome: visit.empty_home,
    recentlyCleaned: visit.recently_cleaned,
  };
}

function priceOrThrow(ctx: AssistantContext, visit: VisitArgs) {
  const priced = quote(ctx.catalog.pricing.rules, toQuoteRequest(visit));
  if (!priced.ok) throw new CommandError("invalid_input", priced.error.message);
  return priced.quote;
}

const money = (ctx: AssistantContext, cents: number) =>
  formatMoney(cents, ctx.catalog.tenant.currency);

// Business information ----------------------------------------------------------------------------------

export const businessInfoSchema = z.strictObject({});

export async function getBusinessInfo(ctx: AssistantContext): Promise<ToolOutput> {
  const { tenant, schedule, pricing, cancellation } = ctx.catalog;
  const now = toLocal(new Date().toISOString(), tenant.timezone);
  const bounds = bookableDates(schedule.rules, tenant.timezone, new Date().toISOString());
  const c = cancellation.rules;
  return {
    result: {
      business: tenant.name,
      phone: tenant.phone,
      email: tenant.contactEmail,
      today: `${formatDate(now.date, "long")} (${now.date}), local time ${now.time}`,
      opening_hours: Object.fromEntries(
        weekdays.map((d) => {
          const hours = schedule.rules.business_hours[d];
          return [d, hours ? `${hours[0]}-${hours[1]}` : "closed"];
        }),
      ),
      closed_dates: schedule.rules.closed_dates,
      arrival_windows: schedule.rules.arrival_windows.map(([s, e]) => formatWindow(s, e)),
      booking_horizon: `bookable from ${bounds.first} to ${bounds.last}`,
      service_area: pricing.rules.zones.map((z) => ({
        zone: z.name,
        travel_fee: money(ctx, z.surcharge_cents),
        zips: z.zips,
      })),
      deposit: `${pricing.rules.deposit.percent}% of a one-time visit (at least ${money(ctx, pricing.rules.deposit.minimum_cents)}), charged when booking; the rest after the visit. Regular plans save the card and charge after each visit.`,
      cancellation_policy: `Free to cancel or reschedule up to ${c.free_before_hours} hours before the arrival window; ${money(ctx, c.flat_fee_cents)} between ${c.late_within_hours} and ${c.free_before_hours} hours; ${c.late_fee_percent}% of the visit price within ${c.late_within_hours} hours; ${c.no_access_fee_percent}% if the crew cannot get in.`,
      visit_rule:
        "A visit must finish by closing time, so long visits only fit the earlier arrival windows.",
    },
  };
}

// Services ----------------------------------------------------------------------------------------------

export const listServicesSchema = z.strictObject({});

export async function listServices(ctx: AssistantContext): Promise<ToolOutput> {
  const rules = ctx.catalog.pricing.rules;
  return {
    result: {
      services: ctx.catalog.services.map((s) => {
        const priced = rules.services[s.code];
        return {
          code: s.code,
          name: s.name,
          description: s.description,
          booking:
            s.bookingMode === "instant"
              ? "book online with an instant price"
              : "quoted by the office after photos; use handoff_to_human",
          base_price: priced ? money(ctx, priced.base_cents) : null,
          regular_plans: Boolean(priced?.recurring),
          empty_home_only: Boolean(priced?.empty_home_only),
        };
      }),
      base_price_covers: `${rules.included.bedrooms} bedroom, ${rules.included.full_baths} full bath, up to ${rules.included.sqft} sq ft`,
      extras: Object.entries(rules.addons).map(([code, a]) => ({
        code,
        name: a.name,
        price: money(ctx, a.cents) + (a.per_unit ? " each" : ""),
        per_unit: Boolean(a.per_unit),
      })),
      frequencies: frequencies.map((f) => ({
        code: f,
        label: frequencyLabel(f),
        discount: `${rules.frequency_discount_percent[f]}% from the second visit`,
      })),
      first_visit: rules.first_visit
        ? `The first visit of a regular plan is priced as ${rules.first_visit.upgrade_to} unless the home had a professional cleaning in the last ${rules.first_visit.if_no_professional_clean_days} days.`
        : null,
      heavy_condition: `+${rules.condition.heavy.percent}%; the office confirms the price after seeing photos`,
    },
  };
}

// Quote --------------------------------------------------------------------------------------------------

export const getQuoteSchema = z.strictObject({ visit: visitSchema });

export async function getQuote(
  ctx: AssistantContext,
  input: z.infer<typeof getQuoteSchema>,
): Promise<ToolOutput> {
  const q = priceOrThrow(ctx, input.visit);
  const lines = (v: typeof q.firstVisit) =>
    v.lines.map(
      (l) =>
        `${l.label}${l.quantity && l.quantity > 1 ? ` x${l.quantity}` : ""}: ${money(ctx, l.cents)}`,
    );
  return {
    result: {
      first_visit: {
        priced_as: q.firstVisit.service,
        total: money(ctx, q.firstVisit.totalCents),
        duration_minutes: q.firstVisit.durationMinutes,
        lines: lines(q.firstVisit),
      },
      regular_visit: q.recurringVisit
        ? {
            total: money(ctx, q.recurringVisit.totalCents),
            duration_minutes: q.recurringVisit.durationMinutes,
            lines: lines(q.recurringVisit),
          }
        : null,
      deposit_due_now: money(ctx, q.depositCents),
      zone: q.zone.name,
      needs_office_review: q.needsReview,
      notes: q.notes,
    },
    card: {
      kind: "quote",
      service:
        ctx.catalog.services.find((s) => s.code === q.firstVisit.service)?.name ??
        q.firstVisit.service,
      totalCents: q.firstVisit.totalCents,
      depositCents: q.depositCents,
      durationMinutes: q.firstVisit.durationMinutes,
      regularCents: q.recurringVisit?.totalCents ?? null,
    },
  };
}

// Availability -------------------------------------------------------------------------------------------

export const checkAvailabilitySchema = z.strictObject({
  visit: visitSchema,
  from_date: z.iso
    .date()
    .nullable()
    .describe("YYYY-MM-DD to start looking from; null for the earliest bookable date"),
  days: z.int().min(1).max(14).describe("How many days to look at, 1-14"),
});

export async function checkAvailability(
  ctx: AssistantContext,
  input: z.infer<typeof checkAvailabilitySchema>,
): Promise<ToolOutput> {
  const q = priceOrThrow(ctx, input.visit);
  const { schedule, tenant } = ctx.catalog;
  const bounds = bookableDates(schedule.rules, tenant.timezone, new Date().toISOString());
  const from = input.from_date && input.from_date > bounds.first ? input.from_date : bounds.first;
  const to = [addDays(from, input.days - 1), bounds.last].sort()[0]!;
  if (from > bounds.last) {
    return { result: { available: [], note: `Bookings are open until ${bounds.last}.` } };
  }
  const days = await windowsFor(ctx.catalog, {
    from,
    to,
    durationMinutes: q.firstVisit.durationMinutes,
  });
  const open = days.map((d) => ({
    date: d.date,
    day: formatDate(d.date, "long"),
    status: d.status,
    windows: d.windows
      .filter((w) => w.status === "available")
      .map((w) => ({
        start: w.localStart,
        end: w.localEnd,
        label: formatWindow(w.localStart, w.localEnd),
      })),
    too_long: d.windows
      .filter((w) => w.status === "too_long")
      .map((w) => formatWindow(w.localStart, w.localEnd)),
  }));
  return {
    result: {
      visit_duration_minutes: q.firstVisit.durationMinutes,
      days: open.map((d) => ({
        date: d.date,
        day: d.day,
        ...(d.status !== "open"
          ? { closed: d.status }
          : { free_windows: d.windows.map((w) => ({ window_start: w.start, label: w.label })) }),
        ...(d.too_long.length ? { too_long_for_this_visit: d.too_long } : {}),
      })),
    },
    // No card when nothing is free: the model explains and offers other dates.
    card: open.some((d) => d.windows.length > 0)
      ? {
          kind: "windows",
          days: open
            .filter((d) => d.windows.length > 0)
            .slice(0, 6)
            .map((d) => ({
              date: d.date,
              windows: d.windows.map((w) => ({ start: w.start, end: w.end })),
            })),
        }
      : undefined,
  };
}

// Hold ------------------------------------------------------------------------------------------------------

export const holdSlotSchema = z.strictObject({
  visit: visitSchema,
  date: z.iso.date(),
  window_start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .describe("Arrival window start as HH:MM, from check_availability"),
});

async function currentHold(conversationId: string): Promise<string | null> {
  const { data } = await adminDb()
    .from("ai_conversations")
    .select("hold_token")
    .eq("id", conversationId)
    .single();
  return data?.hold_token ?? null;
}

async function setHold(conversationId: string, token: string | null) {
  await adminDb().from("ai_conversations").update({ hold_token: token }).eq("id", conversationId);
}

export async function holdSlot(
  ctx: AssistantContext,
  input: z.infer<typeof holdSlotSchema>,
): Promise<ToolOutput> {
  const q = priceOrThrow(ctx, input.visit);
  const previous = await currentHold(ctx.conversationId);
  if (previous) await releaseHold(previous);

  const held = await holdWindow(ctx.catalog, {
    date: input.date,
    localStart: input.window_start,
    durationMinutes: q.firstVisit.durationMinutes,
  });
  if (!held.ok) {
    await setHold(ctx.conversationId, null);
    return {
      result: {
        held: false,
        reason: held.message,
        alternatives: held.alternatives.map((w) => ({
          date: w.date,
          window_start: w.localStart,
          label: `${formatDate(w.date, "long")}, ${formatWindow(w.localStart, w.localEnd)}`,
        })),
      },
    };
  }
  // The token stays on the server: the model only learns that the window is held, and until when.
  await setHold(ctx.conversationId, held.hold.token);
  const minutes = Math.round((Date.parse(held.hold.expiresAt) - Date.now()) / 60_000);
  return {
    result: {
      held: true,
      date: held.hold.date,
      window: formatWindow(held.hold.localStart, held.hold.localEnd),
      held_for_minutes: minutes,
    },
    card: {
      kind: "hold",
      date: held.hold.date,
      start: held.hold.localStart,
      end: held.hold.localEnd,
      expiresAt: held.hold.expiresAt,
    },
  };
}

// Booking ---------------------------------------------------------------------------------------------------

export const createBookingSchema = z.strictObject({
  visit: visitSchema,
  full_name: nullableString(120).describe("Guests only; null for a signed-in client"),
  email: nullableString(200).describe("Guests only; null for a signed-in client"),
  phone: nullableString(30).describe("Guests only; null for a signed-in client"),
  address_line1: nullableString(160).describe(
    "Guests only; null for a signed-in client (their home on file is used)",
  ),
  address_line2: nullableString(80),
  city: nullableString(80),
  state: nullableString(2),
  access_notes: nullableString(500).describe("How the crew gets in, if the client said"),
  has_pets: z.boolean(),
  pet_notes: nullableString(500),
});

async function bookingCardData(bookingId: string, ctx: AssistantContext) {
  const booking = unwrap(
    await adminDb()
      .from("bookings")
      .select("number, status, arrival_window, total_cents, deposit_cents")
      .eq("id", bookingId)
      .single(),
    "load booking",
  );
  const window = parseRange(booking.arrival_window);
  const start = toLocal(window.start, ctx.catalog.tenant.timezone);
  return {
    booking,
    date: start.date,
    start: start.time,
    end: toLocal(window.end, ctx.catalog.tenant.timezone).time,
  };
}

export async function createBooking(
  ctx: AssistantContext,
  input: z.infer<typeof createBookingSchema>,
): Promise<ToolOutput> {
  const holdToken = await currentHold(ctx.conversationId);
  if (!holdToken) {
    throw new CommandError("hold_expired", "No window is held. Use hold_slot first.");
  }
  const request = toQuoteRequest(input.visit);

  let placed;
  if (ctx.client && ctx.userId) {
    const { data: home } = await adminDb()
      .from("properties")
      .select("id, zip")
      .eq("client_id", ctx.client.clientId)
      .eq("zip", input.visit.zip)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!home) {
      throw new CommandError(
        "invalid_input",
        "The client has no home on file with this ZIP code. Book a new address on the booking page.",
      );
    }
    placed = await placeHeldBookingForClient(ctx.catalog, request, holdToken, {
      clientId: ctx.client.clientId,
      propertyId: home.id,
      userId: ctx.userId,
    });
  } else {
    placed = await placeHeldBooking(
      ctx.catalog,
      {
        quote: request,
        contact: {
          fullName: input.full_name ?? "",
          email: input.email ?? "",
          phone: input.phone ?? "",
        },
        address: {
          line1: input.address_line1 ?? "",
          line2: input.address_line2 ?? "",
          city: input.city ?? "",
          state: input.state ?? "",
          zip: input.visit.zip,
        },
        notes: {
          hasPets: input.has_pets,
          petNotes: input.pet_notes ?? "",
          accessNotes: input.access_notes ?? "",
          parkingNotes: "",
        },
      },
      holdToken,
      { kind: "ai", userId: null, source: "ai" },
    );
  }
  await adminDb()
    .from("ai_conversations")
    .update({ hold_token: null, booking_id: placed.bookingId })
    .eq("id", ctx.conversationId);

  // A signed-in client's saved card pays the deposit at once; a guest pays through the link.
  let paidWithSavedCard = false;
  if (ctx.client) {
    const { data } = await adminDb()
      .from("bookings")
      .select("deposit_cents")
      .eq("id", placed.bookingId)
      .single();
    if (data && data.deposit_cents > 0) {
      const charge = await chargeSavedCard({
        bookingId: placed.bookingId,
        purpose: "deposit",
        amountCents: data.deposit_cents,
        description: `Deposit for booking #${placed.number}`,
      });
      paidWithSavedCard = charge.status === "succeeded";
      if (paidWithSavedCard) {
        await afterPaymentEvent({
          applied: true,
          bookingId: placed.bookingId,
          bookingStatus: "confirmed",
          paymentStatus: "succeeded",
        });
      }
    }
  }

  const { booking, date, start, end } = await bookingCardData(placed.bookingId, ctx);
  const token = bookingAccessToken(placed.bookingId);
  const status = booking.status === "confirmed" ? "confirmed" : "pending_payment";
  const payUrl =
    status === "pending_payment"
      ? `${appUrl}/${ctx.catalog.tenant.slug}/pay/${placed.bookingId}?t=${token}`
      : null;
  return {
    bookingId: placed.bookingId,
    result: {
      booking_number: booking.number,
      status,
      date: formatDate(date, "long"),
      arrival_window: formatWindow(start, end),
      total: money(ctx, booking.total_cents),
      deposit: money(ctx, booking.deposit_cents),
      ...(status === "pending_payment"
        ? {
            next_step: `Reserved, not yet confirmed. The client confirms it by paying the deposit at the payment link (shown to them in the chat) within ${ctx.catalog.schedule.rules.payment_window_minutes} minutes.`,
          }
        : {
            next_step: paidWithSavedCard
              ? "Confirmed. The deposit was charged to the saved card."
              : "Confirmed.",
          }),
    },
    card: {
      kind: "booking",
      number: booking.number,
      status,
      date,
      start,
      end,
      totalCents: booking.total_cents,
      depositCents: booking.deposit_cents,
      payUrl,
      bookingUrl: `${appUrl}/${ctx.catalog.tenant.slug}/bookings/${placed.bookingId}?t=${token}`,
    },
  };
}

// Signed-in client: visits, reschedule, cancel ---------------------------------------------------------------

function requireClient(ctx: AssistantContext): { client: ClientContext; userId: string } {
  if (!ctx.client || !ctx.userId) {
    throw new CommandError(
      "forbidden",
      "Only a signed-in client can do this. They can sign in at the client portal.",
    );
  }
  return { client: ctx.client, userId: ctx.userId };
}

export const listMyVisitsSchema = z.strictObject({});

export async function listMyVisits(ctx: AssistantContext): Promise<ToolOutput> {
  const { client } = requireClient(ctx);
  const rows = unwrap(
    await adminDb()
      .from("bookings")
      .select(
        "number, status, arrival_window, total_cents, recurring_plan_id, service:services!inner(name)",
      )
      .eq("client_id", client.clientId)
      .in("status", ["confirmed", "pending_payment"])
      .overlaps("arrival_window", `[${new Date().toISOString()},infinity)`)
      .order("arrival_window")
      .limit(10),
    "load visits",
  );
  return {
    result: {
      client: client.fullName,
      upcoming_visits: rows.map((b) => {
        const w = parseRange(b.arrival_window);
        const s = toLocal(w.start, ctx.catalog.tenant.timezone);
        return {
          booking_number: b.number,
          service: b.service.name,
          date: formatDate(s.date, "long"),
          arrival_window: formatWindow(s.time, toLocal(w.end, ctx.catalog.tenant.timezone).time),
          price: money(ctx, b.total_cents),
          status: b.status,
          regular_plan_visit: b.recurring_plan_id !== null,
        };
      }),
    },
  };
}

async function ownBookingId(ctx: AssistantContext, number: number): Promise<string> {
  const { client } = requireClient(ctx);
  const { data } = await adminDb()
    .from("bookings")
    .select("id")
    .eq("number", number)
    .eq("client_id", client.clientId)
    .maybeSingle();
  if (!data)
    throw new CommandError("not_found", `Booking #${number} is not one of this client's bookings.`);
  return data.id;
}

export const rescheduleSchema = z.strictObject({
  booking_number: z.int().positive(),
  date: z.iso.date(),
  window_start: z.string().regex(/^\d{2}:\d{2}$/),
  confirm: z
    .boolean()
    .describe("false: only report the fee; true: move the visit (after the client agreed)"),
});

export async function rescheduleMyBooking(
  ctx: AssistantContext,
  input: z.infer<typeof rescheduleSchema>,
): Promise<ToolOutput> {
  const { userId } = requireClient(ctx);
  const bookingId = await ownBookingId(ctx, input.booking_number);
  const fee = await previewChange(bookingId, "reschedule");
  if (!input.confirm) {
    return {
      result: { fee: money(ctx, fee.feeCents), policy: fee.explanation, ready_to_move: true },
    };
  }
  const moved = await rescheduleBooking(
    bookingId,
    { kind: "ai", userId },
    { date: input.date, localStart: input.window_start },
  );
  if (!moved.ok) return { result: { moved: false, reason: moved.message } };
  const end =
    ctx.catalog.schedule.rules.arrival_windows.find(([s]) => s === input.window_start)?.[1] ??
    input.window_start;
  return {
    bookingId,
    result: {
      moved: true,
      booking_number: input.booking_number,
      new_time: `${formatDate(input.date, "long")}, ${formatWindow(input.window_start, end)}`,
      fee_charged: money(ctx, moved.fee.feeCents),
    },
    card: {
      kind: "change",
      action: "rescheduled",
      number: input.booking_number,
      feeCents: moved.fee.feeCents,
      date: input.date,
      start: input.window_start,
      end,
    },
  };
}

export const cancelSchema = z.strictObject({
  booking_number: z.int().positive(),
  confirm: z
    .boolean()
    .describe("false: only report the fee; true: cancel (after the client agreed)"),
});

export async function cancelMyBooking(
  ctx: AssistantContext,
  input: z.infer<typeof cancelSchema>,
): Promise<ToolOutput> {
  const { userId } = requireClient(ctx);
  const bookingId = await ownBookingId(ctx, input.booking_number);
  const fee = await previewChange(bookingId, "cancel");
  if (!input.confirm) {
    return {
      result: {
        fee: money(ctx, fee.feeCents),
        policy: fee.explanation,
        deposit_refund: money(ctx, fee.refundCents),
        charged_to_card: money(ctx, fee.chargeCents),
      },
    };
  }
  const done = await cancelBooking(
    bookingId,
    { kind: "ai", userId },
    { reason: "Cancelled through the assistant" },
  );
  return {
    bookingId,
    result: {
      cancelled: true,
      booking_number: input.booking_number,
      fee: money(ctx, done.feeCents),
      deposit_refund: money(ctx, done.refundCents),
    },
    card: {
      kind: "change",
      action: "cancelled",
      number: input.booking_number,
      feeCents: done.feeCents,
    },
  };
}

// Hand-off ----------------------------------------------------------------------------------------------------

export const handoffSchema = z.strictObject({
  reason: z.string().max(200).describe("Why a person should take over"),
  summary: z.string().max(800).describe("What the client wants, with any details they gave"),
});

export async function handoffToHuman(
  ctx: AssistantContext,
  input: z.infer<typeof handoffSchema>,
): Promise<ToolOutput> {
  const db = adminDb();
  unwrap(
    await db
      .from("dispatch_alerts")
      .insert({
        tenant_id: ctx.catalog.tenant.id,
        kind: "handoff",
        conversation_id: ctx.conversationId,
        message: `AI hand-off: ${input.reason}. ${input.summary}`.slice(0, 1000),
      })
      .select("id"),
    "create hand-off",
  );
  await db.from("ai_conversations").update({ handed_off: true }).eq("id", ctx.conversationId);
  return {
    result: {
      handed_off: true,
      next_step: `The office has the conversation and will reply. Hours and phone are in get_business_info.`,
    },
    card: { kind: "handoff" },
  };
}
