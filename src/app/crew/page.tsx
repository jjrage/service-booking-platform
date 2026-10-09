import Link from "next/link";
import { Suspense } from "react";

import { toLocal } from "@/domain/time";
import { requireCleaner } from "@/server/auth/viewer";
import { myCrew, myJobs, type CrewJob } from "@/server/crew";
import { BookingStatus } from "@/ui/booking-status";
import { Card } from "@/ui/card";
import { Skeleton } from "@/ui/feedback";
import { formatDate, formatDuration, formatWindow } from "@/ui/format";

export default function CrewHome() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Jobs />
    </Suspense>
  );
}

async function Jobs() {
  const viewer = await requireCleaner("/crew");
  const crew = await myCrew(viewer.staff, viewer.userId);
  if (!crew)
    return <Card className="p-6 text-zinc-600">You are not on a crew yet. Ask the office.</Card>;
  const today = toLocal(new Date().toISOString(), viewer.staff.timezone).date;
  const jobs = await myJobs(viewer.staff, crew.id, today, 7);
  const todays = jobs.filter((j) => j.date === today);
  const later = jobs.filter((j) => j.date > today);
  const days = [...new Set(later.map((j) => j.date))];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-zinc-900">Today</h1>
        <p className="text-sm text-zinc-500">{formatDate(today, "long")}</p>
        <div className="mt-3 space-y-3">
          {todays.length === 0 && <Card className="p-5 text-sm text-zinc-500">No jobs today.</Card>}
          {todays.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">This week</h2>
        <div className="mt-3 space-y-4">
          {days.map((day) => (
            <div key={day}>
              <p className="mb-2 text-sm font-medium text-zinc-700">{formatDate(day, "long")}</p>
              <div className="space-y-2">
                {later
                  .filter((j) => j.date === day)
                  .map((job) => (
                    <JobCard key={job.id} job={job} compact />
                  ))}
              </div>
            </div>
          ))}
          {days.length === 0 && (
            <p className="text-sm text-zinc-500">Nothing else scheduled this week.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function JobCard({ job, compact = false }: { job: CrewJob; compact?: boolean }) {
  return (
    <Link href={`/crew/jobs/${job.id}`} className="block">
      <Card className="p-4 transition hover:ring-brand-600">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-zinc-900">
              {formatWindow(job.localStart, job.localEnd)}
              <span className="font-normal text-zinc-500">
                {" "}
                · {formatDuration(job.durationMinutes)}
              </span>
            </p>
            <p className="text-sm text-zinc-700">
              {job.serviceName}
              {job.clientName && ` · ${job.clientName}`}
            </p>
            {!compact && (
              <p className="mt-1 truncate text-sm text-zinc-500">
                {job.address ? `${job.address}, ${job.city}` : "Address shown closer to the day"}
              </p>
            )}
          </div>
          <BookingStatus status={job.status} />
        </div>
      </Card>
    </Link>
  );
}
