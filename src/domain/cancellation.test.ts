import { describe, expect, it } from "vitest";

import { wrenfieldCancellationRules as rules } from "@/demo/wrenfield";

import { cancellationFee, settleFee } from "./cancellation";
import { cancellationRulesSchema } from "./rules";
import { addMinutes } from "./time";

const arrivalStart = "2026-10-20T12:00:00Z";
const booking = { totalCents: 25500, arrivalStart };
const hoursBefore = (hours: number) => addMinutes(arrivalStart, -hours * 60);

describe("cancellationFee()", () => {
  it.each([
    [72, "free", 0],
    [48, "free", 0],
    [47.5, "flat", 4000],
    [30, "flat", 4000],
    [24, "flat", 4000],
    [23.5, "late", 12750],
    [1, "late", 12750],
    [-1, "late", 12750],
  ])("%s hours before the window: %s, %s cents", (hours, tier, feeCents) => {
    const fee = cancellationFee(rules, booking, "cancel", hoursBefore(hours));
    expect([fee.tier, fee.feeCents]).toEqual([tier, feeCents]);
  });

  it("charges the same for a reschedule and says so", () => {
    const fee = cancellationFee(rules, booking, "reschedule", hoursBefore(30));
    expect(fee.feeCents).toBe(4000);
    expect(fee.explanation).toBe(
      "Rescheduling within 48 hours of the arrival window costs $40.",
    );
  });

  it("charges half the visit for a lockout regardless of timing", () => {
    const fee = cancellationFee(rules, booking, "no_access", hoursBefore(-2));
    expect([fee.tier, fee.feeCents]).toEqual(["no_access", 12750]);
  });

  it("never charges a flat fee larger than the visit", () => {
    const fee = cancellationFee(
      rules,
      { totalCents: 3000, arrivalStart },
      "cancel",
      hoursBefore(30),
    );
    expect(fee.feeCents).toBe(3000);
  });

  it("rejects rules whose late period is longer than the free period", () => {
    expect(cancellationRulesSchema.safeParse(rules).success).toBe(true);
    expect(
      cancellationRulesSchema.safeParse({ ...rules, late_within_hours: 72 })
        .success,
    ).toBe(false);
  });
});

describe("settleFee()", () => {
  it("refunds the deposit when cancelling is free", () => {
    expect(settleFee(0, 6375)).toEqual({
      keepCents: 0,
      refundCents: 6375,
      chargeCents: 0,
    });
  });

  it("keeps the flat fee from the deposit and refunds the rest", () => {
    expect(settleFee(4000, 6375)).toEqual({
      keepCents: 4000,
      refundCents: 2375,
      chargeCents: 0,
    });
  });

  it("charges the saved card for the part of a late fee the deposit does not cover", () => {
    expect(settleFee(12750, 6375)).toEqual({
      keepCents: 6375,
      refundCents: 0,
      chargeCents: 6375,
    });
  });
});
