import { z } from "zod";

import { percentOf, type Cents } from "./money";
import { frequencies, type Frequency, type PricingRules } from "./rules";

/**
 * The one pricing function. The booking form, the client portal, the admin console and the AI assistant all
 * call quote() with the tenant's current pricing rules; the result is stored on the booking as a snapshot,
 * so later rule changes never reprice an existing booking.
 */

export const quoteInputSchema = z.object({
  service: z.string().min(1),
  home: z.object({
    bedrooms: z.int().min(0).max(10),
    fullBaths: z.int().min(0).max(10),
    halfBaths: z.int().min(0).max(10),
    sqft: z.int().min(200).max(10000),
  }),
  /** Add-on code → quantity (1 for add-ons that are not priced per unit). */
  addons: z.record(z.string(), z.int().min(0).max(100)).default({}),
  condition: z.enum(["normal", "heavy"]).default("normal"),
  frequency: z.enum(frequencies).default("one_time"),
  zip: z.string().regex(/^\d{5}$/, "5-digit ZIP"),
  /** Required for services that are only done in an empty home (move-in / move-out). */
  emptyHome: z.boolean().default(false),
  /** For plans: the home had a professional cleaning within the rules' first-visit period. */
  recentlyCleaned: z.boolean().default(false),
});

export type QuoteInput = z.infer<typeof quoteInputSchema>;
/** What callers may pass: defaults are filled in by quoteInputSchema. */
export type QuoteRequest = z.input<typeof quoteInputSchema>;

export type QuoteLine = {
  code: string;
  label: string;
  quantity?: number;
  cents: Cents;
  minutes: number;
};

export type VisitPrice = {
  /** The service this visit is priced as; a plan's first visit may be upgraded. */
  service: string;
  lines: QuoteLine[];
  totalCents: Cents;
  durationMinutes: number;
};

export type Quote = {
  input: QuoteInput;
  zone: { code: string; name: string };
  frequency: Frequency;
  /** The visit being booked now. */
  firstVisit: VisitPrice;
  /** The price of every later visit of a plan; null for a one-time visit. */
  recurringVisit: VisitPrice | null;
  /** Charged when booking. Plans save the card and charge after each visit instead. */
  depositCents: Cents;
  /** The owner confirms or adjusts the price before the visit (heavy condition). */
  needsReview: boolean;
  notes: string[];
};

export type QuoteErrorCode =
  | "no_instant_price"
  | "out_of_area"
  | "empty_home_required"
  | "recurring_not_offered"
  | "unknown_addon"
  | "too_many_units";

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; error: { code: QuoteErrorCode; message: string } };

const DURATION_STEP_MINUTES = 15;

const frequencyLabels: Record<Frequency, string> = {
  one_time: "One-time",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Every 4 weeks",
};

export function frequencyLabel(frequency: Frequency): string {
  return frequencyLabels[frequency];
}

function fail(code: QuoteErrorCode, message: string): QuoteResult {
  return { ok: false, error: { code, message } };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function quote(rules: PricingRules, request: QuoteRequest): QuoteResult {
  const input = quoteInputSchema.parse(request);
  const service = rules.services[input.service];
  if (!service) {
    return fail(
      "no_instant_price",
      "This service has no instant price. Send a request with photos and the office will quote it.",
    );
  }
  if (service.empty_home_only && !input.emptyHome) {
    return fail(
      "empty_home_required",
      "This service is only for an empty home (move-in or move-out).",
    );
  }
  if (input.frequency !== "one_time" && !service.recurring) {
    return fail(
      "recurring_not_offered",
      "This service is booked as a one-time visit only.",
    );
  }

  const zone = rules.zones.find((z) => z.zips.includes(input.zip));
  if (!zone) {
    return fail("out_of_area", `ZIP ${input.zip} is outside our service area.`);
  }

  for (const [code, quantity] of Object.entries(input.addons)) {
    const addon = rules.addons[code];
    if (!addon) {
      return fail("unknown_addon", `Unknown add-on "${code}".`);
    }
    const max = addon.per_unit ? (addon.max_units ?? 100) : 1;
    if (quantity > max) {
      return fail("too_many_units", `${addon.name}: at most ${max} per visit.`);
    }
  }

  const notes: string[] = [];
  const surcharge = { cents: zone.surcharge_cents, zone };
  let firstService = input.service;
  let recurringVisit: VisitPrice | null = null;

  if (input.frequency !== "one_time") {
    const upgrade = rules.first_visit;
    if (
      upgrade &&
      !input.recentlyCleaned &&
      upgrade.upgrade_to !== input.service
    ) {
      firstService = upgrade.upgrade_to;
      notes.push(
        `The first visit is priced as a ${upgrade.upgrade_to} clean: the home had no professional cleaning in the last ${upgrade.if_no_professional_clean_days} days.`,
      );
    }
    const discount = rules.frequency_discount_percent[input.frequency];
    recurringVisit = priceVisit(
      rules,
      input,
      input.service,
      discount,
      surcharge,
    );
    if (discount > 0) {
      notes.push(
        `${frequencyLabel(input.frequency)} visits get ${discount}% off from the second visit.`,
      );
    }
  }

  const firstVisit = priceVisit(rules, input, firstService, 0, surcharge);
  const needsReview =
    input.condition === "heavy" && rules.condition.heavy.needs_review;
  if (needsReview) {
    notes.push(
      "Heavy condition: the office confirms the price after seeing photos.",
    );
  }

  const depositCents =
    input.frequency === "one_time"
      ? Math.min(
          firstVisit.totalCents,
          Math.max(
            percentOf(firstVisit.totalCents, rules.deposit.percent),
            rules.deposit.minimum_cents,
          ),
        )
      : 0;

  return {
    ok: true,
    quote: {
      input,
      zone: { code: zone.code, name: zone.name },
      frequency: input.frequency,
      firstVisit,
      recurringVisit,
      depositCents,
      needsReview,
      notes,
    },
  };
}

function priceVisit(
  rules: PricingRules,
  input: QuoteInput,
  serviceCode: string,
  discountPercent: number,
  surcharge: { cents: Cents; zone: { code: string; name: string } },
): VisitPrice {
  const service = rules.services[serviceCode]!;
  const { included, home_size: size } = rules;
  const lines: QuoteLine[] = [
    {
      code: "base",
      label: `Base price (${plural(included.bedrooms, "bedroom")}, ${plural(included.full_baths, "bath")}, up to ${included.sqft.toLocaleString("en-US")} sq ft)`,
      cents: service.base_cents,
      minutes: service.base_minutes,
    },
  ];

  const extra = (
    code: string,
    label: string,
    quantity: number,
    unit: { cents: Cents; minutes: number },
  ) => {
    if (quantity > 0) {
      lines.push({
        code,
        label,
        quantity,
        cents: quantity * unit.cents,
        minutes: quantity * unit.minutes,
      });
    }
  };

  extra(
    "bedrooms",
    "Extra bedrooms",
    input.home.bedrooms - included.bedrooms,
    size.bedroom,
  );
  extra(
    "full_baths",
    "Extra full baths",
    input.home.fullBaths - included.full_baths,
    size.full_bath,
  );
  extra(
    "half_baths",
    "Extra half baths",
    input.home.halfBaths - included.half_baths,
    size.half_bath,
  );
  extra(
    "sqft",
    `Extra size (per ${size.sqft_step.size.toLocaleString("en-US")} sq ft over ${included.sqft.toLocaleString("en-US")})`,
    Math.ceil(
      Math.max(0, input.home.sqft - included.sqft) / size.sqft_step.size,
    ),
    size.sqft_step,
  );

  for (const [code, quantity] of Object.entries(input.addons)) {
    const addon = rules.addons[code]!;
    extra(
      `addon:${code}`,
      addon.name,
      addon.per_unit ? quantity : Math.min(quantity, 1),
      addon,
    );
  }

  const sum = () => lines.reduce((total, line) => total + line.cents, 0);
  const sumMinutes = () =>
    lines.reduce((total, line) => total + line.minutes, 0);

  if (input.condition === "heavy") {
    const { percent } = rules.condition.heavy;
    lines.push({
      code: "condition",
      label: `Heavy condition (+${percent}%)`,
      cents: percentOf(sum(), percent),
      minutes: Math.round((sumMinutes() * percent) / 100),
    });
  }

  if (discountPercent > 0) {
    lines.push({
      code: "discount",
      label: `${frequencyLabel(input.frequency)} discount (−${discountPercent}%)`,
      cents: -percentOf(sum(), discountPercent),
      minutes: 0,
    });
  }

  if (sum() < rules.minimum_cents) {
    lines.push({
      code: "minimum",
      label: "Minimum visit charge",
      cents: rules.minimum_cents - sum(),
      minutes: 0,
    });
  }

  if (surcharge.cents > 0) {
    lines.push({
      code: "travel",
      label: `Travel: ${surcharge.zone.name} (zone ${surcharge.zone.code})`,
      cents: surcharge.cents,
      minutes: 0,
    });
  }

  return {
    service: serviceCode,
    lines,
    totalCents: sum(),
    durationMinutes:
      Math.ceil(sumMinutes() / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES,
  };
}
