import "server-only";

import { revalidateTag } from "next/cache";

import { resetWrenfield } from "@/demo/reset";

import { demoPassword } from "./auth/demo";
import { catalogTag } from "./catalog";
import { adminDb } from "./db/admin";
import { unwrap } from "./db/errors";
import { sendDueOutbox } from "./notifications/sender";
import { materializePlans } from "./plans";

/**
 * Scheduled work. `tick` runs every minute (pg_cron in Supabase calls the jobs endpoint); `nightly` runs once
 * a day (Vercel cron). `tick` and `plans` are safe to run twice or concurrently.
 */
export const jobs = {
  /** Releases expired slot holds and unpaid bookings, then sends due messages. */
  async tick() {
    const [expired] = unwrap(await adminDb().rpc("cmd_expire_stale"), "expire stale");
    const outbox = await sendDueOutbox(50);
    return { ...expired, ...outbox };
  },

  /**
   * Creates the next 60 days of visits for every active plan. Also refreshes each business's cached catalog,
   * so a reseeded database (new ids) is picked up at once.
   */
  async plans() {
    const tenants = unwrap(await adminDb().from("tenants").select("id, slug"), "load tenants");
    for (const tenant of tenants) revalidateTag(catalogTag(tenant.slug), { expire: 0 });
    let created = 0;
    let conflicts = 0;
    for (const tenant of tenants) {
      const result = await materializePlans(tenant.id);
      created += result.created;
      conflicts += result.conflicts;
    }
    return { created, conflicts };
  },

  /**
   * The nightly demo reset: rebuilds the demo business around today's date (visitors' test bookings and
   * edits are wiped), then schedules its regular visits. Also keeps a free Supabase project from pausing.
   */
  async nightly() {
    const password = demoPassword();
    if (!password) return { reset: "skipped: DEMO_USER_PASSWORD is not set" };
    const reset = await resetWrenfield(adminDb(), { demoPassword: password });
    // The business was recreated with a new id; plans() also drops the cached catalog of the old one.
    const plans = await jobs.plans();
    return { reset: "done", bookings: reset.bookings, ...plans };
  },
} as const;

export type JobName = keyof typeof jobs;
