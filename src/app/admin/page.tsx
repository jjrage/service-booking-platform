import Link from "next/link";
import { Suspense } from "react";

import { addDays, toLocal } from "@/domain/time";
import { crewBoard, openAlerts } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { BookingStatus } from "@/ui/booking-status";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatDate, formatInstant, formatMoney } from "@/ui/format";

export default function AdminHome() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  const { staff } = await requireStaff("/admin");
  const today = toLocal(new Date().toISOString(), staff.timezone).date;
  const [todayBoard, weekBoard, alerts] = await Promise.all([
    crewBoard(staff, today, 1),
    crewBoard(staff, today, 7),
    openAlerts(staff),
  ]);
  const active = (status: string) => status === "confirmed" || status === "pending_payment";
  const todays = todayBoard.bookings.filter((b) => b.status !== "cancelled");
  const week = weekBoard.bookings.filter((b) => active(b.status));
  const weekRevenue = week.reduce((sum, b) => sum + b.totalCents, 0);
  const viaAi = week.filter((b) => b.source === "ai").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500">{formatDate(today, "long")}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Today</h1>
        </div>
        <ButtonLink href="/admin/calendar" variant="secondary">
          Open calendar
        </ButtonLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Visits today", String(todays.length)],
          ["Booked next 7 days", String(week.length)],
          ["Revenue next 7 days", formatMoney(weekRevenue)],
          ["Booked by the AI assistant", `${viaAi} of ${week.length}`],
        ].map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Today's visits" description="By crew, in arrival order" />
          {todays.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">No visits today.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {todayBoard.crews.map((crew) => {
                const visits = todays
                  .filter((b) => b.crewId === crew.id)
                  .sort((a, b) => a.windowStart.localeCompare(b.windowStart));
                return (
                  <div key={crew.id} className="px-5 py-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
                      <span className="size-2.5 rounded-full" style={{ background: crew.color }} />
                      {crew.name}
                      <span className="font-normal text-zinc-400">· {visits.length} visits</span>
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {visits.map((b) => (
                        <li key={b.id}>
                          <Link
                            href={`/admin/bookings/${b.id}`}
                            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50"
                          >
                            <span className="min-w-0 truncate">
                              <span className="tabular font-medium text-zinc-900">
                                {formatInstant(b.windowStart, staff.timezone, {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>{" "}
                              <span className="text-zinc-700">{b.clientName}</span>{" "}
                              <span className="text-zinc-400">
                                {b.serviceName} · {b.city}
                              </span>
                            </span>
                            <BookingStatus status={b.status} />
                          </Link>
                        </li>
                      ))}
                      {visits.length === 0 && (
                        <li className="px-2 text-sm text-zinc-400">Free day</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Needs attention"
            action={
              alerts.length > 0 ? (
                <Badge tone="danger">{alerts.length}</Badge>
              ) : (
                <Badge tone="success">All clear</Badge>
              )
            }
          />
          <ul className="divide-y divide-zinc-100 text-sm">
            {alerts.slice(0, 5).map((alert) => (
              <li key={alert.id} className="px-5 py-3">
                <p className="text-zinc-800">{alert.message}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatInstant(alert.created_at, staff.timezone)} ·{" "}
                  <Link href="/admin/alerts" className="underline">
                    Review
                  </Link>
                </p>
              </li>
            ))}
            {alerts.length === 0 && <li className="px-5 py-4 text-zinc-500">Nothing waiting.</li>}
          </ul>
          <div className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
            Next 7 days: through {formatDate(addDays(today, 6))}
          </div>
        </Card>
      </div>
    </div>
  );
}
