/**
 * Seeds the Wrenfield demo business (see src/demo/reset.ts): staff with logins, crews, services, rules,
 * clients with homes, eight weeks of history and three weeks of upcoming visits. Safe to re-run.
 *
 * Usage: npm run db:seed   (after npm run db:start or npm run db:reset)
 */
import { existsSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { parseEnv, publicEnvSchema, serverEnvSchema } from "@/config/env-schema";
import type { Database } from "@/db/database.types";
import { resetWrenfield } from "@/demo/reset";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl } = parseEnv(publicEnvSchema, process.env, "public");
const { SUPABASE_SECRET_KEY: secretKey } = parseEnv(serverEnvSchema, process.env, "server");

// A fixed password is fine for a local database; anywhere else it must come from the environment so the
// public repository never holds a working credential.
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(supabaseUrl);
const demoPassword =
  process.env.DEMO_USER_PASSWORD ?? (isLocal ? "wrenfield-local-demo" : undefined);
if (!demoPassword) {
  throw new Error("Set DEMO_USER_PASSWORD to seed a database that is not the local one.");
}

const admin = createClient<Database>(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`Seeding the demo business into ${supabaseUrl}`);
/**
 * If the app is running, let it schedule the plans' next 60 days and drop its cached catalog (the business
 * was recreated with new ids). Without a running app this is skipped; `npm run jobs:local` does it later.
 */
async function notifyApp() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  try {
    const response = await fetch(`${base}/api/jobs/plans`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    console.log(`Scheduled plan visits: ${JSON.stringify(await response.json())}`);
  } catch {
    console.log(
      "The app is not running; start it and run `npm run jobs:local` to schedule plan visits.",
    );
  }
}

resetWrenfield(admin, { demoPassword, log: console.log })
  .then(async () => {
    await notifyApp();
    if (isLocal) console.log(`Demo logins use the password "${demoPassword}" (local only).`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
