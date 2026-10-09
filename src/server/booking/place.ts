import "server-only";

import { occupancy } from "@/domain/availability";
import { bookingRequestSchema, type BookingRequestInput } from "@/domain/booking-request";
import { quote, type Quote } from "@/domain/quote";
import { addMinutes, minutesOfDay, toLocal } from "@/domain/time";

import type { Catalog } from "../catalog";
import { nullable } from "../db/args";
import { adminDb } from "../db/admin";
import { CommandError, unwrap } from "../db/errors";
import { parseRange, toRange } from "../db/ranges";

/** The snapshot stored on a booking: the quote plus the rule versions that produced it. */
export function quoteSnapshot(catalog: Catalog, q: Quote) {
  return {
    ...q,
    rules: {
      pricing: catalog.pricing.version,
      schedule: catalog.schedule.version,
      cancellation: catalog.cancellation.version,
    },
  };
}

export type PlacedBooking = {
  bookingId: string;
  number: number;
  clientId: string;
  paymentDueBy: string;
};

/**
 * Turns a guest's held window into a booking waiting for payment. The price is computed again here from the
 * rules in force; nothing the browser sends about money is trusted.
 */
export async function placeHeldBooking(
  catalog: Catalog,
  input: BookingRequestInput,
  holdToken: string,
  actor: { kind: "guest" | "ai"; userId: null; source: "web" | "ai" },
): Promise<PlacedBooking> {
  const request = bookingRequestSchema.parse(input);
  const priced = quote(catalog.pricing.rules, request.quote);
  if (!priced.ok) throw new CommandError("invalid_input", priced.error.message);
  const q = priced.quote;

  const service = catalog.services.find((s) => s.code === q.firstVisit.service);
  const requested = catalog.services.find((s) => s.code === request.quote.service);
  if (!service || requested?.bookingMode !== "instant") {
    throw new CommandError("invalid_input", "This service cannot be booked online");
  }

  const db = adminDb();
  const hold = await db
    .from("crew_allocations")
    .select("busy, hold_expires_at")
    .eq("tenant_id", catalog.tenant.id)
    .eq("kind", "hold")
    .eq("hold_token", holdToken)
    .maybeSingle();
  if (!hold.data || Date.parse(hold.data.hold_expires_at!) <= Date.now()) {
    throw new CommandError("hold_expired", "The held time slot has expired");
  }

  // The hold starts at the arrival window; recompute the occupancy for the final duration.
  const held = parseRange(hold.data.busy);
  const local = toLocal(held.start, catalog.tenant.timezone);
  const schedule = catalog.schedule.rules;
  const arrival = schedule.arrival_windows.find(([start]) => start === local.time);
  const hours = schedule.business_hours[local.weekday];
  if (!arrival || !hours) {
    throw new CommandError("invalid_input", "The held time is not an arrival window");
  }
  const windowEnd = addMinutes(held.start, minutesOfDay(arrival[1]) - minutesOfDay(arrival[0]));
  if (minutesOfDay(arrival[1]) + q.firstVisit.durationMinutes > minutesOfDay(hours[1])) {
    throw new CommandError(
      "invalid_input",
      "This visit is too long for the chosen arrival window; pick an earlier one",
    );
  }
  const busy = occupancy(
    held.start,
    windowEnd,
    q.firstVisit.durationMinutes,
    schedule.travel_buffer_minutes,
  );
  const paymentDueBy = addMinutes(new Date().toISOString(), schedule.payment_window_minutes);

  const [row] = unwrap(
    await db.rpc("cmd_create_booking", {
      p_tenant_id: catalog.tenant.id,
      p_actor: nullable<string>(actor.userId),
      p_actor_kind: actor.kind,
      p_source: actor.source,
      p_status: "pending_payment",
      p_client: {
        full_name: request.contact.fullName,
        email: request.contact.email,
        phone: request.contact.phone,
      },
      p_property: {
        address_line1: request.address.line1,
        address_line2: request.address.line2,
        city: request.address.city,
        state: request.address.state,
        zip: request.address.zip,
        bedrooms: request.quote.home.bedrooms,
        full_baths: request.quote.home.fullBaths,
        half_baths: request.quote.home.halfBaths,
        sqft: request.quote.home.sqft,
        has_pets: request.notes.hasPets,
        pet_notes: request.notes.petNotes,
        access_notes: request.notes.accessNotes,
        parking_notes: request.notes.parkingNotes,
      },
      p_service_id: service.id,
      p_arrival_window: toRange(held.start, windowEnd),
      p_busy: toRange(busy.start, busy.end),
      p_duration_minutes: q.firstVisit.durationMinutes,
      p_quote: quoteSnapshot(catalog, q),
      p_total_cents: q.firstVisit.totalCents,
      p_deposit_cents: q.depositCents,
      p_pricing_version_id: catalog.pricing.id,
      p_cancellation_version_id: catalog.cancellation.id,
      p_hold_token: holdToken,
      p_payment_due_by: paymentDueBy,
    }),
    "create booking",
  );
  if (!row) throw new Error("create booking returned no row");

  return {
    bookingId: row.booking_id,
    number: row.booking_number,
    clientId: row.client_id,
    paymentDueBy,
  };
}
