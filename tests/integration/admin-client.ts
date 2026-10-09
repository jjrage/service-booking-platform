import { createClient } from "@supabase/supabase-js";

import {
  parseEnv,
  publicEnvSchema,
  serverEnvSchema,
} from "@/config/env-schema";
import type { Database } from "@/db/database.types";

/** Service-role client for integration tests: it plays the app server calling the cmd_* functions. */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = parseEnv(
    publicEnvSchema,
    process.env,
    "public",
  );
  const { SUPABASE_SECRET_KEY } = parseEnv(
    serverEnvSchema,
    process.env,
    "server",
  );

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A [start, end) range in Postgres literal form, starting `daysAhead` days from now at 14:00 UTC. */
export function futureRange(daysAhead: number, hours: number): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysAhead);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return `[${start.toISOString()},${end.toISOString()})`;
}
