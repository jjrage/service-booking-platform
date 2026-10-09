import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/config/server-env";
import { jobs, type JobName } from "@/server/jobs";

/**
 * Entry point for scheduled jobs: pg_cron + pg_net in Supabase (every minute) and Vercel cron (daily) call
 * it with `Authorization: Bearer <CRON_SECRET>`. Without a configured secret the endpoint is closed.
 */
async function run(request: Request, { params }: RouteContext<"/api/jobs/[job]">) {
  const secret = serverEnv.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (
    !secret ||
    given.length !== secret.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  if (!(job in jobs)) {
    return Response.json({ error: `unknown job ${job}` }, { status: 404 });
  }
  const started = Date.now();
  const result = await jobs[job as JobName]();
  return Response.json({ job, ms: Date.now() - started, ...result });
}

export const GET = run;
export const POST = run;
