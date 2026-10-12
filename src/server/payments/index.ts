import "server-only";

import { publicEnv } from "@/config/public-env";
import { serverEnv } from "@/config/server-env";

import { CommandError } from "../db/errors";
import { SimulatedPaymentProvider } from "./simulated";
import { StripePaymentProvider } from "./stripe";
import type { PaymentProvider, ProviderName } from "./types";

let provider: PaymentProvider | undefined;
let simulator: SimulatedPaymentProvider | undefined;

/** Stripe when both test keys are configured, otherwise the built-in simulator. New checkouts use it. */
export function paymentProvider(): PaymentProvider {
  if (!provider) {
    const secretKey = serverEnv.STRIPE_SECRET_KEY;
    provider =
      secretKey && publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        ? new StripePaymentProvider(secretKey)
        : simulatedProvider();
  }
  return provider;
}

function simulatedProvider(): SimulatedPaymentProvider {
  simulator ??= new SimulatedPaymentProvider();
  return simulator;
}

/**
 * The provider that holds a saved card or took a payment. Charges and refunds go back to it: the demo's seeded
 * history is simulated even when Stripe takes the new bookings, and the simulator needs no keys.
 */
export function providerByName(name: ProviderName): PaymentProvider {
  if (name === "simulated") return simulatedProvider();
  const current = stripeProvider();
  if (!current) {
    throw new CommandError(
      "invalid_input",
      `This payment was taken by the ${name} provider, which is not configured now`,
    );
  }
  return current;
}

export function stripeProvider(): StripePaymentProvider | null {
  const current = paymentProvider();
  return current instanceof StripePaymentProvider ? current : null;
}
