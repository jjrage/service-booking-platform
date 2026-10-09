import { existsSync } from "node:fs";

// Unlike the integration tests, these keep the Stripe keys from .env.local: they talk to Stripe's test mode.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
// E-mail stays in the log.
delete process.env.RESEND_API_KEY;
