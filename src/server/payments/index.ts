import "server-only";

import { publicEnv } from "@/config/public-env";
import { serverEnv } from "@/config/server-env";

import { SimulatedPaymentProvider } from "./simulated";
import { StripePaymentProvider } from "./stripe";
import type { PaymentProvider } from "./types";

let provider: PaymentProvider | undefined;

/** Stripe when both test keys are configured, otherwise the built-in simulator. */
export function paymentProvider(): PaymentProvider {
  if (!provider) {
    const secretKey = serverEnv.STRIPE_SECRET_KEY;
    provider =
      secretKey && publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        ? new StripePaymentProvider(secretKey)
        : new SimulatedPaymentProvider();
  }
  return provider;
}

export function stripeProvider(): StripePaymentProvider | null {
  const current = paymentProvider();
  return current instanceof StripePaymentProvider ? current : null;
}
