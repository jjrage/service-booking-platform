import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { frequencyLabel } from "@/domain/quote";
import type { Frequency } from "@/domain/rules";
import { requireClient } from "@/server/auth/viewer";
import { myPlans } from "@/server/portal";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatDate, formatDuration, formatMoney, formatWindow } from "@/ui/format";

import { PlanControls } from "./plan-controls";

export const metadata: Metadata = { title: "Regular plan" };

export default function PlanPage() {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <Plans />
    </Suspense>
  );
}

async function Plans() {
  const { client } = await requireClient("/portal/plan");
  const plans = await myPlans(client);

  if (plans.length === 0) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">No regular plan yet</h1>
        <p className="mx-auto mt-2 max-w-md text-zinc-600">
          Weekly or every-other-week cleaning with the same crew, up to 15% off every visit after
          the first.
        </p>
        <ButtonLink href={`/${client.slug}/book`} className="mt-5">
          Set up regular cleaning
        </ButtonLink>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Regular plan</h1>
      {plans.map((plan) => (
        <Card key={plan.id} className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
            <div>
              <p className="text-lg font-semibold text-zinc-900">
                {frequencyLabel(plan.frequency as Frequency)} · {plan.weekday}s,{" "}
                {formatWindow(plan.windowStart, plan.windowEnd)}
              </p>
              <p className="mt-0.5 text-sm text-zinc-600">
                {plan.serviceName} at {plan.address} · about {formatDuration(plan.durationMinutes)}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-lg font-semibold text-zinc-900">
                {formatMoney(plan.priceCents, plan.currency)}
              </p>
              <p className="text-xs text-zinc-500">per visit, price locked</p>
            </div>
          </div>
          <div className="grid gap-6 px-5 py-4 md:grid-cols-[1fr_280px]">
            <div>
              <p className="text-sm font-medium text-zinc-800">Next visits</p>
              {plan.status === "paused" && (
                <p className="mt-2">
                  <Badge tone="warning">Paused until {formatDate(plan.pausedUntil!, "long")}</Badge>
                </p>
              )}
              <ul className="mt-2 space-y-1.5 text-sm">
                {plan.nextVisits.length === 0 && (
                  <li className="text-zinc-500">No visits scheduled in the next weeks.</li>
                )}
                {plan.nextVisits.map((visit) => (
                  <li key={visit.id} className="flex items-center justify-between gap-3">
                    <span className="text-zinc-700">
                      {formatDate(visit.date, "long")},{" "}
                      {formatWindow(visit.localStart, visit.localEnd)}
                    </span>
                    <Link
                      href={`/portal/visits/${visit.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Skip or move
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <PlanControls planId={plan.id} status={plan.status} />
          </div>
        </Card>
      ))}
    </div>
  );
}
