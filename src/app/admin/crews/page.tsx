import type { Metadata } from "next";
import { Suspense } from "react";

import { toLocal } from "@/domain/time";
import { crewsOverview } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { Skeleton } from "@/ui/feedback";
import { formatDate } from "@/ui/format";

import { RemoveTimeOff, TimeOffForm } from "./time-off";

export const metadata: Metadata = { title: "Crews & time off" };

export default function CrewsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Crews &amp; time off</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Crews />
      </Suspense>
    </div>
  );
}

async function Crews() {
  const { staff } = await requireStaff("/admin/crews");
  const { crews, members, timeOff } = await crewsOverview(staff);
  const today = toLocal(new Date().toISOString(), staff.timezone).date;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {crews.map((crew) => {
        const days = timeOff.filter((t) => t.crewId === crew.id);
        return (
          <Card key={crew.id}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: crew.color }} />
                  {crew.name}
                </span>
              }
              description={members
                .filter((m) => m.crew_id === crew.id)
                .map((m) => m.member.display_name)
                .join(" & ")}
            />
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm font-medium text-zinc-800">Upcoming time off</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {days.length === 0 && <li className="text-zinc-500">None scheduled.</li>}
                  {days.map((t) => {
                    const start = toLocal(t.start, staff.timezone).date;
                    const end = toLocal(t.end, staff.timezone).date;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2"
                      >
                        <span>
                          {formatDate(start)}
                          {end > start && ` – ${formatDate(end)}`}
                          {t.note && <span className="text-zinc-500"> · {t.note}</span>}
                        </span>
                        <RemoveTimeOff allocationId={t.id} />
                      </li>
                    );
                  })}
                </ul>
              </div>
              <TimeOffForm crewId={crew.id} today={today} />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
