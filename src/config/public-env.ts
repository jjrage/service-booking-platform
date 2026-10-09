import { parseEnv, publicEnvSchema } from "./env-schema";

// Each variable is referenced by its full name so Next.js can inline it into the browser bundle.
export const publicEnv = parseEnv(
  publicEnvSchema,
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  "public",
);
