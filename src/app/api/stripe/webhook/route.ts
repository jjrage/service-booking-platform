import { serverEnv } from "@/config/server-env";
import { stripeProvider } from "@/server/payments";
import { afterPaymentEvent } from "@/server/payments/after-event";
import { applyPaymentEvent } from "@/server/payments/service";

/**
 * Stripe webhooks. The signature is verified on the raw body; the event is applied through
 * cmd_apply_payment_event, which records its id first, so Stripe's retries and duplicates change nothing.
 */
export async function POST(request: Request) {
  const stripe = stripeProvider();
  const secret = serverEnv.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return new Response("Stripe is not configured", { status: 404 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await request.text();
  let event;
  try {
    event = await stripe.parseWebhook(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (!event) {
    return Response.json({ received: true, ignored: true });
  }

  // An error here returns 500, and Stripe retries the event later.
  const result = await applyPaymentEvent(event);
  await afterPaymentEvent(result);
  return Response.json({ received: true, applied: result.applied });
}
