import "server-only";

import { nextAvailable } from "@/domain/availability";
import { addDays, toLocal } from "@/domain/time";

import type { Catalog } from "../catalog";
import { adminDb } from "../db/admin";
import { toRange } from "../db/ranges";
import { alternativesFrom, windowsFor, type WindowChoice } from "./availability";
import { releaseHold } from "./hold";

export type RaceContender = {
  index: number;
  outcome: "won" | "lost";
  code: string | null;
  ms: number;
};

export type RaceResult = {
  window: WindowChoice;
  crewName: string;
  contenders: RaceContender[];
  alternatives: WindowChoice[];
};

/**
 * The "race two bookings" demo: N clients try to hold the same arrival window of the same crew at the same
 * moment. Each attempt is its own HTTP request and database transaction, exactly like real checkouts. The
 * exclusion constraint lets one through; the others get SQLSTATE 23P01 and are offered other windows.
 * The winning hold is released right away so the demo never blocks a real slot.
 */
export async function raceForWindow(
  catalog: Catalog,
  contenders: number,
): Promise<RaceResult | null> {
  const durationMinutes = 120;
  const today = toLocal(new Date().toISOString(), catalog.tenant.timezone).date;
  const days = await windowsFor(catalog, {
    from: addDays(today, 1),
    to: addDays(today, 21),
    durationMinutes,
  });
  const target = nextAvailable(days, 1)[0];
  if (!target) return null;

  const crewId = target.freeCrewIds[0]!;
  const { data: crew } = await adminDb().from("crews").select("name").eq("id", crewId).single();
  const busy = toRange(target.busyStart, target.busyEnd);

  const attempts = await Promise.all(
    Array.from({ length: contenders }, async (_, index) => {
      const started = performance.now();
      const result = await adminDb().rpc("cmd_hold_slot", {
        p_tenant_id: catalog.tenant.id,
        p_crew_ids: [crewId],
        p_busy: busy,
        p_hold_minutes: 1,
      });
      return {
        index: index + 1,
        outcome: result.error ? ("lost" as const) : ("won" as const),
        code: result.error?.code ?? null,
        ms: Math.round(performance.now() - started),
        token: result.data?.[0]?.hold_token ?? null,
      };
    }),
  );

  await Promise.all(attempts.filter((a) => a.token).map((a) => releaseHold(a.token!)));

  const window: WindowChoice = {
    date: target.date,
    localStart: target.localStart,
    localEnd: target.localEnd,
    start: target.start,
    end: target.end,
    status: "available",
  };
  return {
    window,
    crewName: crew?.name ?? "the crew",
    contenders: attempts.map(({ token: _token, ...rest }) => rest),
    alternatives: (await alternativesFrom(catalog, target.date, durationMinutes, 4)).filter(
      (w) => !(w.date === target.date && w.localStart === target.localStart),
    ),
  };
}
