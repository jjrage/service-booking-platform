import "server-only";

import { toLocal } from "@/domain/time";

import type { ClientContext } from "./auth/viewer";
import { unwrap } from "./db/errors";
import { parseRange } from "./db/ranges";
import { userDb } from "./db/user-client";

/**
 * What the client portal shows. Every read here goes through the signed-in client's own session, so
 * row-level security limits it to their bookings, homes, plans and payments.
 */

export type PortalVisit = {
  id: string;
  number: number;
  status: string;
  serviceName: string;
  date: string;
  localStart: string;
  localEnd: string;
  arrivalStart: string;
  durationMinutes: number;
  totalCents: number;
  depositCents: number;
  currency: string;
  address: string;
  planId: string | null;
};

const visitColumns =
  "id, number, status, arrival_window, duration_minutes, total_cents, deposit_cents, currency, recurring_plan_id, " +
  "service:services!inner(name), property:properties!inner(address_line1, address_line2, city, state, zip)";

type VisitRow = {
  id: string;
  number: number;
  status: string;
  arrival_window: string;
  duration_minutes: number;
  total_cents: number;
  deposit_cents: number;
  currency: string;
  recurring_plan_id: string | null;
  service: { name: string };
  property: {
    address_line1: string;
    address_line2: string | null;
    city: string;
    state: string;
    zip: string;
  };
};

function toVisit(row: VisitRow, timeZone: string): PortalVisit {
  const window = parseRange(row.arrival_window);
  const start = toLocal(window.start, timeZone);
  const end = toLocal(window.end, timeZone);
  const p = row.property;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    serviceName: row.service.name,
    date: start.date,
    localStart: start.time,
    localEnd: end.time,
    arrivalStart: window.start,
    durationMinutes: row.duration_minutes,
    totalCents: row.total_cents,
    depositCents: row.deposit_cents,
    currency: row.currency,
    address: [p.address_line1, p.address_line2, `${p.city}, ${p.state} ${p.zip}`]
      .filter(Boolean)
      .join(", "),
    planId: row.recurring_plan_id,
  };
}

export async function myVisits(client: ClientContext) {
  const db = await userDb();
  const rows = unwrap(
    await db
      .from("bookings")
      .select(visitColumns)
      .eq("client_id", client.clientId)
      .order("arrival_window", { ascending: true })
      .overrideTypes<VisitRow[], { merge: false }>(),
    "load visits",
  );
  const now = Date.now();
  const visits = rows.map((row) => toVisit(row, client.timezone));
  return {
    upcoming: visits.filter(
      (v) =>
        Date.parse(v.arrivalStart) >= now && ["confirmed", "pending_payment"].includes(v.status),
    ),
    past: visits
      .filter(
        (v) =>
          !(
            Date.parse(v.arrivalStart) >= now && ["confirmed", "pending_payment"].includes(v.status)
          ),
      )
      .reverse(),
  };
}

export type PortalPayment = {
  id: string;
  purpose: string;
  amountCents: number;
  refundedCents: number;
  status: string;
  at: string;
  bookingNumber: number;
  failureMessage: string | null;
};

export async function myVisit(client: ClientContext, bookingId: string) {
  const db = await userDb();
  const { data: row } = await db
    .from("bookings")
    .select(visitColumns)
    .eq("id", bookingId)
    .eq("client_id", client.clientId)
    .maybeSingle()
    .overrideTypes<VisitRow | null, { merge: false }>();
  if (!row) return null;

  const payments = unwrap(
    await db
      .from("payments")
      .select(
        "id, purpose, amount_cents, status, created_at, succeeded_at, failure_message, refunds(amount_cents, status)",
      )
      .eq("booking_id", bookingId)
      .order("created_at"),
    "load payments",
  );
  const visit = toVisit(row as VisitRow, client.timezone);
  return {
    visit,
    /** Still ahead and not settled: the client can move or cancel it. */
    changeable:
      ["confirmed", "pending_payment"].includes(visit.status) &&
      Date.parse(visit.arrivalStart) > Date.now(),
    payments: payments
      .filter((p) => p.purpose !== "card_setup")
      .map((p) => ({
        id: p.id,
        purpose: p.purpose,
        amountCents: p.amount_cents,
        refundedCents: p.refunds
          .filter((r) => r.status !== "failed")
          .reduce((sum, r) => sum + r.amount_cents, 0),
        status: p.status,
        at: p.succeeded_at ?? p.created_at,
        bookingNumber: (row as VisitRow).number,
        failureMessage: p.failure_message,
      })),
  };
}

export async function myPlans(client: ClientContext) {
  const db = await userDb();
  const plans = unwrap(
    await db
      .from("recurring_plans")
      .select(
        "id, frequency, status, paused_until, first_date, window_start_local, window_end_local, price_cents, duration_minutes, currency, service:services!inner(name), property:properties!inner(address_line1, city)",
      )
      .eq("client_id", client.clientId)
      .neq("status", "cancelled")
      .order("created_at"),
    "load plans",
  );
  const { upcoming } = await myVisits(client);
  return plans.map((plan) => ({
    id: plan.id,
    frequency: plan.frequency,
    status: plan.status,
    pausedUntil: plan.paused_until,
    windowStart: plan.window_start_local.slice(0, 5),
    windowEnd: plan.window_end_local.slice(0, 5),
    weekday: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(`${plan.first_date}T12:00:00Z`)),
    priceCents: plan.price_cents,
    durationMinutes: plan.duration_minutes,
    currency: plan.currency,
    serviceName: plan.service.name,
    address: `${plan.property.address_line1}, ${plan.property.city}`,
    nextVisits: upcoming.filter((v) => v.planId === plan.id).slice(0, 4),
  }));
}

export async function myBilling(client: ClientContext) {
  const db = await userDb();
  const [billing, payments] = await Promise.all([
    db
      .from("client_billing")
      .select("provider, card_brand, card_last4, card_exp_month, card_exp_year")
      .eq("client_id", client.clientId)
      .maybeSingle(),
    db
      .from("payments")
      .select(
        "id, purpose, amount_cents, status, created_at, succeeded_at, failure_message, booking:bookings!inner(number), refunds(amount_cents, status)",
      )
      .eq("client_id", client.clientId)
      .neq("purpose", "card_setup")
      .order("created_at", { ascending: false }),
  ]);
  return {
    card:
      billing.data?.card_brand && billing.data.card_last4
        ? {
            brand: billing.data.card_brand,
            last4: billing.data.card_last4,
            expMonth: billing.data.card_exp_month,
            expYear: billing.data.card_exp_year,
            provider: billing.data.provider,
          }
        : null,
    payments: unwrap(payments, "load payments").map((p): PortalPayment => ({
      id: p.id,
      purpose: p.purpose,
      amountCents: p.amount_cents,
      refundedCents: p.refunds
        .filter((r) => r.status !== "failed")
        .reduce((sum, r) => sum + r.amount_cents, 0),
      status: p.status,
      at: p.succeeded_at ?? p.created_at,
      bookingNumber: p.booking.number,
      failureMessage: p.failure_message,
    })),
  };
}

export async function myProfile(client: ClientContext) {
  const db = await userDb();
  const [profile, homes] = await Promise.all([
    db.from("clients").select("full_name, email, phone").eq("id", client.clientId).single(),
    db
      .from("properties")
      .select(
        "id, label, address_line1, address_line2, city, state, zip, bedrooms, full_baths, half_baths, sqft, has_pets, pet_notes, access_notes, parking_notes",
      )
      .eq("client_id", client.clientId)
      .order("created_at"),
  ]);
  return {
    profile: unwrap(profile, "load profile"),
    homes: unwrap(homes, "load homes"),
  };
}
