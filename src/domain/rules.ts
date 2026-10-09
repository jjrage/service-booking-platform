import { z } from "zod";

/**
 * Tenant rules are data, not code: they live in rule_versions (jsonb) and the owner edits them in the admin
 * console. These schemas are the contract between that data and the domain functions. The database only
 * checks that `rules` is an object; everything else is validated here before it is published or used.
 */

const code = z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase code");
const cents = z.int().min(0);
const minutes = z.int().min(0);
const percent = z.int().min(0).max(100);
const count = z.int().min(0);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time as HH:MM (24-hour)");
const localDate = z.iso.date();
const zip = z.string().regex(/^\d{5}$/, "5-digit ZIP");

const priced = z.object({ cents, minutes });

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof weekdays)[number];

export const frequencies = ["one_time", "weekly", "biweekly", "monthly"] as const;
export type Frequency = (typeof frequencies)[number];

export const pricingRulesSchema = z
  .object({
    services: z.record(
      code,
      z.object({
        base_cents: cents,
        base_minutes: minutes.min(15),
        /** Only bookable for an empty home (move-in / move-out). */
        empty_home_only: z.boolean().optional(),
        /** Can be booked as a recurring plan. */
        recurring: z.boolean().optional(),
      }),
    ),
    /** Home size covered by the base price. */
    included: z.object({
      bedrooms: count,
      full_baths: count,
      half_baths: count,
      sqft: count,
    }),
    home_size: z.object({
      bedroom: priced,
      full_bath: priced,
      half_bath: priced,
      sqft_step: priced.extend({ size: z.int().positive() }),
    }),
    addons: z.record(
      code,
      z.object({
        name: z.string().min(1),
        cents,
        minutes,
        per_unit: z.boolean().optional(),
        max_units: z.int().positive().optional(),
      }),
    ),
    condition: z.object({
      heavy: z.object({ percent, needs_review: z.boolean() }),
    }),
    frequency_discount_percent: z.object({
      one_time: percent,
      weekly: percent,
      biweekly: percent,
      monthly: percent,
    }),
    /** The first visit of a plan is priced as `upgrade_to` when the home was not cleaned professionally recently. */
    first_visit: z
      .object({
        upgrade_to: code,
        if_no_professional_clean_days: z.int().positive(),
      })
      .nullable(),
    minimum_cents: cents,
    zones: z
      .array(
        z.object({
          code: z.string().min(1),
          name: z.string().min(1),
          surcharge_cents: cents,
          zips: z.array(zip).min(1),
        }),
      )
      .min(1),
    deposit: z.object({ percent, minimum_cents: cents }),
  })
  .superRefine((rules, ctx) => {
    const seen = new Map<string, string>();
    for (const zone of rules.zones) {
      for (const zipCode of zone.zips) {
        const other = seen.get(zipCode);
        if (other && other !== zone.code) {
          ctx.addIssue({
            code: "custom",
            path: ["zones"],
            message: `ZIP ${zipCode} is in zones ${other} and ${zone.code}`,
          });
        }
        seen.set(zipCode, zone.code);
      }
    }
    if (rules.first_visit && !rules.services[rules.first_visit.upgrade_to]) {
      ctx.addIssue({
        code: "custom",
        path: ["first_visit", "upgrade_to"],
        message: `Unknown service "${rules.first_visit.upgrade_to}"`,
      });
    }
  });

export type PricingRules = z.infer<typeof pricingRulesSchema>;

const openHours = z
  .tuple([localTime, localTime])
  .refine(([open, close]) => open < close, "opening time must be before closing time")
  .nullable();

export const scheduleRulesSchema = z
  .object({
    business_hours: z.object({
      mon: openHours,
      tue: openHours,
      wed: openHours,
      thu: openHours,
      fri: openHours,
      sat: openHours,
      sun: openHours,
    }),
    arrival_windows: z
      .array(
        z
          .tuple([localTime, localTime])
          .refine(([start, end]) => start < end, "window start must be before its end"),
      )
      .min(1),
    travel_buffer_minutes: z.int().min(0).max(240),
    /** Orders placed before this local time can book from tomorrow; later orders from the day after. */
    next_day_cutoff: localTime,
    horizon_days: z.int().min(1).max(365),
    hold_minutes: z.int().min(1).max(60),
    payment_window_minutes: z.int().min(5).max(1440),
    closed_dates: z.array(localDate),
  })
  .superRefine((rules, ctx) => {
    const starts = rules.arrival_windows.map(([start]) => start);
    if (starts.some((start, i) => i > 0 && start <= starts[i - 1]!)) {
      ctx.addIssue({
        code: "custom",
        path: ["arrival_windows"],
        message: "arrival windows must be sorted and must not repeat",
      });
    }
  });

export type ScheduleRules = z.infer<typeof scheduleRulesSchema>;

export const cancellationRulesSchema = z
  .object({
    /** Cancelling or rescheduling at least this many hours before the arrival window is free. */
    free_before_hours: z.int().min(0),
    /** Fee between `late_within_hours` and `free_before_hours`. */
    flat_fee_cents: cents,
    late_within_hours: z.int().min(0),
    /** Fee inside `late_within_hours`, as a share of the visit price. */
    late_fee_percent: percent,
    /** Fee when the crew could not get in (lockout). */
    no_access_fee_percent: percent,
  })
  .refine(
    (rules) => rules.late_within_hours <= rules.free_before_hours,
    "the late-fee period must fit inside the free-cancellation period",
  );

export type CancellationRules = z.infer<typeof cancellationRulesSchema>;

export const ruleSchemas = {
  pricing: pricingRulesSchema,
  schedule: scheduleRulesSchema,
  cancellation: cancellationRulesSchema,
} as const;

export type RuleKind = keyof typeof ruleSchemas;
