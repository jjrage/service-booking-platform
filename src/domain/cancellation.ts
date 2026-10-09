import { formatMoney, percentOf, type Cents } from "./money";
import type { CancellationRules } from "./rules";
import { minutesBetween, type Instant } from "./time";

/**
 * The fee for cancelling, rescheduling or a lockout. The portal shows this as a preview and the server charges
 * exactly the same number, because both call this function with the booking's own cancellation rules.
 */

export type CancellationReason = "cancel" | "reschedule" | "no_access";
export type FeeTier = "free" | "flat" | "late" | "no_access";

export type CancellationFee = {
  tier: FeeTier;
  feeCents: Cents;
  /** Hours from `now` to the start of the arrival window (negative once it has started). */
  hoursBefore: number;
  explanation: string;
};

export function cancellationFee(
  rules: CancellationRules,
  booking: { totalCents: Cents; arrivalStart: Instant; currency?: string },
  reason: CancellationReason,
  now: Instant,
): CancellationFee {
  const hoursBefore = minutesBetween(now, booking.arrivalStart) / 60;
  const money = (cents: Cents) => formatMoney(cents, booking.currency);
  const action = reason === "reschedule" ? "Rescheduling" : "Cancelling";

  if (reason === "no_access") {
    const feeCents = percentOf(booking.totalCents, rules.no_access_fee_percent);
    return {
      tier: "no_access",
      feeCents,
      hoursBefore,
      explanation: `The crew could not get in: ${rules.no_access_fee_percent}% of the visit price (${money(feeCents)}).`,
    };
  }

  if (hoursBefore >= rules.free_before_hours) {
    return {
      tier: "free",
      feeCents: 0,
      hoursBefore,
      explanation: `${action} is free up to ${rules.free_before_hours} hours before the arrival window.`,
    };
  }

  if (hoursBefore >= rules.late_within_hours) {
    const feeCents = Math.min(rules.flat_fee_cents, booking.totalCents);
    return {
      tier: "flat",
      feeCents,
      hoursBefore,
      explanation: `${action} within ${rules.free_before_hours} hours of the arrival window costs ${money(feeCents)}.`,
    };
  }

  const feeCents = percentOf(booking.totalCents, rules.late_fee_percent);
  return {
    tier: "late",
    feeCents,
    hoursBefore,
    explanation: `${action} within ${rules.late_within_hours} hours of the arrival window costs ${rules.late_fee_percent}% of the visit price (${money(feeCents)}).`,
  };
}

/**
 * How a fee is settled against what the client already paid (the deposit): keep up to the fee, refund the rest,
 * and charge the saved card for any part of the fee the deposit does not cover.
 */
export function settleFee(
  feeCents: Cents,
  paidCents: Cents,
): { keepCents: Cents; refundCents: Cents; chargeCents: Cents } {
  const keepCents = Math.min(feeCents, paidCents);
  return {
    keepCents,
    refundCents: paidCents - keepCents,
    chargeCents: feeCents - keepCents,
  };
}
