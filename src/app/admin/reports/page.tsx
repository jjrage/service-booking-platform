import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireStaff } from "@/server/auth/viewer";
import { loadReport } from "@/server/reports";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Skeleton } from "@/ui/feedback";
import { formatDate, formatMoney } from "@/ui/format";

export const metadata: Metadata = { title: "Reports" };

const percent = (share: number) => `${Math.round(share * 100)}%`;

export default function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

function Bars({
  rows,
  money,
  total,
}: {
  rows: { label: string; cents: number; visits: number }[];
  money: (c: number) => string;
  total: number;
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-700">{row.label}</span>
            <span className="tabular text-zinc-900">
              {money(row.cents)} <span className="text-zinc-400">· {row.visits}</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-zinc-100">
            <div
              className="h-2 rounded-full bg-brand-600"
              style={{ width: `${total ? (row.cents / total) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

async function Reports({ searchParams }: Pick<PageProps<"/admin/reports">, "searchParams">) {
  const { staff } = await requireStaff("/admin/reports");
  const { weeks: w } = await searchParams;
  const weeks = w === "4" ? 4 : 8;
  const { report, crews, from, to, currency } = await loadReport(staff, weeks);
  const money = (cents: number) => formatMoney(cents, currency);
  const crewName = (id: string) => crews.find((c) => c.id === id)?.name ?? "Former crew";
  const crewColor = (id: string) => crews.find((c) => c.id === id)?.color ?? "#71717a";
  const visitRevenue = report.byService.reduce((s, r) => s + r.cents, 0);
  const maxWeek = Math.max(1, ...report.weekly.map((x) => x.cents));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Reports</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {formatDate(from, "long")} – {formatDate(to, "long")}
          </p>
        </div>
        <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-zinc-200">
          {[4, 8].map((n) => (
            <Link
              key={n}
              href={`/admin/reports?weeks=${n}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                n === weeks ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100",
              )}
            >
              {n} weeks
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [
            "Revenue earned",
            money(report.earnedCents),
            `${report.visitsCompleted} visits · avg ${money(report.averageTicketCents)}`,
          ],
          [
            "Paid up front",
            percent(report.prepaid.share),
            `${money(report.prepaid.depositCents)} deposits on one-time visits`,
          ],
          [
            "Cancelled or locked out",
            percent(report.cancellations.rate),
            `${report.cancellations.cancelled} cancelled · ${report.cancellations.lockouts} lockouts · ${money(report.cancellations.feesCents)} fees kept`,
          ],
          ["Booked through the AI assistant", percent(report.aiShare), "of new non-plan bookings"],
        ].map(([label, value, note]) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
            <p className="mt-1 text-xs text-zinc-500">{note}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Revenue by week" description="Completed visits" />
        <CardBody>
          <div className="flex h-48 items-end gap-2">
            {report.weekly.map((x) => (
              <div key={x.week} className="flex flex-1 flex-col items-center gap-1">
                <span className="tabular text-[11px] text-zinc-500">{money(x.cents)}</span>
                <div
                  className="w-full rounded-t-md bg-brand-600"
                  style={{ height: `${(x.cents / maxWeek) * 140}px` }}
                />
                <span className="text-[11px] text-zinc-500">
                  {formatDate(x.week).replace(/^\w+, /, "")}
                </span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="By service" />
          <CardBody>
            <Bars
              rows={report.byService.map((r) => ({
                label: r.key,
                cents: r.cents,
                visits: r.visits,
              }))}
              money={money}
              total={visitRevenue}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By zone" />
          <CardBody>
            <Bars
              rows={report.byZone.map((r) => ({ label: r.key, cents: r.cents, visits: r.visits }))}
              money={money}
              total={visitRevenue}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By crew" />
          <CardBody>
            <Bars
              rows={report.byCrew.map((r) => ({
                label: crewName(r.key),
                cents: r.cents,
                visits: r.visits,
              }))}
              money={money}
              total={visitRevenue}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Crew utilization" description="Booked visit time over opening hours" />
          <CardBody className="space-y-3">
            {report.utilization.map((u) => (
              <div key={u.crewId} className="text-sm">
                <div className="flex justify-between">
                  <span className="flex items-center gap-2 text-zinc-700">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: crewColor(u.crewId) }}
                    />
                    {crewName(u.crewId)}
                  </span>
                  <span className="tabular font-medium text-zinc-900">{percent(u.share)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.min(100, u.share * 100)}%`,
                      background: crewColor(u.crewId),
                    }}
                  />
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {Math.round(u.bookedMinutes / 60)} of {Math.round(u.availableMinutes / 60)} hours
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Clients" />
          <CardBody className="space-y-2 text-sm">
            <p className="flex justify-between">
              <span className="text-zinc-600">Active regular plans</span>
              <span className="tabular font-medium">{report.retention.activePlans}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-zinc-600">Clients served</span>
              <span className="tabular font-medium">{report.retention.clientsServed}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-zinc-600">Came back in the period</span>
              <span className="tabular font-medium">
                {report.retention.repeatClients} ({percent(report.retention.repeatShare)})
              </span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where bookings come from" description="New bookings in the period" />
          <CardBody className="space-y-2 text-sm">
            {report.sources.map((s) => (
              <p key={s.source} className="flex justify-between">
                <span className="text-zinc-600">
                  {
                    {
                      web: "Booking page",
                      portal: "Client portal",
                      admin: "Office",
                      ai: "AI assistant",
                      plan: "Regular plans",
                    }[s.source]
                  }
                </span>
                <span className="tabular font-medium">
                  {s.bookings} <span className="text-zinc-400">({percent(s.share)})</span>
                </span>
              </p>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
