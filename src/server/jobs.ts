import "server-only";

import { adminDb } from "./db/admin";
import { unwrap } from "./db/errors";
import { sendDueOutbox } from "./notifications/sender";
import { materializePlans } from "./plans";

/**
 * Scheduled work. `tick` runs every minute (pg_cron in Supabase calls the jobs endpoint); `plans` and
 * `nightly` run once a day (Vercel cron). Every job is safe to run twice or concurrently.
 */
export const jobs = {
  /** Releases expired slot holds and unpaid bookings, then sends due messages. */
  async tick() {
    const [expired] = unwrap(await adminDb().rpc("cmd_expire_stale"), "expire stale");
    const outbox = await sendDueOutbox(50);
    return { ...expired, ...outbox };
  },

  /** Creates the next 60 days of visits for every active plan. */
  async plans() {
    const tenants = unwrap(await adminDb().from("tenants").select("id"), "load tenants");
    let created = 0;
    let conflicts = 0;
    for (const tenant of tenants) {
      const result = await materializePlans(tenant.id);
      created += result.created;
      conflicts += result.conflicts;
    }
    return { created, conflicts };
  },
} as const;

export type JobName = keyof typeof jobs;
