import { describe, expect, it } from "vitest";

import { buildReport, type ReportBooking, type ReportPayment } from "./reports";

const base: ReportBooking = {
  id: "b1",
  status: "completed",
  source: "web",
  service: "Standard Clean",
  crewId: "blue",
  zone: "A",
  clientId: "c1",
  planId: null,
  totalCents: 20000,
  depositCents: 5000,
  durationMinutes: 120,
  date: "2026-10-05",
  week: "2026-10-05",
  createdInPeriod: true,
};

const visit = (patch: Partial<ReportBooking>): ReportBooking => ({ ...base, ...patch });

describe("buildReport()", () => {
  const bookings = [
    visit({ id: "b1" }),
    visit({
      id: "b2",
      clientId: "c1",
      service: "Deep Clean",
      totalCents: 30000,
      depositCents: 7500,
      crewId: "green",
      zone: "B",
      source: "ai",
    }),
    visit({
      id: "b3",
      clientId: "c2",
      planId: "p1",
      source: "plan",
      depositCents: 0,
      week: "2026-10-12",
      date: "2026-10-12",
    }),
    visit({ id: "b4", clientId: "c3", status: "cancelled", source: "portal" }),
    visit({ id: "b5", clientId: "c3", status: "no_access", source: "ai" }),
    visit({ id: "b6", clientId: "c4", status: "expired", source: "web" }),
  ];
  const payments: ReportPayment[] = [
    { bookingId: "b1", purpose: "deposit", status: "succeeded", netCents: 5000 },
    { bookingId: "b2", purpose: "deposit", status: "succeeded", netCents: 7500 },
    { bookingId: "b4", purpose: "cancellation_fee", status: "succeeded", netCents: 4000 },
    { bookingId: "b5", purpose: "no_access_fee", status: "succeeded", netCents: 5000 },
  ];
  const report = buildReport({
    bookings,
    payments,
    availableMinutes: new Map([
      ["blue", 1200],
      ["green", 1200],
    ]),
    activePlans: 1,
  });

  it("counts earned revenue as completed visits plus fees kept", () => {
    expect(report.visitsCompleted).toBe(3);
    expect(report.earnedCents).toBe(20000 + 30000 + 20000 + 4000 + 5000);
    expect(report.averageTicketCents).toBe(23333);
  });

  it("breaks revenue down by service, zone and crew", () => {
    expect(report.byService).toEqual([
      { key: "Standard Clean", cents: 40000, visits: 2 },
      { key: "Deep Clean", cents: 30000, visits: 1 },
    ]);
    expect(report.byZone.map((z) => z.key)).toEqual(["A", "B"]);
    expect(report.weekly).toEqual([
      { week: "2026-10-05", cents: 50000, visits: 2 },
      { week: "2026-10-12", cents: 20000, visits: 1 },
    ]);
  });

  it("measures the share of one-time revenue paid up front", () => {
    expect(report.prepaid).toEqual({
      depositCents: 12500,
      oneTimeRevenueCents: 50000,
      share: 0.25,
    });
  });

  it("reports cancellations and lockouts over settled bookings, ignoring expired checkouts", () => {
    expect(report.cancellations).toMatchObject({
      cancelled: 1,
      lockouts: 1,
      total: 5,
      rate: 0.4,
      feesCents: 9000,
    });
  });

  it("measures crew utilization from booked visit time", () => {
    expect(report.utilization.find((u) => u.crewId === "blue")).toEqual({
      crewId: "blue",
      bookedMinutes: 360,
      availableMinutes: 1200,
      share: 0.3,
    });
  });

  it("counts repeat clients and the share of bookings made through the assistant", () => {
    expect(report.retention).toMatchObject({
      repeatClients: 1,
      clientsServed: 2,
      repeatShare: 0.5,
    });
    // Of 4 non-plan bookings (expired checkouts excluded), 2 came through the AI assistant.
    expect(report.aiShare).toBe(0.5);
  });
});
