import { occupancy } from "@/domain/availability";
import { cancellationFee, settleFee } from "@/domain/cancellation";
import { quote, type Quote, type QuoteRequest } from "@/domain/quote";
import type { CancellationRules, PricingRules, ScheduleRules } from "@/domain/rules";
import { expandSeries, type PlanFrequency } from "@/domain/series";
import {
  addDays,
  addMinutes,
  minutesOfDay,
  toInstant,
  weekdayOf,
  type Instant,
  type LocalDate,
} from "@/domain/time";

/**
 * Generates the demo business's history and near future relative to "today": eight weeks of past visits
 * (completed, a few cancelled or locked out), three weeks of upcoming ones, regular plans, payments and an
 * open payment alert. Every price comes from quote() and every fee from cancellationFee(), so the demo data
 * follows the same rules as live bookings. Deterministic for a given "today", so the nightly reset always
 * rebuilds the same story shifted to the current date.
 */

export type HistoryClient = {
  id: string;
  propertyId: string;
  fullName: string;
  home: {
    bedrooms: number;
    fullBaths: number;
    halfBaths: number;
    sqft: number;
  };
  zip: string;
};

export type HistoryInput = {
  today: LocalDate;
  now: Instant;
  timeZone: string;
  crews: { key: string; id: string }[];
  clients: HistoryClient[];
  serviceIds: Record<string, string>;
  rules: {
    pricing: { id: string; rules: PricingRules };
    schedule: { id: string; rules: ScheduleRules };
    cancellation: { id: string; rules: CancellationRules };
  };
  staff: { dispatcherId: string };
};

export type PlanSpec = {
  client: string;
  frequency: PlanFrequency;
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
  window: string;
  crew: string;
  recentlyCleaned: boolean;
};

const PAST_DAYS = 56;
const FUTURE_DAYS = 21;

type Source = "web" | "portal" | "admin" | "ai" | "plan";
type Status = "confirmed" | "completed" | "no_access" | "cancelled";

export type HistoryBooking = {
  id: string;
  clientId: string;
  propertyId: string;
  serviceId: string;
  crewId: string;
  status: Status;
  arrivalStart: Instant;
  arrivalEnd: Instant;
  busyStart: Instant;
  busyEnd: Instant;
  durationMinutes: number;
  quote: Quote & {
    rules: { pricing: number; schedule: number; cancellation: number };
  };
  totalCents: number;
  depositCents: number;
  source: Source;
  createdAt: Instant;
  confirmedAt: Instant;
  completedAt: Instant | null;
  cancelledAt: Instant | null;
  cancelReason: string | null;
  feeCents: number;
  planIndex: number | null;
  occurrenceDate: LocalDate | null;
};

export type HistoryPayment = {
  bookingIndex: number;
  purpose: "deposit" | "card_setup" | "balance" | "cancellation_fee" | "no_access_fee";
  amountCents: number;
  status: "succeeded" | "failed";
  offSession: boolean;
  at: Instant;
  failureCode?: string;
  refundCents?: number;
};

export type HistoryPlan = {
  spec: PlanSpec;
  clientId: string;
  propertyId: string;
  crewId: string;
  firstDate: LocalDate;
  windowStart: string;
  windowEnd: string;
  quote: Quote;
  priceCents: number;
  durationMinutes: number;
  createdAt: Instant;
};

export type History = {
  plans: HistoryPlan[];
  bookings: HistoryBooking[];
  payments: HistoryPayment[];
  timeOff: { crewId: string; start: Instant; end: Instant; note: string }[];
  /** Clients whose saved card fails off-session charges (Stripe's 0341 test card). */
  badCardClientIds: string[];
};

/** A small seeded random generator (mulberry32): the same "today" always yields the same history. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuidFrom(rand: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function generateHistory(
  input: HistoryInput,
  plans: PlanSpec[],
  badCardClients: string[],
): History {
  const rand = random(20261009);
  const { pricing, schedule, cancellation } = input.rules;
  const tz = input.timeZone;
  const crewId = (key: string) => input.crews.find((c) => c.key === key)!.id;
  const clientByName = (name: string) => input.clients.find((c) => c.fullName === name)!;
  const versions = { pricing: 1, schedule: 1, cancellation: 1 };
  const windowEndOf = (start: string) =>
    schedule.rules.arrival_windows.find(([s]) => s === start)![1];

  const bookings: HistoryBooking[] = [];
  const payments: HistoryPayment[] = [];
  /** crewId → date → minute of day the crew is free again */
  const freeAt = new Map<string, number>();
  const key = (crew: string, date: string) => `${crew}|${date}`;

  const isOpen = (date: LocalDate) =>
    schedule.rules.business_hours[weekdayOf(date)] !== null &&
    !schedule.rules.closed_dates.includes(date);

  // Crew Amber takes a day off next week (the dispatcher entered it in the admin console).
  let offDate = addDays(input.today, 6);
  while (!isOpen(offDate)) offDate = addDays(offDate, 1);
  const timeOff = [
    {
      crewId: crewId("amber"),
      start: toInstant(offDate, "00:00", tz),
      end: toInstant(addDays(offDate, 1), "00:00", tz),
      note: "Training day",
    },
  ];
  freeAt.set(key(crewId("amber"), offDate), 24 * 60);

  /** Nothing in the history can have happened after "now". */
  function notAfterNow(at: Instant): Instant {
    return at > input.now ? addMinutes(input.now, -30 - Math.floor(rand() * 60 * 24 * 3)) : at;
  }

  function statusFor(date: LocalDate): Status {
    if (date >= input.today) return rand() < 0.04 ? "cancelled" : "confirmed";
    const r = rand();
    return r < 0.07 ? "cancelled" : r < 0.1 ? "no_access" : "completed";
  }

  function place(
    q: Quote,
    client: HistoryClient,
    crew: string,
    date: LocalDate,
    start: string,
    source: Source,
    plan: { index: number; occurrence: LocalDate } | null,
    visit: "first" | "recurring" = "first",
  ): number | null {
    const price = visit === "recurring" && q.recurringVisit ? q.recurringVisit : q.firstVisit;
    const end = windowEndOf(start);
    const [, close] = schedule.rules.business_hours[weekdayOf(date)]!;
    if (minutesOfDay(end) + price.durationMinutes > minutesOfDay(close)) return null;
    if ((freeAt.get(key(crew, date)) ?? 0) > minutesOfDay(start)) return null;

    const arrivalStart = toInstant(date, start, tz);
    const arrivalEnd = toInstant(date, end, tz);
    const busy = occupancy(
      arrivalStart,
      arrivalEnd,
      price.durationMinutes,
      schedule.rules.travel_buffer_minutes,
    );
    freeAt.set(
      key(crew, date),
      minutesOfDay(end) + price.durationMinutes + schedule.rules.travel_buffer_minutes,
    );

    const status = statusFor(date);
    const leadDays = 2 + Math.floor(rand() * 12);
    const createdAt = notAfterNow(
      addMinutes(arrivalStart, -60 * 24 * leadDays - Math.floor(rand() * 600)),
    );
    const completedAt =
      status === "completed" || status === "no_access"
        ? addMinutes(arrivalStart, 30 + price.durationMinutes)
        : null;

    let cancelledAt: Instant | null = null;
    let feeCents = 0;
    let cancelReason: string | null = null;
    if (status === "cancelled") {
      const late = date < input.today && rand() < 0.5;
      cancelledAt = notAfterNow(
        addMinutes(arrivalStart, -60 * (late ? 20 : 50 + Math.floor(rand() * 72))),
      );
      if (cancelledAt < createdAt) cancelledAt = addMinutes(createdAt, 60);
      feeCents = cancellationFee(
        cancellation.rules,
        { totalCents: price.totalCents, arrivalStart },
        "cancel",
        cancelledAt,
      ).feeCents;
      cancelReason = late ? "Schedule conflict" : "Plans changed";
    }
    if (status === "no_access") {
      feeCents = cancellationFee(
        cancellation.rules,
        { totalCents: price.totalCents, arrivalStart },
        "no_access",
        arrivalStart,
      ).feeCents;
    }

    const depositCents = plan ? 0 : q.depositCents;
    bookings.push({
      id: uuidFrom(rand),
      clientId: client.id,
      propertyId: client.propertyId,
      serviceId: input.serviceIds[price.service]!,
      crewId: crew,
      status,
      arrivalStart,
      arrivalEnd,
      busyStart: busy.start,
      busyEnd: busy.end,
      durationMinutes: price.durationMinutes,
      quote: { ...q, rules: versions },
      totalCents: price.totalCents,
      depositCents,
      source,
      createdAt,
      confirmedAt: addMinutes(createdAt, 3),
      completedAt,
      cancelledAt,
      cancelReason,
      feeCents,
      planIndex: plan?.index ?? null,
      occurrenceDate: plan?.occurrence ?? null,
    });
    return bookings.length - 1;
  }

  // Regular plans first: their crew and time are fixed.
  const historyPlans: HistoryPlan[] = [];
  plans.forEach((spec, index) => {
    const client = clientByName(spec.client);
    const request: QuoteRequest = {
      service: "standard",
      home: client.home,
      zip: client.zip,
      frequency: spec.frequency,
      recentlyCleaned: spec.recentlyCleaned,
    };
    const priced = quote(pricing.rules, request);
    if (!priced.ok) throw new Error(`plan for ${spec.client}: ${priced.error.message}`);
    let firstDate = addDays(input.today, -PAST_DAYS);
    while (weekdayOf(firstDate) !== spec.weekday) firstDate = addDays(firstDate, 1);

    const plan: HistoryPlan = {
      spec,
      clientId: client.id,
      propertyId: client.propertyId,
      crewId: crewId(spec.crew),
      firstDate,
      windowStart: spec.window,
      windowEnd: windowEndOf(spec.window),
      quote: priced.quote,
      priceCents: priced.quote.recurringVisit!.totalCents,
      durationMinutes: priced.quote.recurringVisit!.durationMinutes,
      createdAt: addMinutes(toInstant(firstDate, "09:00", tz), -60 * 24 * 5),
    };
    historyPlans.push(plan);

    const visits = expandSeries(
      {
        frequency: spec.frequency,
        firstDate,
        windowStart: plan.windowStart,
        windowEnd: plan.windowEnd,
        timeZone: tz,
      },
      {
        from: firstDate,
        through: addDays(input.today, FUTURE_DAYS),
        closedDates: schedule.rules.closed_dates,
      },
    );
    visits
      .filter((visit) => !visit.closed)
      .forEach((visit, n) => {
        const placed = place(
          priced.quote,
          client,
          plan.crewId,
          visit.date,
          spec.window,
          "plan",
          {
            index,
            occurrence: visit.date,
          },
          n === 0 ? "first" : "recurring",
        );
        if (placed === null) return;
        const booking = bookings[placed]!;
        booking.createdAt =
          n === 0 ? plan.createdAt : notAfterNow(addMinutes(booking.arrivalStart, -60 * 24 * 30));
        booking.confirmedAt = addMinutes(booking.createdAt, 2);
        if (n === 0) {
          payments.push({
            bookingIndex: placed,
            purpose: "card_setup",
            amountCents: 0,
            status: "succeeded",
            offSession: false,
            at: booking.confirmedAt,
          });
        }
      });
  });

  // One-time visits fill the remaining crew time.
  const oneTimeClients = input.clients.filter((c) => !plans.some((p) => p.client === c.fullName));
  const crews = input.crews.map((c) => c.id);
  let next = 0;
  const sources: Source[] = [
    "web",
    "web",
    "web",
    "web",
    "portal",
    "portal",
    "admin",
    "admin",
    "ai",
    "ai",
  ];

  for (let d = -PAST_DAYS; d <= FUTURE_DAYS; d++) {
    const date = addDays(input.today, d);
    if (!isOpen(date)) continue;
    // Busy recent weeks and a full next week, thinning out further ahead (people book 1-2 weeks out).
    const fillRate = d < 0 ? 0.72 : d <= 7 ? 0.8 : d <= 14 ? 0.5 : 0.3;
    for (const crew of crews) {
      for (const [start] of schedule.rules.arrival_windows) {
        if (rand() > fillRate) continue;
        const client = oneTimeClients[next % oneTimeClients.length]!;
        const roll = rand();
        const service = roll < 0.65 ? "standard" : roll < 0.9 ? "deep" : "move_in_out";
        const addons: Record<string, number> = {};
        if (rand() < 0.3) addons.fridge = 1;
        if (rand() < 0.2) addons.oven = 1;
        if (rand() < 0.15) addons.windows_inside = 4 + Math.floor(rand() * 10);
        const request: QuoteRequest = {
          service,
          home: client.home,
          zip: client.zip,
          addons,
          emptyHome: service === "move_in_out",
          condition: rand() < 0.08 ? "heavy" : "normal",
        };
        const priced = quote(pricing.rules, request);
        if (!priced.ok) continue;
        const placed = place(
          priced.quote,
          client,
          crew,
          date,
          start,
          sources[Math.floor(rand() * sources.length)]!,
          null,
        );
        if (placed === null) continue;
        next += 1;
        const booking = bookings[placed]!;
        payments.push({
          bookingIndex: placed,
          purpose: "deposit",
          amountCents: booking.depositCents,
          status: "succeeded",
          offSession: false,
          at: booking.confirmedAt,
        });
      }
    }
  }

  // Money after the visit, fees and refunds.
  const badCardIds = badCardClients.map((name) => clientByName(name).id);
  const lastBadCardVisit = new Map<string, number>();
  bookings.forEach((booking, index) => {
    if (booking.status === "completed" && badCardIds.includes(booking.clientId)) {
      lastBadCardVisit.set(booking.clientId, index);
    }
  });

  bookings.forEach((booking, index) => {
    const paid = booking.depositCents;
    if (booking.status === "completed") {
      const failed = [...lastBadCardVisit.values()].includes(index);
      payments.push({
        bookingIndex: index,
        purpose: "balance",
        amountCents: booking.totalCents - paid,
        status: failed ? "failed" : "succeeded",
        failureCode: failed ? "card_declined" : undefined,
        offSession: true,
        at: booking.completedAt!,
      });
    } else if (booking.status === "cancelled" || booking.status === "no_access") {
      const { refundCents, chargeCents } = settleFee(booking.feeCents, paid);
      const at = booking.cancelledAt ?? booking.completedAt!;
      if (refundCents > 0) {
        const deposit = payments.find((p) => p.bookingIndex === index && p.purpose === "deposit");
        if (deposit) deposit.refundCents = refundCents;
      }
      if (chargeCents > 0) {
        payments.push({
          bookingIndex: index,
          purpose: booking.status === "no_access" ? "no_access_fee" : "cancellation_fee",
          amountCents: chargeCents,
          status: "succeeded",
          offSession: true,
          at,
        });
      }
    }
  });

  return {
    plans: historyPlans,
    bookings,
    payments,
    timeOff,
    badCardClientIds: badCardIds,
  };
}
