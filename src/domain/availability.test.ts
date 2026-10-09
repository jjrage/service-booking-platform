import { describe, expect, it } from "vitest";

import { wrenfieldScheduleRules as rules } from "@/demo/wrenfield";

import {
  availableWindows,
  bookableDates,
  findWindow,
  nextAvailable,
  type AvailabilityQuery,
} from "./availability";
import { scheduleRulesSchema } from "./rules";

const timeZone = "America/New_York";
const crews = ["blue", "green", "amber"];
// Friday 2026-10-09, 9:00 in Raleigh (EDT, UTC−4).
const fridayMorning = "2026-10-09T13:00:00Z";

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    rules,
    timeZone,
    now: fridayMorning,
    from: "2026-10-12",
    to: "2026-10-12",
    durationMinutes: 120,
    crewIds: crews,
    busy: [],
    ...overrides,
  };
}

describe("bookableDates()", () => {
  it("opens tomorrow before the 15:00 cutoff and the day after tomorrow after it", () => {
    expect(bookableDates(rules, timeZone, fridayMorning)).toEqual({
      first: "2026-10-10",
      last: "2026-12-08",
    });
    // 16:00 local
    expect(bookableDates(rules, timeZone, "2026-10-09T20:00:00Z").first).toBe(
      "2026-10-11",
    );
  });
});

describe("availableWindows()", () => {
  it("offers the three arrival windows on an open day, each for every crew", () => {
    const [monday] = availableWindows(query());

    expect(monday?.status).toBe("open");
    expect(
      monday?.windows.map((w) => [
        w.localStart,
        w.status,
        w.freeCrewIds.length,
      ]),
    ).toEqual([
      ["08:00", "available", 3],
      ["11:00", "available", 3],
      ["14:00", "available", 3],
    ]);
  });

  it("holds the crew from the window start to the latest finish plus the travel buffer", () => {
    const [monday] = availableWindows(query());
    const eight = monday!.windows[0]!;

    // 8:00 EDT = 12:00 UTC; latest finish 9:00 + 2 h, plus 30 min travel = 11:30 EDT
    expect([eight.start, eight.end]).toEqual([
      "2026-10-12T12:00:00Z",
      "2026-10-12T13:00:00Z",
    ]);
    expect([eight.busyStart, eight.busyEnd]).toEqual([
      "2026-10-12T12:00:00Z",
      "2026-10-12T15:30:00Z",
    ]);
  });

  it("keeps windows from which a long visit would run past closing time", () => {
    const [monday] = availableWindows(query({ durationMinutes: 240 }));

    // 14:00–15:00 + 4 h ends at 19:00, after the 18:00 close
    expect(monday?.windows.map((w) => w.status)).toEqual([
      "available",
      "available",
      "too_long",
    ]);
  });

  it("closes Sundays, holidays and days outside the booking horizon", () => {
    const days = availableWindows(
      query({ from: "2026-10-09", to: "2026-10-11" }),
    );
    expect(days.map((d) => [d.date, d.status])).toEqual([
      ["2026-10-09", "too_soon"],
      ["2026-10-10", "open"],
      ["2026-10-11", "closed"],
    ]);

    const [thanksgiving] = availableWindows(
      query({ from: "2026-11-26", to: "2026-11-26" }),
    );
    expect(thanksgiving?.status).toBe("holiday");

    const [tooFar] = availableWindows(
      query({ from: "2026-12-09", to: "2026-12-09" }),
    );
    expect(tooFar?.status).toBe("beyond_horizon");

    const [staffBooking] = availableWindows(
      query({
        from: "2026-12-09",
        to: "2026-12-09",
        ignoreBookingHorizon: true,
      }),
    );
    expect(staffBooking?.status).toBe("open");
  });

  it("skips busy crews and reports a window as full when every crew is taken", () => {
    const busy = [
      // blue: an earlier job that runs into the 11:00 window's occupancy
      {
        crewId: "blue",
        start: "2026-10-12T12:00:00Z",
        end: "2026-10-12T15:30:00Z",
      },
      // green: time off all day
      {
        crewId: "green",
        start: "2026-10-12T04:00:00Z",
        end: "2026-10-13T04:00:00Z",
      },
      // amber: a job that ends exactly when the 14:00 window starts (half-open intervals touch)
      {
        crewId: "amber",
        start: "2026-10-12T15:00:00Z",
        end: "2026-10-12T18:00:00Z",
      },
    ];
    const [monday] = availableWindows(query({ busy }));

    expect(monday?.windows.map((w) => [w.localStart, w.freeCrewIds])).toEqual([
      ["08:00", []],
      ["11:00", []],
      ["14:00", ["blue", "amber"]],
    ]);
    expect(monday?.windows[0]?.status).toBe("full");
  });

  it("tries the preferred crew first, then the least loaded one", () => {
    const busy = [
      // blue already has a job that day (8:00), green has none
      {
        crewId: "blue",
        start: "2026-10-12T12:00:00Z",
        end: "2026-10-12T15:30:00Z",
      },
    ];
    const [monday] = availableWindows(query({ busy }));
    expect(monday?.windows[2]?.freeCrewIds).toEqual(["green", "amber", "blue"]);

    const [withPreference] = availableWindows(
      query({ busy, preferredCrewId: "blue" }),
    );
    expect(withPreference?.windows[2]?.freeCrewIds).toEqual([
      "blue",
      "green",
      "amber",
    ]);
  });

  it("converts local windows to UTC on each date, across the end of daylight saving time", () => {
    const days = availableWindows(
      query({ from: "2026-10-31", to: "2026-11-02" }),
    );
    const starts = days
      .filter((d) => d.status === "open")
      .map((d) => d.windows[0]?.start);

    // Saturday before the change is EDT (UTC−4); Monday after it is EST (UTC−5). Both are 8:00 locally.
    expect(starts).toEqual(["2026-10-31T12:00:00Z", "2026-11-02T13:00:00Z"]);
  });

  it("finds a requested window and lists the next free ones", () => {
    const { window } = findWindow(query(), "2026-10-12", "11:00");
    expect(window?.start).toBe("2026-10-12T15:00:00Z");

    const days = availableWindows(
      query({ from: "2026-10-10", to: "2026-10-12" }),
    );
    expect(
      nextAvailable(days, 4).map((w) => `${w.date} ${w.localStart}`),
    ).toEqual([
      "2026-10-10 08:00",
      "2026-10-10 11:00",
      "2026-10-10 14:00",
      "2026-10-12 08:00",
    ]);
  });
});

describe("schedule rules", () => {
  it("accepts the demo rules and rejects unsorted arrival windows", () => {
    expect(scheduleRulesSchema.safeParse(rules).success).toBe(true);
    expect(
      scheduleRulesSchema.safeParse({
        ...rules,
        arrival_windows: [
          ["11:00", "12:00"],
          ["08:00", "09:00"],
        ],
      }).success,
    ).toBe(false);
  });
});
