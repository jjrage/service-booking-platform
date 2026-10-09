import { existsSync } from "node:fs";

// Local runs read the keys printed by `supabase status`; CI provides them as environment variables.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// Tests never reach real payment or e-mail services, even when .env.local has keys: payments run in the
// simulator and e-mail goes to the log. (The Anthropic key stays: the chat test points the SDK at a local
// stand-in, and the AI evals need the real model.)
for (const key of [
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
]) {
  delete process.env[key];
}
