import { describe, expect, it } from "vitest";

import { expandSeries, type SeriesRule } from "./series";
import { toLocal } from "./time";

const everyOtherMonday: SeriesRule = {
  frequency: "biweekly",
  firstDate: "2026-10-26",
  windowStart: "08:00",
  windowEnd: "09:00",
  timeZone: "America/New_York",
};

describe("expandSeries()", () => {
  it("keeps a biweekly 8:00 visit at 8:00 local across the end of daylight saving time (Nov 1, 2026)", () => {
    const visits = expandSeries(everyOtherMonday, {
      from: "2026-10-01",
      through: "2026-11-30",
    });

    expect(visits.map((v) => [v.date, v.start])).toEqual([
      ["2026-10-26", "2026-10-26T12:00:00Z"], // EDT, UTC−4
      ["2026-11-09", "2026-11-09T13:00:00Z"], // EST, UTC−5
      ["2026-11-23", "2026-11-23T13:00:00Z"],
    ]);
    for (const visit of visits) {
      expect(toLocal(visit.start, "America/New_York").time).toBe("08:00");
      expect(toLocal(visit.end, "America/New_York").time).toBe("09:00");
    }
  });

  it("starts from the first occurrence inside the range", () => {
    const visits = expandSeries(everyOtherMonday, {
      from: "2026-11-10",
      through: "2026-12-31",
    });
    expect(visits.map((v) => v.date)).toEqual([
      "2026-11-23",
      "2026-12-07",
      "2026-12-21",
    ]);
  });

  it("repeats weekly and every 4 weeks on the same weekday", () => {
    const range = { from: "2026-10-26", through: "2026-12-31" };
    expect(
      expandSeries({ ...everyOtherMonday, frequency: "weekly" }, range),
    ).toHaveLength(10);
    expect(
      expandSeries({ ...everyOtherMonday, frequency: "monthly" }, range).map(
        (v) => v.date,
      ),
    ).toEqual(["2026-10-26", "2026-11-23", "2026-12-21"]);
  });

  it("drops skipped visits and flags visits on closed dates", () => {
    const visits = expandSeries(
      { ...everyOtherMonday, frequency: "weekly", firstDate: "2026-12-17" },
      {
        from: "2026-12-01",
        through: "2027-01-07",
        closedDates: ["2026-12-24"],
        skipDates: ["2026-12-31"],
      },
    );
    expect(visits.map((v) => [v.date, v.closed])).toEqual([
      ["2026-12-17", false],
      ["2026-12-24", true],
      ["2027-01-07", false],
    ]);
  });
});
