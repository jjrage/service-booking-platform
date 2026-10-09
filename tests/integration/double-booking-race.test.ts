import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient, futureRange } from "./admin-client";

/**
 * Twenty clients press "Book" for the same arrival window at the same moment. Each request goes through
 * the Data API as its own transaction, exactly like real checkouts. The exclusion constraint must let
 * exactly as many through as there are crews, and refuse the rest with SQLSTATE 23P01.
 */

const PARALLEL_REQUESTS = 20;
const admin = createAdminClient();

let tenantId: string;
let crewIds: string[];

beforeAll(async () => {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({
      slug: `race-test-${crypto.randomUUID().slice(0, 8)}`,
      name: "Race test (temporary)",
      timezone: "America/New_York",
    })
    .select("id")
    .single();
  if (tenantError) throw tenantError;
  tenantId = tenant.id;

  const { data: crews, error: crewError } = await admin
    .from("crews")
    .insert([1, 2, 3].map((n) => ({ tenant_id: tenantId, name: `Crew ${n}` })))
    .select("id");
  if (crewError) throw crewError;
  crewIds = crews.map((crew) => crew.id);
});

afterAll(async () => {
  if (tenantId) {
    await admin.from("tenants").delete().eq("id", tenantId);
  }
});

function holdConcurrently(candidateCrewIds: string[], busy: string) {
  return Promise.all(
    Array.from({ length: PARALLEL_REQUESTS }, () =>
      admin.rpc("cmd_hold_slot", {
        p_tenant_id: tenantId,
        p_crew_ids: candidateCrewIds,
        p_busy: busy,
        p_hold_minutes: 10,
      }),
    ),
  );
}

async function allocationsOverlapping(busy: string) {
  const { data, error } = await admin
    .from("crew_allocations")
    .select("crew_id")
    .eq("tenant_id", tenantId)
    .overlaps("busy", busy);
  if (error) throw error;
  return data;
}

describe("double booking under concurrent load", () => {
  it(`lets exactly one of ${PARALLEL_REQUESTS} simultaneous requests take a one-crew slot`, async () => {
    const busy = futureRange(3, 3.5);
    const results = await holdConcurrently([crewIds[0]!], busy);

    const winners = results.filter((result) => !result.error);
    const losers = results.filter((result) => result.error);

    expect(winners).toHaveLength(1);
    expect(losers.map((result) => result.error?.code)).toEqual(
      Array(PARALLEL_REQUESTS - 1).fill("23P01"),
    );
    expect(await allocationsOverlapping(busy)).toHaveLength(1);
  });

  it(`gives each of three crews to exactly one of ${PARALLEL_REQUESTS} simultaneous requests`, async () => {
    const busy = futureRange(4, 3.5);
    const results = await holdConcurrently(crewIds, busy);

    const heldCrews = results.flatMap((result) => result.data ?? []).map((row) => row.crew_id);

    expect(heldCrews).toHaveLength(3);
    expect(new Set(heldCrews)).toEqual(new Set(crewIds));
    expect(results.filter((result) => result.error?.code === "23P01")).toHaveLength(
      PARALLEL_REQUESTS - 3,
    );
    expect(await allocationsOverlapping(busy)).toHaveLength(3);
  });
});
