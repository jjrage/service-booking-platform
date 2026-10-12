import "server-only";

import { adminDb } from "../db/admin";
import { nullable } from "../db/args";
import { CommandError, ensureOk, unwrap } from "../db/errors";
import { paymentProvider, providerByName } from "./index";
import { simulateCheckout, type SimulatedTestCard } from "./simulated";
import type { CheckoutSession, PaymentPurpose, PaymentStatus, ProviderEvent } from "./types";

/**
 * Payment use cases on top of the provider: the booking checkout (deposit or saved card), provider events,
 * off-session charges and refunds. Every state change goes through a cmd_* function; the provider is only
 * asked to move money.
 */

export type AppliedEvent = {
  applied: boolean;
  bookingId: string | null;
  bookingStatus: string | null;
  paymentStatus: PaymentStatus | null;
};

async function loadBooking(bookingId: string) {
  return unwrap(
    await adminDb()
      .from("bookings")
      .select(
        "id, number, tenant_id, client_id, status, total_cents, deposit_cents, currency, " +
          "client:clients!inner(full_name, email), tenant:tenants!inner(name)",
      )
      .eq("id", bookingId)
      .single<{
        id: string;
        number: number;
        tenant_id: string;
        client_id: string;
        status: string;
        total_cents: number;
        deposit_cents: number;
        currency: string;
        client: { full_name: string; email: string };
        tenant: { name: string };
      }>(),
    "load booking for payment",
  );
}

/**
 * The client's customer at the provider that takes new checkouts. Moving to another provider drops the card
 * saved at the old one (cmd_save_billing); the checkout saves a new one.
 */
async function customerFor(booking: Awaited<ReturnType<typeof loadBooking>>) {
  const provider = paymentProvider();
  const db = adminDb();
  const { data: billing } = await db
    .from("client_billing")
    .select("provider, customer_ref")
    .eq("tenant_id", booking.tenant_id)
    .eq("client_id", booking.client_id)
    .maybeSingle();

  const sameProvider = billing?.provider === provider.name;
  const customerRef = await provider.ensureCustomer({
    id: booking.client_id,
    tenantId: booking.tenant_id,
    email: booking.client.email,
    name: booking.client.full_name,
    existingRef: sameProvider ? billing.customer_ref : null,
  });
  if (!sameProvider || customerRef !== billing.customer_ref) {
    ensureOk(
      await db.rpc("cmd_save_billing", {
        p_tenant_id: booking.tenant_id,
        p_client_id: booking.client_id,
        p_provider: provider.name,
        p_customer_ref: customerRef,
      }),
      "save customer",
    );
  }
  return customerRef;
}

/**
 * Starts (or resumes, after a reload or a declined card) the payment that confirms a booking: a deposit for a
 * one-time visit, or saving the card for a plan visit.
 */
export async function startBookingCheckout(bookingId: string): Promise<CheckoutSession> {
  const provider = paymentProvider();
  const booking = await loadBooking(bookingId);
  if (booking.status !== "pending_payment") {
    throw new CommandError("invalid_status", `Booking #${booking.number} is ${booking.status}`);
  }

  const purpose: PaymentPurpose = booking.deposit_cents > 0 ? "deposit" : "card_setup";
  const mode = purpose === "card_setup" ? "setup" : "payment";

  const { data: open } = await adminDb()
    .from("payments")
    .select("provider_payment_id")
    .eq("booking_id", bookingId)
    .eq("purpose", purpose)
    .eq("provider", provider.name)
    .in("status", ["requires_payment", "requires_action", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return provider.resumeCheckout(open.provider_payment_id, mode);

  const customerRef = await customerFor(booking);
  const metadata = {
    booking_id: booking.id,
    booking_number: String(booking.number),
    tenant_id: booking.tenant_id,
  };
  const session =
    purpose === "deposit"
      ? await provider.createCheckout({
          customerRef,
          amountCents: booking.deposit_cents,
          currency: booking.currency,
          description: `Deposit for booking #${booking.number}, ${booking.tenant.name}`,
          metadata,
          idempotencyKey: `checkout:${booking.id}`,
        })
      : await provider.createCardSetup({
          customerRef,
          metadata,
          idempotencyKey: `card-setup:${booking.id}`,
        });

  unwrap(
    await adminDb().rpc("cmd_start_payment", {
      p_booking_id: booking.id,
      p_purpose: purpose,
      p_amount_cents: purpose === "deposit" ? booking.deposit_cents : 0,
      p_provider: provider.name,
      p_provider_payment_id: session.paymentRef,
    }),
    "record payment",
  );
  return session;
}

/** Applies a provider event exactly once (see cmd_apply_payment_event). */
export async function applyPaymentEvent(event: ProviderEvent): Promise<AppliedEvent> {
  const rows = unwrap(
    await adminDb().rpc("cmd_apply_payment_event", {
      p_provider: event.provider,
      p_event_id: event.eventId,
      p_event_type: event.type,
      p_provider_payment_id: event.paymentRef,
      p_status: event.status,
      p_failure_code: event.failureCode ?? undefined,
      p_failure_message: event.failureMessage ?? undefined,
      p_card: event.card ?? undefined,
    }),
    "apply payment event",
  );
  const row = rows[0];
  return {
    applied: row?.applied ?? false,
    bookingId: row?.booking_id ?? null,
    bookingStatus: row?.booking_status ?? null,
    paymentStatus: row?.payment_status ?? null,
  };
}

/** The simulator's stand-in for Stripe.js confirming a card in the browser. */
export async function completeSimulatedCheckout(
  bookingId: string,
  card: SimulatedTestCard,
  authenticated?: boolean,
): Promise<AppliedEvent & { failureMessage: string | null }> {
  if (paymentProvider().name !== "simulated") {
    throw new CommandError("invalid_input", "Payments are handled by Stripe");
  }
  const payment = unwrap(
    await adminDb()
      .from("payments")
      .select("provider_payment_id, purpose")
      .eq("booking_id", bookingId)
      .eq("provider", "simulated")
      .in("purpose", ["deposit", "card_setup"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "find checkout",
  );
  const event = simulateCheckout(
    {
      paymentRef: payment.provider_payment_id,
      mode: payment.purpose === "card_setup" ? "setup" : "payment",
    },
    card,
    authenticated,
  );
  return {
    ...(await applyPaymentEvent(event)),
    failureMessage: event.failureMessage ?? null,
  };
}

export type ChargeResult = {
  status: PaymentStatus;
  paymentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
};

/**
 * Charges the client's saved card without them present: the balance after a visit, a fee, or the deposit
 * of a booking a signed-in client made through the assistant. The payment is
 * recorded before it is confirmed, so the provider's webhook always finds it.
 */
export async function chargeSavedCard(input: {
  bookingId: string;
  purpose: Extract<PaymentPurpose, "deposit" | "balance" | "cancellation_fee" | "no_access_fee">;
  amountCents: number;
  description: string;
}): Promise<ChargeResult> {
  if (input.amountCents <= 0) {
    return {
      status: "succeeded",
      paymentId: null,
      failureCode: null,
      failureMessage: null,
    };
  }
  const db = adminDb();
  const booking = await loadBooking(input.bookingId);
  const { data: billing } = await db
    .from("client_billing")
    .select("provider, customer_ref, payment_method_ref")
    .eq("tenant_id", booking.tenant_id)
    .eq("client_id", booking.client_id)
    .maybeSingle();
  if (!billing?.payment_method_ref) {
    return {
      status: "failed",
      paymentId: null,
      failureCode: "no_saved_card",
      failureMessage: "The client has no saved card.",
    };
  }
  // The card is charged where it was saved, whichever provider takes new checkouts now.
  const provider = providerByName(billing.provider);
  const customerRef = billing.customer_ref;
  const paymentMethodRef = billing.payment_method_ref;

  const { count } = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id)
    .eq("purpose", input.purpose);
  const { paymentRef } = await provider.createOffSessionCharge({
    customerRef,
    paymentMethodRef,
    amountCents: input.amountCents,
    currency: booking.currency,
    description: input.description,
    metadata: {
      booking_id: booking.id,
      tenant_id: booking.tenant_id,
      purpose: input.purpose,
    },
    idempotencyKey: `${input.purpose}:${booking.id}:${count ?? 0}`,
  });

  const paymentId = unwrap(
    await db.rpc("cmd_start_payment", {
      p_booking_id: booking.id,
      p_purpose: input.purpose,
      p_amount_cents: input.amountCents,
      p_provider: provider.name,
      p_provider_payment_id: paymentRef,
      p_off_session: true,
    }),
    "record off-session payment",
  );

  const result = await provider.confirmOffSessionCharge(paymentRef);
  await applyPaymentEvent({
    provider: provider.name,
    eventId: `sync:${paymentRef}:${result.status}`,
    type: "off_session.confirm",
    paymentRef,
    status: result.status,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
  });
  return {
    status: result.status,
    paymentId,
    failureCode: result.failureCode ?? null,
    failureMessage: result.failureMessage ?? null,
  };
}

/** Refunds part or all of a succeeded payment and records it (the database caps the total refunded). */
export async function refundPayment(input: {
  paymentId: string;
  amountCents: number;
  reason: string;
  actor: { userId: string; kind: "staff" } | { userId: null; kind: "system" };
}): Promise<{ refundId: string; status: "pending" | "succeeded" | "failed" }> {
  const db = adminDb();
  const payment = unwrap(
    await db
      .from("payments")
      .select("id, provider, provider_payment_id, amount_cents, status")
      .eq("id", input.paymentId)
      .single(),
    "load payment",
  );
  const provider = providerByName(payment.provider);
  if (payment.status !== "succeeded") {
    throw new CommandError("invalid_status", "Only a succeeded payment can be refunded");
  }

  // Checked again by cmd_record_refund under a lock; checking first avoids asking the provider in vain.
  const previous = unwrap(
    await db.from("refunds").select("amount_cents, status").eq("payment_id", payment.id),
    "load refunds",
  );
  const refunded = previous
    .filter((r) => r.status !== "failed")
    .reduce((sum, r) => sum + r.amount_cents, 0);
  if (input.amountCents <= 0 || refunded + input.amountCents > payment.amount_cents) {
    throw new CommandError(
      "invalid_input",
      `At most ${payment.amount_cents - refunded} cents of this payment can still be refunded`,
    );
  }

  const refund = await provider.refund({
    paymentRef: payment.provider_payment_id,
    amountCents: input.amountCents,
    idempotencyKey: `refund:${payment.id}:${previous.length}`,
  });

  const refundId = unwrap(
    await db.rpc("cmd_record_refund", {
      p_payment_id: payment.id,
      p_actor: nullable(input.actor.userId),
      p_actor_kind: input.actor.kind,
      p_amount_cents: input.amountCents,
      p_reason: input.reason,
      p_provider_refund_id: refund.refundRef,
      p_status: refund.status,
    }),
    "record refund",
  );
  return { refundId, status: refund.status };
}
