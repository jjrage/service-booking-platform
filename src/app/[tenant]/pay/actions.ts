"use server";

import { z } from "zod";

import { completeSimulatedCheckout } from "@/server/payments/service";
import { simulatedTestCards } from "@/server/payments/simulated";
import { bookingAccessToken, verifyBookingAccessToken } from "@/server/signing";

const inputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  bookingId: z.uuid(),
  token: z.string().min(1),
  card: z.enum(
    Object.keys(simulatedTestCards) as [keyof typeof simulatedTestCards],
  ),
  authenticated: z.boolean().optional(),
});

export type SimulatedPayResponse =
  | { ok: true; url: string }
  | {
      ok: false;
      status: "requires_action" | "failed" | "error";
      message: string;
    };

/**
 * The payment simulator's checkout (used when Stripe keys are not configured). The browser sends only the
 * name of a Stripe test card, never a card number.
 */
export async function simulatedPayAction(
  input: z.input<typeof inputSchema>,
): Promise<SimulatedPayResponse> {
  const parsed = inputSchema.safeParse(input);
  if (
    !parsed.success ||
    !verifyBookingAccessToken(parsed.data.bookingId, parsed.data.token)
  ) {
    return {
      ok: false,
      status: "error",
      message: "This payment link is not valid.",
    };
  }
  const { slug, bookingId, card, authenticated } = parsed.data;

  const result = await completeSimulatedCheckout(
    bookingId,
    card,
    authenticated,
  );
  if (result.paymentStatus === "succeeded") {
    return {
      ok: true,
      url: `/${slug}/bookings/${bookingId}?t=${bookingAccessToken(bookingId)}`,
    };
  }
  if (result.paymentStatus === "requires_action") {
    return {
      ok: false,
      status: "requires_action",
      message: "Your bank asks you to confirm this payment.",
    };
  }
  return {
    ok: false,
    status: "failed",
    message:
      result.failureMessage ??
      "The payment did not go through. Try another card.",
  };
}
