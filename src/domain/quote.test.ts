import { describe, expect, it } from "vitest";

import { wrenfieldPricingRules as rules } from "@/demo/wrenfield";

import { homeSizeOptions, quote, type QuoteRequest } from "./quote";
import { pricingRulesSchema } from "./rules";

const baseHome = { bedrooms: 1, fullBaths: 1, halfBaths: 0, sqft: 1500 };
// Emily Thornton's home: 3 bed, 2 full + 1 half bath, 2,100 sq ft, zone A.
const emilyHome = { bedrooms: 3, fullBaths: 2, halfBaths: 1, sqft: 2100 };

function ok(request: QuoteRequest) {
  const result = quote(rules, request);
  if (!result.ok) throw new Error(`expected a quote, got ${result.error.code}`);
  return result.quote;
}

function errorCode(request: QuoteRequest) {
  const result = quote(rules, request);
  return result.ok ? null : result.error.code;
}

describe("quote()", () => {
  it("raises a small standard clean to the $150 minimum and takes a $50 minimum deposit", () => {
    const q = ok({ service: "standard", home: baseHome, zip: "27601" });

    expect(q.firstVisit.totalCents).toBe(15000);
    expect(q.firstVisit.lines.map((line) => [line.code, line.cents])).toEqual([
      ["base", 12000],
      ["minimum", 3000],
    ]);
    expect(q.firstVisit.durationMinutes).toBe(120);
    expect(q.depositCents).toBe(5000);
    expect(q.recurringVisit).toBeNull();
  });

  it("prices home size: bedrooms, baths and each started 500 sq ft over 1,500", () => {
    const q = ok({ service: "standard", home: emilyHome, zip: "27609" });

    // 120 + 2 × 25 + 30 + 15 + 2 × 20 (2,100 sq ft is 600 over → 2 steps)
    expect(q.firstVisit.totalCents).toBe(25500);
    // 120 + 2 × 20 + 25 + 10 + 2 × 15 = 225 minutes
    expect(q.firstVisit.durationMinutes).toBe(225);
    expect(q.depositCents).toBe(6375);
    expect(q.zone.code).toBe("A");
  });

  it("prices an unknown size by rooms alone, and a size range like any size inside it", () => {
    const unknown = ok({ service: "standard", home: { ...emilyHome, sqft: null }, zip: "27609" });
    expect(unknown.firstVisit.totalCents).toBe(25500 - 2 * 2000);
    expect(unknown.firstVisit.lines.map((line) => line.code)).not.toContain("sqft");

    const options = homeSizeOptions(rules);
    expect(options.map((o) => o.label)).toEqual([
      "Up to 1,500",
      "1,500–2,000",
      "2,000–2,500",
      "2,500–3,000",
      "3,000–3,500",
      "3,500–4,000",
    ]);
    // Emily's 2,100 sq ft falls in 2,000–2,500, which prices the same as her exact size.
    const range = options.find((o) => o.label === "2,000–2,500")!;
    const ranged = ok({
      service: "standard",
      home: { ...emilyHome, sqft: range.sqft },
      zip: "27609",
    });
    expect(ranged.firstVisit.totalCents).toBe(25500);
  });

  it("adds the zone travel surcharge on top of the cleaning price", () => {
    const deepB = ok({
      service: "deep",
      home: { bedrooms: 3, fullBaths: 2, halfBaths: 0, sqft: 1800 },
      zip: "27513",
    });
    expect(deepB.firstVisit.totalCents).toBe(26000 + 5000 + 3000 + 2000 + 1500);

    // The minimum applies to the cleaning; travel is charged on top of it.
    const smallC = ok({ service: "standard", home: baseHome, zip: "27587" });
    expect(smallC.firstVisit.totalCents).toBe(15000 + 3000);
  });

  it("prices add-ons per item or per unit and adds their time", () => {
    const q = ok({
      service: "standard",
      home: emilyHome,
      zip: "27609",
      addons: { fridge: 1, oven: 1, windows_inside: 10 },
    });

    expect(q.firstVisit.totalCents).toBe(25500 + 3500 + 3500 + 10 * 600);
    // 225 + 30 + 30 + 50 = 335 → rounded up to 345
    expect(q.firstVisit.durationMinutes).toBe(345);
    expect(
      errorCode({
        service: "standard",
        home: baseHome,
        zip: "27601",
        addons: { windows_inside: 41 },
      }),
    ).toBe("too_many_units");
    expect(
      errorCode({
        service: "standard",
        home: baseHome,
        zip: "27601",
        addons: { sauna: 1 },
      }),
    ).toBe("unknown_addon");
  });

  it("adds 20% for a heavy condition and flags the quote for the office to review", () => {
    const q = ok({
      service: "standard",
      home: emilyHome,
      zip: "27609",
      condition: "heavy",
    });

    expect(q.firstVisit.totalCents).toBe(25500 + 5100);
    expect(q.firstVisit.durationMinutes).toBe(270); // 225 + 45
    expect(q.needsReview).toBe(true);
  });

  it("prices a plan's first visit as deep without a recent professional clean, then discounts later visits", () => {
    const q = ok({
      service: "standard",
      home: emilyHome,
      zip: "27609",
      frequency: "weekly",
    });

    expect(q.firstVisit.service).toBe("deep");
    expect(q.firstVisit.totalCents).toBe(26000 + 5000 + 3000 + 1500 + 4000);
    expect(q.recurringVisit?.service).toBe("standard");
    expect(q.recurringVisit?.totalCents).toBe(25500 - 3825); // −15%
    expect(q.depositCents).toBe(0); // plans charge the saved card after each visit
  });

  it("keeps the first visit standard when the home was cleaned recently", () => {
    const q = ok({
      service: "standard",
      home: emilyHome,
      zip: "27609",
      frequency: "biweekly",
      recentlyCleaned: true,
    });

    expect(q.firstVisit.service).toBe("standard");
    expect(q.firstVisit.totalCents).toBe(25500); // no discount on the first visit
    expect(q.recurringVisit?.totalCents).toBe(25500 - 2550); // −10%
  });

  it("applies the minimum after the plan discount", () => {
    const q = ok({
      service: "standard",
      home: baseHome,
      zip: "27601",
      frequency: "monthly",
      recentlyCleaned: true,
    });
    expect(q.recurringVisit?.totalCents).toBe(15000);
  });

  it("refuses what cannot be booked instantly", () => {
    expect(errorCode({ service: "standard", home: baseHome, zip: "90210" })).toBe("out_of_area");
    expect(errorCode({ service: "post_renovation", home: baseHome, zip: "27601" })).toBe(
      "no_instant_price",
    );
    expect(errorCode({ service: "move_in_out", home: baseHome, zip: "27601" })).toBe(
      "empty_home_required",
    );
    expect(
      errorCode({
        service: "deep",
        home: baseHome,
        zip: "27601",
        frequency: "weekly",
      }),
    ).toBe("recurring_not_offered");
    expect(
      ok({
        service: "move_in_out",
        home: baseHome,
        zip: "27601",
        emptyHome: true,
      }).firstVisit.totalCents,
    ).toBe(31000);
  });

  it("never asks for a deposit larger than the visit", () => {
    const cheap = pricingRulesSchema.parse({
      ...rules,
      minimum_cents: 0,
      services: { mini: { base_cents: 3000, base_minutes: 60 } },
      first_visit: null,
    });
    const result = quote(cheap, {
      service: "mini",
      home: baseHome,
      zip: "27601",
    });
    expect(result.ok && result.quote.depositCents).toBe(3000);
  });
});

describe("pricing rules", () => {
  it("accepts the demo rules and rejects a ZIP in two zones", () => {
    expect(pricingRulesSchema.safeParse(rules).success).toBe(true);

    const [zoneA, zoneB, ...rest] = rules.zones;
    const broken = {
      ...rules,
      zones: [zoneA, { ...zoneB!, zips: [...zoneB!.zips, "27601"] }, ...rest],
    };
    expect(pricingRulesSchema.safeParse(broken).success).toBe(false);
  });
});
