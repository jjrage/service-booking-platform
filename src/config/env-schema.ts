import { z } from "zod";

/**
 * Environment variables, split by where they may be read.
 *
 * Public values are inlined into the browser bundle by Next.js, so they must never hold secrets.
 * Server values are read only by modules that import "server-only".
 *
 * Integrations are optional: without Stripe keys payments run in a built-in simulator, without a Resend key
 * e-mails are only logged to the outbox, and without an Anthropic key the assistant is switched off.
 */

/** An unset variable and an empty one (`KEY=` in a .env file) both mean "not configured". */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
}

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: optional(z.url()),
  // Test mode only: a live key would take real money from people trying the demo.
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optional(
    z.string().startsWith("pk_test_", "use a Stripe test-mode key (pk_test_…)"),
  ),
});

export const serverEnvSchema = z.object({
  // Bypasses row-level security. Used only by server code after it has authorized the request.
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Signs guest links to a booking and the slot-hold cookie.
  APP_SECRET: z.string().min(32, "at least 32 characters"),
  STRIPE_SECRET_KEY: optional(
    z.string().startsWith("sk_test_", "use a Stripe test-mode key (sk_test_…)"),
  ),
  STRIPE_WEBHOOK_SECRET: optional(z.string().startsWith("whsec_")),
  RESEND_API_KEY: optional(z.string().startsWith("re_")),
  EMAIL_FROM: optional(z.string().min(3)),
  ANTHROPIC_API_KEY: optional(z.string().startsWith("sk-ant-")),
  ANTHROPIC_MODEL: optional(z.string().min(1)),
  // Shared secret for the scheduled-job endpoints (pg_cron and Vercel cron send it).
  CRON_SECRET: optional(z.string().min(16)),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parses a set of variables and throws one readable error listing every problem. */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} environment variables:\n${problems}`);
  }
  return result.data;
}
