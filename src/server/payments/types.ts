import type { Database } from "@/db/database.types";

export type ProviderName = Database["public"]["Enums"]["payment_provider"];
export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type PaymentPurpose = Database["public"]["Enums"]["payment_purpose"];

export type CardDetails = {
  payment_method_ref: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
};

/** What the browser needs to collect a payment: Stripe's client secret, or the simulator's payment id. */
export type CheckoutSession = {
  provider: ProviderName;
  paymentRef: string;
  clientSecret: string;
  /** Saving a card without charging it (plan visits). */
  mode: "payment" | "setup";
};

/** A provider event in the app's terms: what happened to which payment. */
export type ProviderEvent = {
  provider: ProviderName;
  eventId: string;
  type: string;
  paymentRef: string;
  status: PaymentStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  card?: CardDetails | null;
};

export type OffSessionResult = {
  status: PaymentStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
};

/**
 * The payment provider behind the app. Stripe in test mode when keys are configured; otherwise a simulator
 * that follows Stripe's test cards, so the whole flow (deposit, saved card, declines, 3DS, refunds, duplicate
 * events) can be tried without an account.
 */
export interface PaymentProvider {
  readonly name: ProviderName;

  /** Returns the client's customer id at the provider, creating the customer when needed. */
  ensureCustomer(client: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    existingRef: string | null;
  }): Promise<string>;

  /** A payment the client completes in the browser (deposit), saving the card for later charges. */
  createCheckout(input: {
    customerRef: string;
    amountCents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<CheckoutSession>;

  /** Saves a card without charging it (plans charge after each visit). */
  createCardSetup(input: {
    customerRef: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<CheckoutSession>;

  /** The client secret of an existing checkout, to resume it after a page reload. */
  resumeCheckout(
    paymentRef: string,
    mode: "payment" | "setup",
  ): Promise<CheckoutSession>;

  /**
   * Charges a saved card without the client present, in two steps so the payment can be recorded before the
   * provider can report on it: create, then (after the caller records it) confirm.
   */
  createOffSessionCharge(input: {
    customerRef: string;
    paymentMethodRef: string;
    amountCents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ paymentRef: string }>;
  confirmOffSessionCharge(paymentRef: string): Promise<OffSessionResult>;

  refund(input: {
    paymentRef: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<{
    refundRef: string;
    status: "pending" | "succeeded" | "failed";
  }>;
}
