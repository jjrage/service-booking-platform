import "server-only";

import { toLocal } from "@/domain/time";

import { adminDb } from "../db/admin";
import { parseRange } from "../db/ranges";

/**
 * A booking as its guest sees it through the link in their e-mail. The caller has already checked the link's
 * signature; this read uses the service role and returns only what that page shows.
 */
export type GuestBooking = {
  id: string;
  number: number;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  timezone: string;
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
  paymentDueBy: string | null;
  frequency: string;
  recurringTotalCents: number | null;
  clientName: string;
  clientEmail: string;
  address: string;
  paidCents: number;
  card: { brand: string; last4: string } | null;
};

export async function loadGuestBooking(bookingId: string): Promise<GuestBooking | null> {
  const db = adminDb();
  const { data: booking } = await db
    .from("bookings")
    .select(
      "id, number, tenant_id, status, arrival_window, duration_minutes, total_cents, deposit_cents, currency, " +
        "payment_due_by, quote, client_id, " +
        "tenant:tenants!inner(slug, name, timezone), service:services!inner(name), " +
        "client:clients!inner(full_name, email), " +
        "property:properties!inner(address_line1, address_line2, city, state, zip)",
    )
    .eq("id", bookingId)
    .maybeSingle<{
      id: string;
      number: number;
      tenant_id: string;
      status: string;
      arrival_window: string;
      duration_minutes: number;
      total_cents: number;
      deposit_cents: number;
      currency: string;
      payment_due_by: string | null;
      quote: {
        frequency?: string;
        recurringVisit?: { totalCents: number } | null;
      };
      client_id: string;
      tenant: { slug: string; name: string; timezone: string };
      service: { name: string };
      client: { full_name: string; email: string };
      property: {
        address_line1: string;
        address_line2: string | null;
        city: string;
        state: string;
        zip: string;
      };
    }>();
  if (!booking) return null;

  const [payments, billing] = await Promise.all([
    db
      .from("payments")
      .select("amount_cents, status")
      .eq("booking_id", booking.id)
      .eq("status", "succeeded"),
    db
      .from("client_billing")
      .select("card_brand, card_last4")
      .eq("tenant_id", booking.tenant_id)
      .eq("client_id", booking.client_id)
      .maybeSingle(),
  ]);

  const window = parseRange(booking.arrival_window);
  const start = toLocal(window.start, booking.tenant.timezone);
  const end = toLocal(window.end, booking.tenant.timezone);
  const p = booking.property;

  return {
    id: booking.id,
    number: booking.number,
    tenantId: booking.tenant_id,
    tenantSlug: booking.tenant.slug,
    tenantName: booking.tenant.name,
    timezone: booking.tenant.timezone,
    status: booking.status,
    serviceName: booking.service.name,
    date: start.date,
    localStart: start.time,
    localEnd: end.time,
    arrivalStart: window.start,
    durationMinutes: booking.duration_minutes,
    totalCents: booking.total_cents,
    depositCents: booking.deposit_cents,
    currency: booking.currency,
    paymentDueBy: booking.payment_due_by,
    frequency: booking.quote.frequency ?? "one_time",
    recurringTotalCents: booking.quote.recurringVisit?.totalCents ?? null,
    clientName: booking.client.full_name,
    clientEmail: booking.client.email,
    address: [p.address_line1, p.address_line2, `${p.city}, ${p.state} ${p.zip}`]
      .filter(Boolean)
      .join(", "),
    paidCents: (payments.data ?? []).reduce((sum, row) => sum + row.amount_cents, 0),
    card:
      billing.data?.card_brand && billing.data.card_last4
        ? { brand: billing.data.card_brand, last4: billing.data.card_last4 }
        : null,
  };
}
