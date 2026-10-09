import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nextAvailable } from "@/domain/availability";
import { quote, type QuoteRequest } from "@/domain/quote";
import { addDays, toLocal } from "@/domain/time";
import { windowsFor } from "@/server/booking/availability";
import { holdWindow } from "@/server/booking/hold";
import { placeHeldBooking } from "@/server/booking/place";
import { loadCatalog, type Catalog } from "@/server/catalog";
import { stripeProvider } from "@/server/payments";
import { afterPaymentEvent } from "@/server/payments/after-event";
import {
  applyPaymentEvent,
  chargeSavedCard,
  refundPayment,
  startBookingCheckout,
} from "@/server/payments/service";

import { createTestTenant } from "../integration/test-tenant";

/**
 * The payment flows against Stripe in test mode: a deposit paid with a test card, the balance charged
 * off-session to the saved card, a partial refund, and a plan card that saves but then declines. It needs
 * test keys in .env.local and runs only by hand (`npm run test:stripe`).
 *
 * The browser part (the Payment Element) is replaced by confirming the intent with Stripe's test payment
 * methods on the server. The resulting event is fetched from Stripe, signed with the webhook secret and
 * passed through the same parsing and handling as the webhook route.
 */

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const enabled = secretKey.startsWith("sk_test_") && webhookSecret.startsWith("whsec_");

let stripe: Stripe;
let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;

const oneTime: QuoteRequest = {
  service: "standard",
  home: { bedrooms: 2, fullBaths: 1, halfBaths: 0, sqft: 1200 },
  zip: "27609",
};

async function bookAndHold(n: number, request: QuoteRequest) {
  const priced = quote(catalog.pricing.rules, request);
  if (!priced.ok) throw new Error(priced.error.message);
  const duration = priced.quote.firstVisit.durationMinutes;
  const today = toLocal(new Date().toISOString(), catalog.tenant.timezone).date;
  const days = await windowsFor(catalog, {
    from: addDays(today, 1),
    to: addDays(today, 21),
    durationMinutes: duration,
  });
  const [slot] = nextAvailable(days, 1);
  const held = await holdWindow(catalog, {
    date: slot!.date,
    localStart: slot!.localStart,
    durationMinutes: duration,
  });
  if (!held.ok) throw new Error(held.message);
  return placeHeldBooking(
    catalog,
    {
      quote: request,
      contact: {
        fullName: `Stripe Test ${n}`,
        email: `stripe${n}@it.example`,
        phone: "919-555-0188",
      },
      address: { line1: `${n} Card Ln`, city: "Raleigh", state: "nc", zip: request.zip },
      notes: {},
    },
    held.hold.token,
    { kind: "guest", userId: null, source: "web" },
  );
}

/** Delivers Stripe's event for an intent as the webhook route would. */
async function deliver(intentId: string, type: string) {
  let event: Stripe.Event | undefined;
  for (let i = 0; i < 20 && !event; i++) {
    const { data } = await stripe.events.list({ type, limit: 20 });
    event = data.find((e) => (e.data.object as { id?: string }).id === intentId);
    if (!event) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!event) throw new Error(`no ${type} event for ${intentId}`);
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const parsed = await stripeProvider()!.parseWebhook(payload, signature, webhookSecret);
  // With `stripe listen` running, the app may have applied it already; applying again changes nothing.
  await afterPaymentEvent(await applyPaymentEvent(parsed!));
}

async function bookingStatus(bookingId: string) {
  const { data } = await tenant.admin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single();
  return data?.status;
}

beforeAll(async () => {
  if (!enabled) return;
  stripe = new Stripe(secretKey);
  tenant = await createTestTenant({ crews: 2 });
  catalog = (await loadCatalog(tenant.slug))!;
}, 60_000);

afterAll(async () => {
  if (!enabled) return;
  await tenant?.cleanup();
});

describe.skipIf(!enabled)("payments in Stripe test mode", { timeout: 120_000 }, () => {
  it("takes a deposit, charges the balance off-session and refunds part of the deposit", async () => {
    const placed = await bookAndHold(1, oneTime);
    const session = await startBookingCheckout(placed.bookingId);
    expect(session).toMatchObject({ provider: "stripe", mode: "payment" });

    // What the Payment Element does in the browser, with Stripe's test Visa.
    const intent = await stripe.paymentIntents.confirm(session.paymentRef, {
      payment_method: "pm_card_visa",
      return_url: "http://localhost:3000/",
    });
    expect(intent.status).toBe("succeeded");
    await deliver(intent.id, "payment_intent.succeeded");
    expect(await bookingStatus(placed.bookingId)).toBe("confirmed");

    const { data: deposit } = await tenant.admin
      .from("payments")
      .select("id, status")
      .eq("booking_id", placed.bookingId)
      .eq("purpose", "deposit")
      .single();
    expect(deposit?.status).toBe("succeeded");
    // The card is saved for later charges.
    const { data: billing } = await tenant.admin
      .from("client_billing")
      .select("card_brand, card_last4")
      .eq("tenant_id", tenant.tenantId)
      .single();
    expect(billing).toEqual({ card_brand: "visa", card_last4: "4242" });

    const balance = await chargeSavedCard({
      bookingId: placed.bookingId,
      purpose: "balance",
      amountCents: 10000,
      description: "Balance after the visit",
    });
    expect(balance.status).toBe("succeeded");

    const refund = await refundPayment({
      paymentId: deposit!.id,
      amountCents: 1000,
      reason: "Goodwill",
      actor: { userId: null, kind: "system" },
    });
    expect(refund.status).toBe("succeeded");
  });

  it("saves a plan's card without charging; a later decline alerts the office", async () => {
    const placed = await bookAndHold(2, {
      ...oneTime,
      frequency: "biweekly",
      recentlyCleaned: true,
    });
    const session = await startBookingCheckout(placed.bookingId);
    expect(session).toMatchObject({ provider: "stripe", mode: "setup" });

    // A card that saves fine but declines every later charge.
    const setup = await stripe.setupIntents.confirm(session.paymentRef, {
      payment_method: "pm_card_chargeCustomerFail",
      return_url: "http://localhost:3000/",
    });
    expect(setup.status).toBe("succeeded");
    await deliver(setup.id, "setup_intent.succeeded");
    expect(await bookingStatus(placed.bookingId)).toBe("confirmed");

    const charge = await chargeSavedCard({
      bookingId: placed.bookingId,
      purpose: "balance",
      amountCents: 15000,
      description: "Visit",
    });
    // Stripe reports the specific decline reason (generic_decline for this test card).
    expect(charge.status).toBe("failed");
    expect(charge.failureCode).toBeTruthy();

    const { count } = await tenant.admin
      .from("dispatch_alerts")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", placed.bookingId)
      .eq("kind", "payment_failed");
    expect(count).toBe(1);
  });
});
