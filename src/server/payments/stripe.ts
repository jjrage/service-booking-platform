import "server-only";

import Stripe from "stripe";

import type {
  CardDetails,
  CheckoutSession,
  OffSessionResult,
  PaymentProvider,
  PaymentStatus,
  ProviderEvent,
} from "./types";

/**
 * Stripe in test mode (the environment schema refuses live keys). Card details are collected by the
 * Payment Element in the browser and never pass through this server.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async ensureCustomer(client: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    existingRef: string | null;
  }) {
    if (client.existingRef) return client.existingRef;
    const customer = await this.stripe.customers.create(
      {
        email: client.email,
        name: client.name,
        metadata: { client_id: client.id, tenant_id: client.tenantId },
      },
      { idempotencyKey: `customer:${client.id}` },
    );
    return customer.id;
  }

  async createCheckout(input: {
    customerRef: string;
    amountCents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<CheckoutSession> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        customer: input.customerRef,
        description: input.description,
        metadata: input.metadata,
        payment_method_types: ["card"],
        // Saves the card for the balance after the visit and any late-cancellation fee.
        setup_future_usage: "off_session",
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return this.session(intent.id, intent.client_secret, "payment");
  }

  async createCardSetup(input: {
    customerRef: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<CheckoutSession> {
    const intent = await this.stripe.setupIntents.create(
      {
        customer: input.customerRef,
        metadata: input.metadata,
        payment_method_types: ["card"],
        usage: "off_session",
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return this.session(intent.id, intent.client_secret, "setup");
  }

  async resumeCheckout(paymentRef: string, mode: "payment" | "setup") {
    const intent =
      mode === "setup"
        ? await this.stripe.setupIntents.retrieve(paymentRef)
        : await this.stripe.paymentIntents.retrieve(paymentRef);
    return this.session(intent.id, intent.client_secret, mode);
  }

  async createOffSessionCharge(input: {
    customerRef: string;
    paymentMethodRef: string;
    amountCents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }) {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        customer: input.customerRef,
        payment_method: input.paymentMethodRef,
        payment_method_types: ["card"],
        description: input.description,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { paymentRef: intent.id };
  }

  async confirmOffSessionCharge(paymentRef: string): Promise<OffSessionResult> {
    try {
      const intent = await this.stripe.paymentIntents.confirm(paymentRef, {
        off_session: true,
      });
      return { status: intentStatus(intent.status) };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        return {
          status: error.code === "authentication_required" ? "requires_action" : "failed",
          failureCode: error.decline_code ?? error.code ?? null,
          failureMessage: error.message,
        };
      }
      throw error;
    }
  }

  async refund(input: { paymentRef: string; amountCents: number; idempotencyKey: string }) {
    const refund = await this.stripe.refunds.create(
      { payment_intent: input.paymentRef, amount: input.amountCents },
      { idempotencyKey: input.idempotencyKey },
    );
    const status: "pending" | "succeeded" | "failed" =
      refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed" || refund.status === "canceled"
          ? "failed"
          : "pending";
    return { refundRef: refund.id, status };
  }

  /** Verifies a webhook's signature and turns it into a provider event, or null for events the app ignores. */
  async parseWebhook(
    rawBody: string,
    signature: string,
    webhookSecret: string,
  ): Promise<ProviderEvent | null> {
    const event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
    const base = { provider: this.name, eventId: event.id, type: event.type };

    switch (event.type) {
      case "payment_intent.succeeded":
      case "payment_intent.processing":
      case "payment_intent.requires_action":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const intent = event.data.object;
        return {
          ...base,
          paymentRef: intent.id,
          // After a decline the intent waits for another card; for the app this attempt failed.
          status:
            event.type === "payment_intent.payment_failed" ? "failed" : intentStatus(intent.status),
          failureCode: intent.last_payment_error?.code ?? null,
          failureMessage: intent.last_payment_error?.message ?? null,
          card: intent.status === "succeeded" ? await this.card(intent.payment_method) : null,
        };
      }
      case "setup_intent.succeeded":
      case "setup_intent.setup_failed":
      case "setup_intent.canceled": {
        const intent = event.data.object;
        return {
          ...base,
          paymentRef: intent.id,
          status:
            event.type === "setup_intent.setup_failed" ? "failed" : intentStatus(intent.status),
          failureCode: intent.last_setup_error?.code ?? null,
          failureMessage: intent.last_setup_error?.message ?? null,
          card: intent.status === "succeeded" ? await this.card(intent.payment_method) : null,
        };
      }
      default:
        return null;
    }
  }

  private async card(method: string | Stripe.PaymentMethod | null): Promise<CardDetails | null> {
    if (!method) return null;
    const pm =
      typeof method === "string" ? await this.stripe.paymentMethods.retrieve(method) : method;
    if (!pm.card) return null;
    return {
      payment_method_ref: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      exp_month: pm.card.exp_month,
      exp_year: pm.card.exp_year,
    };
  }

  private session(
    id: string,
    clientSecret: string | null,
    mode: "payment" | "setup",
  ): CheckoutSession {
    if (!clientSecret) throw new Error(`Stripe returned no client secret for ${id}`);
    return { provider: this.name, paymentRef: id, clientSecret, mode };
  }
}

function intentStatus(
  status: Stripe.PaymentIntent.Status | Stripe.SetupIntent.Status,
): PaymentStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "processing":
      return "processing";
    case "requires_action":
    case "requires_confirmation":
      return "requires_action";
    case "canceled":
      return "canceled";
    case "requires_payment_method":
    case "requires_capture":
    default:
      return "requires_payment";
  }
}
