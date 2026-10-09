import Link from "next/link";
import { Suspense } from "react";

import { requireClient } from "@/server/auth/viewer";
import { myVisits, type PortalVisit } from "@/server/portal";
import { BookingStatus } from "@/ui/booking-status";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatDate, formatMoney, formatWindow } from "@/ui/format";

export default function VisitsPage() {
  return (
    <Suspense fallback={<VisitsSkeleton />}>
      <Visits />
    </Suspense>
  );
}

async function Visits() {
  const { client } = await requireClient("/portal");
  const { upcoming, past } = await myVisits(client);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Hi, {client.fullName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-zinc-600">
            {upcoming.length === 0
              ? "You have no upcoming visits."
              : `You have ${upcoming.length} upcoming ${upcoming.length === 1 ? "visit" : "visits"}.`}
          </p>
        </div>
        <ButtonLink href={`/${client.slug}/book`}>Book a cleaning</ButtonLink>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Upcoming</h2>
        <div className="mt-3 space-y-3">
          {upcoming.length === 0 && (
            <Card className="p-6 text-sm text-zinc-500">Nothing scheduled.</Card>
          )}
          {upcoming.map((visit) => (
            <UpcomingVisit key={visit.id} visit={visit} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">History</h2>
        <Card className="mt-3 overflow-hidden">
          {past.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500">No past visits yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {past.map((visit) => (
                <li key={visit.id}>
                  <Link
                    href={`/portal/visits/${visit.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-zinc-50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-zinc-900">{formatDate(visit.date)}</span>
                      <span className="ml-2 text-zinc-500">{visit.serviceName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="tabular text-zinc-700">
                        {formatMoney(visit.totalCents, visit.currency)}
                      </span>
                      <BookingStatus status={visit.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function UpcomingVisit({ visit }: { visit: PortalVisit }) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-brand-50 py-2 text-brand-900">
          <span className="text-xs font-medium uppercase">
            {formatDate(visit.date).split(",")[0]}
          </span>
          <span className="text-xl font-semibold">{Number(visit.date.slice(8))}</span>
        </div>
        <div>
          <p className="font-semibold text-zinc-900">
            {formatDate(visit.date, "long")} · {formatWindow(visit.localStart, visit.localEnd)}
          </p>
          <p className="mt-0.5 text-sm text-zinc-600">
            {visit.serviceName} · #{visit.number}
            {visit.planId && (
              <Badge tone="brand" className="ml-2">
                Regular
              </Badge>
            )}
          </p>
          <p className="mt-0.5 text-sm text-zinc-500">{visit.address}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
        <span className="tabular font-semibold text-zinc-900">
          {formatMoney(visit.totalCents, visit.currency)}
        </span>
        <ButtonLink href={`/portal/visits/${visit.id}`} variant="secondary" size="sm">
          Reschedule or cancel
        </ButtonLink>
      </div>
    </Card>
  );
}

function VisitsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
    </div>
  );
}
