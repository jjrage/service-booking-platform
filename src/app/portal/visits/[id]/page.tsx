import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requireClient } from "@/server/auth/viewer";
import { myVisit } from "@/server/portal";
import { BookingStatus, paymentPurpose } from "@/ui/booking-status";
import { Card, CardHeader } from "@/ui/card";
import { Skeleton } from "@/ui/feedback";
import { formatDate, formatDuration, formatInstant, formatMoney, formatWindow } from "@/ui/format";

import { VisitActions } from "./visit-actions";

export default function VisitPage({ params }: PageProps<"/portal/visits/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Visit params={params} />
    </Suspense>
  );
}

async function Visit({ params }: Pick<PageProps<"/portal/visits/[id]">, "params">) {
  const { id } = await params;
  const { client } = await requireClient(`/portal/visits/${id}`);
  const found = /^[0-9a-f-]{36}$/.test(id) ? await myVisit(client, id) : null;
  if (!found) notFound();
  const { visit, payments, changeable } = found;
  const money = (cents: number) => formatMoney(cents, visit.currency);

  return (
    <div className="space-y-6">
      <Link href="/portal" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← All visits
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            Visit #{visit.number} · {visit.serviceName}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
            {formatDate(visit.date, "long")}
          </h1>
          <p className="mt-1 text-zinc-600">
            Arrival {formatWindow(visit.localStart, visit.localEnd)} · about{" "}
            {formatDuration(visit.durationMinutes)}
          </p>
        </div>
        <BookingStatus status={visit.status} />
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {changeable ? (
            <VisitActions
              bookingId={visit.id}
              currency={visit.currency}
              isPlanVisit={visit.planId !== null}
              currentDate={visit.date}
            />
          ) : (
            <Card className="p-5 text-sm text-zinc-600">
              {visit.status === "cancelled"
                ? "This visit is cancelled. Any fee or refund is listed under Payments."
                : visit.status === "completed"
                  ? "This visit is done. The receipt is listed under Payments."
                  : "This visit can no longer be changed online. Call us if something is wrong."}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5 text-sm">
            <p className="text-zinc-500">Address</p>
            <p className="mt-1 font-medium text-zinc-900">{visit.address}</p>
            <p className="mt-4 text-zinc-500">Price</p>
            <p className="tabular mt-1 text-lg font-semibold text-zinc-900">
              {money(visit.totalCents)}
            </p>
          </Card>
          <Card>
            <CardHeader title="Payments" />
            {payments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">
                {visit.planId ? "Charged to your saved card after the visit." : "No payments yet."}
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="px-5 py-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-700">{paymentPurpose(p.purpose)}</span>
                      <span className="tabular font-medium text-zinc-900">
                        {money(p.amountCents)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-3 text-xs text-zinc-500">
                      <span>{formatInstant(p.at, client.timezone)}</span>
                      <span>
                        {p.status === "succeeded"
                          ? p.refundedCents > 0
                            ? `${money(p.refundedCents)} refunded`
                            : "Paid"
                          : p.status === "failed"
                            ? "Declined"
                            : p.status === "requires_action"
                              ? "Needs your approval"
                              : p.status === "canceled"
                                ? "Cancelled"
                                : "Processing"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
