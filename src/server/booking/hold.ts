import "server-only";

import { findWindow } from "@/domain/availability";
import type { LocalDate, LocalTime } from "@/domain/time";

import { activeCrewIds, type Catalog } from "../catalog";
import { adminDb } from "../db/admin";
import { CommandError, ensureOk, unwrap } from "../db/errors";
import { toRange } from "../db/ranges";
import { alternativesFrom, loadBusy, type WindowChoice } from "./availability";

export type Hold = {
  token: string;
  expiresAt: string;
  date: LocalDate;
  localStart: LocalTime;
  localEnd: LocalTime;
  start: string;
  end: string;
};

export type HoldResult =
  | { ok: true; hold: Hold }
  | {
      ok: false;
      reason: "taken" | "unavailable";
      message: string;
      alternatives: WindowChoice[];
    };

/**
 * Holds an arrival window for a few minutes while the client checks out. The domain proposes the free crews;
 * the database decides: when several people pick the same window at once, the exclusion constraint lets as
 * many through as there are free crews and the rest get the next free windows instead.
 */
export async function holdWindow(
  catalog: Catalog,
  request: {
    date: LocalDate;
    localStart: LocalTime;
    durationMinutes: number;
    preferredCrewId?: string | null;
    /** The demo race narrows the candidates to one crew so two clients really compete for it. */
    onlyCrewIds?: string[];
  },
): Promise<HoldResult> {
  const [crewIds, busy] = await Promise.all([
    activeCrewIds(catalog.tenant.id),
    loadBusy(catalog, request.date, request.date),
  ]);
  const { day, window } = findWindow(
    {
      rules: catalog.schedule.rules,
      timeZone: catalog.tenant.timezone,
      now: new Date().toISOString(),
      durationMinutes: request.durationMinutes,
      crewIds: request.onlyCrewIds ?? crewIds,
      busy,
      preferredCrewId: request.preferredCrewId,
    },
    request.date,
    request.localStart,
  );

  if (!window || day.status !== "open" || window.status !== "available") {
    return {
      ok: false,
      reason: window?.status === "full" ? "taken" : "unavailable",
      message:
        window?.status === "full"
          ? "That window was just booked."
          : "That window cannot be booked.",
      alternatives: await alternativesFrom(catalog, request.date, request.durationMinutes),
    };
  }

  const result = await adminDb().rpc("cmd_hold_slot", {
    p_tenant_id: catalog.tenant.id,
    p_crew_ids: window.freeCrewIds,
    p_busy: toRange(window.busyStart, window.busyEnd),
    p_hold_minutes: catalog.schedule.rules.hold_minutes,
  });
  if (result.error?.code === "23P01") {
    return {
      ok: false,
      reason: "taken",
      message: "Someone booked that window a moment before you.",
      alternatives: await alternativesFrom(catalog, request.date, request.durationMinutes),
    };
  }
  const [row] = unwrap(result, "hold slot");
  if (!row) throw new CommandError("slot_taken", "hold returned no row");

  return {
    ok: true,
    hold: {
      token: row.hold_token,
      expiresAt: row.hold_expires_at,
      date: request.date,
      localStart: window.localStart,
      localEnd: window.localEnd,
      start: window.start,
      end: window.end,
    },
  };
}

export async function releaseHold(token: string): Promise<void> {
  ensureOk(await adminDb().rpc("cmd_release_hold", { p_hold_token: token }), "release hold");
}
