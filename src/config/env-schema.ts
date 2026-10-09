import { z } from "zod";

/**
 * Environment variables, split by where they may be read.
 *
 * Public values are inlined into the browser bundle by Next.js, so they must never hold secrets.
 * Server values are read only by modules that import "server-only".
 */

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const serverEnvSchema = z.object({
  // Bypasses row-level security. Used only by the narrow set of server paths listed in docs.
  SUPABASE_SECRET_KEY: z.string().min(1),
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
