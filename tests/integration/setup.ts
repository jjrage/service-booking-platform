import { existsSync } from "node:fs";

// Local runs read the keys printed by `supabase status`; CI provides them as environment variables.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
