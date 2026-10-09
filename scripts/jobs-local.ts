/**
 * Runs the scheduled jobs against the local dev server, standing in for pg_cron (every minute) and Vercel cron
 * (daily) while developing.
 *
 * Usage: npm run jobs:local   (with `npm run dev` running)
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("Set CRON_SECRET in .env.local");

async function run(job: string) {
  try {
    const response = await fetch(`${base}/api/jobs/${job}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    console.log(
      new Date().toISOString(),
      job,
      response.status,
      JSON.stringify(await response.json()),
    );
  } catch (error) {
    console.error(
      new Date().toISOString(),
      job,
      "failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

void (async () => {
  await run("plans");
  await run("tick");
  setInterval(() => void run("tick"), 60_000);
  setInterval(() => void run("plans"), 60 * 60_000);
})();
