/**
 * Forwards Stripe test-mode events to the local webhook, so payments confirm while developing. Needs the Stripe
 * CLI, on the PATH as `stripe` or at .tools/stripe/stripe.exe (git-ignored), and the test keys in .env.local.
 * If the CLI's webhook secret differs from STRIPE_WEBHOOK_SECRET, it is written to .env.local (restart the dev
 * server after that).
 *
 * Usage: npm run stripe:listen   (with `npm run dev` running)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envFile = ".env.local";
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const apiKey = process.env.STRIPE_SECRET_KEY ?? "";
if (!apiKey.startsWith("sk_test_")) {
  console.error("Set a Stripe test secret key (sk_test_…) as STRIPE_SECRET_KEY in .env.local.");
  process.exit(1);
}

const local = [".tools/stripe/stripe.exe", ".tools/stripe/stripe"].find((path) => existsSync(path));
const cli = local ?? "stripe";
const env = { ...process.env, STRIPE_API_KEY: apiKey };

// The events the webhook route handles (src/server/payments/stripe.ts).
const events = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.processing",
  "payment_intent.requires_action",
  "payment_intent.canceled",
  "setup_intent.succeeded",
  "setup_intent.setup_failed",
  "setup_intent.canceled",
];

const printed = spawnSync(cli, ["listen", "--print-secret"], { env, encoding: "utf8" });
const secret = printed.stdout?.trim() ?? "";
if (printed.error || !secret.startsWith("whsec_")) {
  console.error("Could not run the Stripe CLI. Put it on the PATH or at .tools/stripe/stripe.exe.");
  process.exit(1);
}
if (secret !== process.env.STRIPE_WEBHOOK_SECRET) {
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = `STRIPE_WEBHOOK_SECRET=${secret}`;
  writeFileSync(
    envFile,
    /^STRIPE_WEBHOOK_SECRET=.*$/m.test(text)
      ? text.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line)
      : `${text.trimEnd()}\n${line}\n`,
  );
  console.log("Wrote the CLI's webhook secret to .env.local; restart `npm run dev` to pick it up.");
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const listen = spawn(
  cli,
  ["listen", "--events", events.join(","), "--forward-to", `${appUrl}/api/stripe/webhook`],
  { env, stdio: "inherit" },
);
listen.on("exit", (code) => process.exit(code ?? 0));
