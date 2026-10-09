import type { Cents } from "./money";

/**
 * Business reports from bookings and payments in a period. Pure: the server loads the rows (through the
 * owner's session, so row-level security scopes them to the business) and this computes the numbers.
 */

export type ReportBooking = {
  id: string;
  status: "pending_payment" | "confirmed" | "completed" | "no_access" | "cancelled" | "expired";
  source: "web" | "portal" | "admin" | "ai" | "plan";
  service: string;
  crewId: string;
  zone: string;
  clientId: string;
  planId: string | null;
  totalCents: Cents;
  depositCents: Cents;
  durationMinutes: number;
  /** Business-local date of the visit and the Monday of its week. */
  date: string;
  week: string;
  createdInPeriod: boolean;
};

export type ReportPayment = {
  bookingId: string;
  purpose: "deposit" | "card_setup" | "balance" | "cancellation_fee" | "no_access_fee";
  status: string;
  netCents: Cents;
};

export type Breakdown = { key: string; cents: Cents; visits: number }[];

export type Report = {
  earnedCents: Cents;
  visitsCompleted: number;
  averageTicketCents: Cents;
  byService: Breakdown;
  byZone: Breakdown;
  byCrew: Breakdown;
  weekly: { week: string; cents: Cents; visits: number }[];
  prepaid: { depositCents: Cents; oneTimeRevenueCents: Cents; share: number };
  cancellations: {
    cancelled: number;
    lockouts: number;
    total: number;
    rate: number;
    feesCents: Cents;
  };
  utilization: { crewId: string; bookedMinutes: number; availableMinutes: number; share: number }[];
  retention: {
    activePlans: number;
    repeatClients: number;
    clientsServed: number;
    repeatShare: number;
  };
  sources: { source: ReportBooking["source"]; bookings: number; share: number }[];
  aiShare: number;
};

function breakdown(rows: ReportBooking[], key: (b: ReportBooking) => string): Breakdown {
  const map = new Map<string, { cents: Cents; visits: number }>();
  for (const row of rows) {
    const entry = map.get(key(row)) ?? { cents: 0, visits: 0 };
    entry.cents += row.totalCents;
    entry.visits += 1;
    map.set(key(row), entry);
  }
  return [...map.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.cents - a.cents);
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export function buildReport(input: {
  bookings: ReportBooking[];
  payments: ReportPayment[];
  /** Working minutes per crew in the period (opening hours minus time off). */
  availableMinutes: Map<string, number>;
  activePlans: number;
}): Report {
  const { bookings, payments } = input;
  const completed = bookings.filter((b) => b.status === "completed");
  const fees = payments.filter(
    (p) =>
      p.status === "succeeded" &&
      (p.purpose === "cancellation_fee" || p.purpose === "no_access_fee"),
  );
  const feesCents = fees.reduce((s, p) => s + p.netCents, 0);
  const earnedCents = completed.reduce((s, b) => s + b.totalCents, 0) + feesCents;

  const weeks = new Map<string, { cents: Cents; visits: number }>();
  for (const b of completed) {
    const w = weeks.get(b.week) ?? { cents: 0, visits: 0 };
    w.cents += b.totalCents;
    w.visits += 1;
    weeks.set(b.week, w);
  }

  const oneTime = completed.filter((b) => b.planId === null);
  const oneTimeIds = new Set(oneTime.map((b) => b.id));
  const depositCents = payments
    .filter(
      (p) => p.purpose === "deposit" && p.status === "succeeded" && oneTimeIds.has(p.bookingId),
    )
    .reduce((s, p) => s + p.netCents, 0);
  const oneTimeRevenueCents = oneTime.reduce((s, b) => s + b.totalCents, 0);

  const settled = bookings.filter((b) => b.status !== "expired" && b.status !== "pending_payment");
  const cancelled = settled.filter((b) => b.status === "cancelled").length;
  const lockouts = settled.filter((b) => b.status === "no_access").length;

  const busy = new Map<string, number>();
  for (const b of bookings) {
    if (b.status === "completed" || b.status === "no_access" || b.status === "confirmed") {
      busy.set(b.crewId, (busy.get(b.crewId) ?? 0) + b.durationMinutes);
    }
  }

  const visitsByClient = new Map<string, number>();
  for (const b of completed)
    visitsByClient.set(b.clientId, (visitsByClient.get(b.clientId) ?? 0) + 1);
  const repeatClients = [...visitsByClient.values()].filter((n) => n >= 2).length;

  const created = bookings.filter((b) => b.createdInPeriod && b.status !== "expired");
  const sourceCounts = new Map<ReportBooking["source"], number>();
  for (const b of created) sourceCounts.set(b.source, (sourceCounts.get(b.source) ?? 0) + 1);

  return {
    earnedCents,
    visitsCompleted: completed.length,
    averageTicketCents: completed.length
      ? Math.round(completed.reduce((s, b) => s + b.totalCents, 0) / completed.length)
      : 0,
    byService: breakdown(completed, (b) => b.service),
    byZone: breakdown(completed, (b) => b.zone),
    byCrew: breakdown(completed, (b) => b.crewId),
    weekly: [...weeks.entries()]
      .map(([week, v]) => ({ week, ...v }))
      .sort((a, b) => a.week.localeCompare(b.week)),
    prepaid: { depositCents, oneTimeRevenueCents, share: share(depositCents, oneTimeRevenueCents) },
    cancellations: {
      cancelled,
      lockouts,
      total: settled.length,
      rate: share(cancelled + lockouts, settled.length),
      feesCents,
    },
    utilization: [...input.availableMinutes.entries()].map(([crewId, availableMinutes]) => ({
      crewId,
      bookedMinutes: busy.get(crewId) ?? 0,
      availableMinutes,
      share: share(busy.get(crewId) ?? 0, availableMinutes),
    })),
    retention: {
      activePlans: input.activePlans,
      repeatClients,
      clientsServed: visitsByClient.size,
      repeatShare: share(repeatClients, visitsByClient.size),
    },
    sources: (["web", "portal", "admin", "ai", "plan"] as const).map((source) => ({
      source,
      bookings: sourceCounts.get(source) ?? 0,
      share: share(sourceCounts.get(source) ?? 0, created.length),
    })),
    aiShare: share(sourceCounts.get("ai") ?? 0, created.filter((b) => b.source !== "plan").length),
  };
}
