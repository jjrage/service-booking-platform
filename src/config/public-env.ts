import { parseEnv, publicEnvSchema } from "./env-schema";

// Each variable is referenced by its full name so Next.js can inline it into the browser bundle.
export const publicEnv = parseEnv(
  publicEnvSchema,
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },
  "public",
);

export const appUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
