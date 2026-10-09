import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  CardDetails,
  CheckoutSession,
  OffSessionResult,
  PaymentProvider,
  ProviderEvent,
} from "./types";

/**
 * A stand-in for Stripe test mode, used when no Stripe keys are configured. It behaves like Stripe's test
 * cards (success, declines, 3-D Secure, "charges fail later"), so the deposit, saved-card, decline and
 * duplicate-event paths all run for real against the database.
 *
 * Card numbers never reach the server, as with Stripe Elements: the browser recognizes only the published
 * test numbers and sends the name of the test card ("visa", "declined", …).
 */

export const simulatedTestCards = {
  visa: {
    number: "4242424242424242",
    brand: "visa",
    last4: "4242",
    behavior: "succeeds",
  },
  mastercard: {
    number: "5555555555554444",
    brand: "mastercard",
    last4: "4444",
    behavior: "succeeds",
  },
  authenticate: {
    number: "4000002760003184",
    brand: "visa",
    last4: "3184",
    behavior: "requires 3-D Secure",
  },
  declined: {
    number: "4000000000000002",
    brand: "visa",
    last4: "0002",
    behavior: "is declined",
  },
  insufficient_funds: {
    number: "4000000000009995",
    brand: "visa",
    last4: "9995",
    behavior: "has insufficient funds",
  },
  fails_later: {
    number: "4000000000000341",
    brand: "visa",
    last4: "0341",
    behavior: "saves, but later charges fail",
  },
} as const;

export type SimulatedTestCard = keyof typeof simulatedTestCards;

function stableId(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function cardDetails(card: SimulatedTestCard): CardDetails {
  const { brand, last4 } = simulatedTestCards[card];
  return {
    payment_method_ref: `sim_pm_${card}`,
    brand,
    last4,
    exp_month: 12,
    exp_year: 2030,
  };
}

const declines: Partial<
  Record<SimulatedTestCard, { code: string; message: string }>
> = {
  declined: { code: "card_declined", message: "Your card was declined." },
  insufficient_funds: {
    code: "insufficient_funds",
    message: "Your card has insufficient funds.",
  },
  fails_later: { code: "card_declined", message: "Your card was declined." },
};

/**
 * What happens when the client submits a test card in the browser. A 3-D Secure card first returns
 * "requires_action"; the client then completes (or fails) the challenge and the browser submits again with
 * `authenticated` set.
 */
export function simulateCheckout(
  session: { paymentRef: string; mode: "payment" | "setup" },
  card: SimulatedTestCard,
  authenticated?: boolean,
): ProviderEvent {
  const base = {
    provider: "simulated" as const,
    eventId: `sim_evt_${randomUUID()}`,
    paymentRef: session.paymentRef,
  };
  const kind = session.mode === "setup" ? "setup_intent" : "payment_intent";

  if (card === "authenticate" && authenticated === undefined) {
    return {
      ...base,
      type: `${kind}.requires_action`,
      status: "requires_action",
    };
  }
  if (card === "authenticate" && !authenticated) {
    return {
      ...base,
      type: `${kind}.${session.mode === "setup" ? "setup_failed" : "payment_failed"}`,
      status: "failed",
      failureCode: "payment_intent_authentication_failure",
      failureMessage: "We are unable to authenticate your payment method.",
    };
  }
  // Like Stripe's 0341 card: saving it works, charging it does not.
  const decline =
    session.mode === "setup" && card === "fails_later"
      ? undefined
      : declines[card];
  if (decline) {
    return {
      ...base,
      type: `${kind}.${session.mode === "setup" ? "setup_failed" : "payment_failed"}`,
      status: "failed",
      failureCode: decline.code,
      failureMessage: decline.message,
    };
  }
  return {
    ...base,
    type: `${kind}.succeeded`,
    status: "succeeded",
    card: cardDetails(card),
  };
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulated" as const;

  async ensureCustomer(client: { id: string; existingRef: string | null }) {
    return client.existingRef ?? `sim_cus_${client.id}`;
  }

  async createCheckout(input: {
    idempotencyKey: string;
  }): Promise<CheckoutSession> {
    const paymentRef = stableId("sim_pi", input.idempotencyKey);
    return {
      provider: this.name,
      paymentRef,
      clientSecret: `${paymentRef}_secret`,
      mode: "payment",
    };
  }

  async createCardSetup(input: {
    idempotencyKey: string;
  }): Promise<CheckoutSession> {
    const paymentRef = stableId("sim_seti", input.idempotencyKey);
    return {
      provider: this.name,
      paymentRef,
      clientSecret: `${paymentRef}_secret`,
      mode: "setup",
    };
  }

  async resumeCheckout(
    paymentRef: string,
    mode: "payment" | "setup",
  ): Promise<CheckoutSession> {
    return {
      provider: this.name,
      paymentRef,
      clientSecret: `${paymentRef}_secret`,
      mode,
    };
  }

  async createOffSessionCharge(input: {
    paymentMethodRef: string;
    idempotencyKey: string;
  }) {
    // The saved test card travels in the reference, so confirming needs no state between the two calls.
    const card = input.paymentMethodRef.replace(/^sim_pm_/, "");
    return {
      paymentRef: `${stableId("sim_pi", input.idempotencyKey)}__${card}`,
    };
  }

  async confirmOffSessionCharge(paymentRef: string): Promise<OffSessionResult> {
    const card = paymentRef.split("__")[1] as SimulatedTestCard | undefined;
    if (card === "authenticate") {
      return {
        status: "requires_action",
        failureCode: "authentication_required",
        failureMessage:
          "The card requires the client to authenticate this payment.",
      };
    }
    const decline = card ? declines[card] : undefined;
    if (decline) {
      return {
        status: "failed",
        failureCode: decline.code,
        failureMessage: decline.message,
      };
    }
    return { status: "succeeded" };
  }

  async refund(input: { idempotencyKey: string }) {
    return {
      refundRef: stableId("sim_re", input.idempotencyKey),
      status: "succeeded" as const,
    };
  }
}
