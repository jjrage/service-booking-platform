import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { addDays, minutesOfDay, toLocal, weekdayOf } from "@/domain/time";
import { crewBoard } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { buttonClasses } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Skeleton } from "@/ui/feedback";
import { formatDate } from "@/ui/format";

import { CrewCalendar, type CalendarBlock } from "./crew-calendar";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  return (
    <Suspense fallback={<Skeleton className="h-[480px]" />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

const weekdayIndex = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;

async function Calendar({ searchParams }: Pick<PageProps<"/admin/calendar">, "searchParams">) {
  const { staff } = await requireStaff("/admin/calendar");
  const params = await searchParams;
  const today = toLocal(new Date().toISOString(), staff.timezone).date;
  const view = params.view === "week" ? "week" : "day";
  const requested =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : today;
  // A week starts on Monday.
  const from =
    view === "week" ? addDays(requested, -weekdayIndex[weekdayOf(requested)]) : requested;
  const days = view === "week" ? 6 : 1;

  const board = await crewBoard(staff, from, days);
  const minutes = (instant: string, date: string) => {
    const local = toLocal(instant, staff.timezone);
    // Clamp to the day being drawn (time off can span several days).
    if (local.date < date) return 0;
    if (local.date > date) return 24 * 60;
    return minutesOfDay(local.time);
  };

  const blocks: CalendarBlock[] = [
    ...board.bookings.map((b) => ({
      kind: "booking" as const,
      id: b.id,
      crewId: b.crewId,
      date: b.date,
      start: minutes(b.windowStart, b.date),
      windowEnd: minutes(b.windowEnd, b.date),
      jobEnd: minutes(b.jobEnd, b.date),
      busyEnd: minutes(b.busyEnd, b.date),
      title: b.clientName,
      subtitle: `${b.serviceName} · ${b.city}`,
      status: b.status,
      number: b.number,
      totalCents: b.totalCents,
      regular: b.planId !== null,
      ai: b.source === "ai",
    })),
    ...board.timeOff.flatMap((t) =>
      Array.from({ length: days }, (_, i) => addDays(from, i))
        .filter(
          (date) =>
            toLocal(t.start, staff.timezone).date <= date &&
            date < toLocal(t.end, staff.timezone).date,
        )
        .map((date) => ({
          kind: "time_off" as const,
          id: `${t.id}:${date}`,
          crewId: t.crewId,
          date,
          start: minutes(t.start, date),
          windowEnd: minutes(t.end, date),
          jobEnd: minutes(t.end, date),
          busyEnd: minutes(t.end, date),
          title: "Time off",
          subtitle: t.note ?? "",
          status: "time_off",
          number: 0,
          totalCents: 0,
          regular: false,
          ai: false,
        })),
    ),
  ];

  const link = (date: string, nextView = view) => `/admin/calendar?view=${nextView}&date=${date}`;
  const step = view === "week" ? 7 : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {view === "week" ? `Week of ${formatDate(from, "long")}` : formatDate(from, "long")}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Drag a visit onto another crew to reassign it. The database refuses any overlap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-zinc-200">
            {(["day", "week"] as const).map((v) => (
              <Link
                key={v}
                href={link(requested, v)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm capitalize",
                  v === view ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100",
                )}
              >
                {v}
              </Link>
            ))}
          </div>
          <Link href={link(addDays(from, -step))} className={buttonClasses("secondary", "sm")}>
            ←
          </Link>
          <Link href={link(today)} className={buttonClasses("secondary", "sm")}>
            Today
          </Link>
          <Link href={link(addDays(from, step))} className={buttonClasses("secondary", "sm")}>
            →
          </Link>
        </div>
      </div>

      <CrewCalendar
        view={view}
        days={Array.from({ length: days }, (_, i) => addDays(from, i))}
        today={today}
        crews={board.crews}
        blocks={blocks}
        nowMinute={
          from <= today
            ? minutesOfDay(toLocal(new Date().toISOString(), staff.timezone).time)
            : null
        }
      />
    </div>
  );
}
