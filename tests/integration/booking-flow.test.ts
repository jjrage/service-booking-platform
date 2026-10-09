import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nextAvailable } from "@/domain/availability";
import { quote, type QuoteRequest } from "@/domain/quote";
import { addDays, toLocal } from "@/domain/time";
import { loadCatalog, type Catalog } from "@/server/catalog";
import { windowsFor } from "@/server/booking/availability";
import { holdWindow } from "@/server/booking/hold";
import { placeHeldBooking } from "@/server/booking/place";
import { CommandError } from "@/server/db/errors";
import {
  applyPaymentEvent,
  chargeSavedCard,
  completeSimulatedCheckout,
  refundPayment,
  startBookingCheckout,
} from "@/server/payments/service";

import { createTestTenant } from "./test-tenant";

/**
 * The guest checkout end to end on the server: hold a window, place the booking, pay the deposit with the
 * payment simulator (Stripe's test cards), then the balance off-session and a refund. Runs against the local
 * database with a throwaway one-crew business.
 */

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;

const home = { bedrooms: 3, fullBaths: 2, halfBaths: 1, sqft: 2100 };
const oneTime: QuoteRequest = { service: "standard", home, zip: "27609" };

function guest(n: number, request: QuoteRequest = oneTime) {
  return {
    quote: request,
    contact: {
      fullName: `Test Guest ${n}`,
      email: `guest${n}@it.example`,
      phone: "919-555-0199",
    },
    address: {
      line1: `${n} Test Ln`,
      city: "Raleigh",
      state: "nc",
      zip: request.zip,
    },
    notes: { accessNotes: "Lockbox 1234" },
  };
}

async function freeWindows(durationMinutes: number) {
  const today = toLocal(new Date().toISOString(), catalog.tenant.timezone).date;
  const days = await windowsFor(catalog, {
    from: addDays(today, 1),
    to: addDays(today, 21),
    durationMinutes,
  });
  return nextAvailable(days, 50);
}

async function bookAndHold(n: number, request: QuoteRequest = oneTime) {
  const priced = quote(catalog.pricing.rules, request);
  if (!priced.ok) throw new Error(priced.error.message);
  const duration = priced.quote.firstVisit.durationMinutes;
  const [slot] = await freeWindows(duration);
  const held = await holdWindow(catalog, {
    date: slot!.date,
    localStart: slot!.localStart,
    durationMinutes: duration,
  });
  if (!held.ok) throw new Error(held.message);
  return placeHeldBooking(catalog, guest(n, request), held.hold.token, {
    kind: "guest",
    userId: null,
    source: "web",
  });
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
  tenant = await createTestTenant({ crews: 1 });
  catalog = (await loadCatalog(tenant.slug))!;
});

afterAll(async () => {
  await tenant?.cleanup();
});

describe("guest checkout with the payment simulator", () => {
  it("holds a window, takes a declined card, then confirms on a good one", async () => {
    const placed = await bookAndHold(1);
    expect(await bookingStatus(placed.bookingId)).toBe("pending_payment");

    const session = await startBookingCheckout(placed.bookingId);
    expect(session).toMatchObject({ provider: "simulated", mode: "payment" });
    // A reload resumes the same checkout instead of starting a second payment.
    expect((await startBookingCheckout(placed.bookingId)).paymentRef).toBe(session.paymentRef);

    const declined = await completeSimulatedCheckout(placed.bookingId, "declined");
    expect(declined).toMatchObject({
      paymentStatus: "failed",
      bookingStatus: "pending_payment",
    });
    expect(declined.failureMessage).toBe("Your card was declined.");

    const paid = await completeSimulatedCheckout(placed.bookingId, "visa");
    expect(paid).toMatchObject({
      applied: true,
      paymentStatus: "succeeded",
      bookingStatus: "confirmed",
    });

    const { data: payment } = await tenant.admin
      .from("payments")
      .select("amount_cents, status")
      .eq("booking_id", placed.bookingId)
      .single();
    // 25% of $255.00
    expect(payment).toEqual({ amount_cents: 6375, status: "succeeded" });
  });

  it("asks for 3-D Secure and confirms once the client authenticates", async () => {
    const placed = await bookAndHold(2);
    await startBookingCheckout(placed.bookingId);

    const challenge = await completeSimulatedCheckout(placed.bookingId, "authenticate");
    expect(challenge).toMatchObject({
      paymentStatus: "requires_action",
      bookingStatus: "pending_payment",
    });

    const done = await completeSimulatedCheckout(placed.bookingId, "authenticate", true);
    expect(done).toMatchObject({
      paymentStatus: "succeeded",
      bookingStatus: "confirmed",
    });
  });

  it("ignores a redelivered provider event", async () => {
    const placed = await bookAndHold(3);
    const session = await startBookingCheckout(placed.bookingId);
    const event = {
      provider: "simulated" as const,
      eventId: `evt_dup_${placed.bookingId}`,
      type: "payment_intent.succeeded",
      paymentRef: session.paymentRef,
      status: "succeeded" as const,
    };

    expect((await applyPaymentEvent(event)).applied).toBe(true);
    expect((await applyPaymentEvent(event)).applied).toBe(false);

    const { count } = await tenant.admin
      .from("booking_events")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", placed.bookingId)
      .eq("event", "confirmed");
    expect(count).toBe(1);
  });

  it("charges the balance off-session and refunds part of the deposit", async () => {
    const placed = await bookAndHold(4);
    await startBookingCheckout(placed.bookingId);
    await completeSimulatedCheckout(placed.bookingId, "mastercard");

    const balance = await chargeSavedCard({
      bookingId: placed.bookingId,
      purpose: "balance",
      amountCents: 25500 - 6375,
      description: "Balance",
    });
    expect(balance.status).toBe("succeeded");

    const { data: deposit } = await tenant.admin
      .from("payments")
      .select("id")
      .eq("booking_id", placed.bookingId)
      .eq("purpose", "deposit")
      .single();
    const refund = await refundPayment({
      paymentId: deposit!.id,
      amountCents: 2375,
      reason: "Flat fee kept",
      actor: { userId: null, kind: "system" },
    });
    expect(refund.status).toBe("succeeded");

    await expect(
      refundPayment({
        paymentId: deposit!.id,
        amountCents: 4001,
        reason: "Too much",
        actor: { userId: null, kind: "system" },
      }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it("saves a card for a plan without charging it; a later charge on a bad card alerts the office", async () => {
    const placed = await bookAndHold(5, {
      ...oneTime,
      frequency: "weekly",
      recentlyCleaned: true,
    });
    const session = await startBookingCheckout(placed.bookingId);
    expect(session.mode).toBe("setup");

    const saved = await completeSimulatedCheckout(placed.bookingId, "fails_later");
    expect(saved).toMatchObject({
      paymentStatus: "succeeded",
      bookingStatus: "confirmed",
    });

    const charge = await chargeSavedCard({
      bookingId: placed.bookingId,
      purpose: "balance",
      amountCents: 25500,
      description: "Visit",
    });
    expect(charge).toMatchObject({
      status: "failed",
      failureCode: "card_declined",
    });

    const { count } = await tenant.admin
      .from("dispatch_alerts")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", placed.bookingId)
      .eq("kind", "payment_failed");
    expect(count).toBe(1);
  });
});

describe("holding windows", () => {
  it("refuses a booking whose hold has expired", async () => {
    const priced = quote(catalog.pricing.rules, oneTime);
    const duration = priced.ok ? priced.quote.firstVisit.durationMinutes : 0;
    const [slot] = await freeWindows(duration);
    const held = await holdWindow(catalog, {
      date: slot!.date,
      localStart: slot!.localStart,
      durationMinutes: duration,
    });
    if (!held.ok) throw new Error(held.message);

    await tenant.admin
      .from("crew_allocations")
      .update({ hold_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("hold_token", held.hold.token);

    await expect(
      placeHeldBooking(catalog, guest(6), held.hold.token, {
        kind: "guest",
        userId: null,
        source: "web",
      }),
    ).rejects.toMatchObject({ code: "hold_expired" });
  });

  it("gives a one-crew window to one of two simultaneous clients and offers the other alternatives", async () => {
    const [slot] = await freeWindows(225);
    const request = {
      date: slot!.date,
      localStart: slot!.localStart,
      durationMinutes: 225,
    };
    const results = await Promise.all([holdWindow(catalog, request), holdWindow(catalog, request)]);

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0]!;
    if (!loser.ok) {
      expect(loser.reason).toBe("taken");
      expect(loser.alternatives.length).toBeGreaterThan(0);
      expect(
        loser.alternatives.some(
          (w) => w.date === request.date && w.localStart === request.localStart,
        ),
      ).toBe(false);
    }
  });
});
