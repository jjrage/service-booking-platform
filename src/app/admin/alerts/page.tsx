import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { openAlerts } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

import { ResolveButton } from "./resolve";

export const metadata: Metadata = { title: "Needs attention" };

const kindLabel: Record<string, string> = {
  payment_failed: "Payment",
  plan_conflict: "Regular visit",
  handoff: "AI hand-off",
};

export default function AlertsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Needs attention</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Declined charges, regular visits no crew could take, and conversations the AI assistant
          handed over.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Alerts />
      </Suspense>
    </div>
  );
}

async function Alerts() {
  const { staff } = await requireStaff("/admin/alerts");
  const alerts = await openAlerts(staff);
  if (alerts.length === 0) {
    return <Card className="p-8 text-center text-zinc-500">Nothing waiting. Nice.</Card>;
  }
  return (
    <Card>
      <ul className="divide-y divide-zinc-100">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm">
                <Badge tone={alert.kind === "payment_failed" ? "danger" : "warning"}>
                  {kindLabel[alert.kind] ?? alert.kind}
                </Badge>
                <span className="text-xs text-zinc-500">
                  {formatInstant(alert.created_at, staff.timezone)}
                </span>
              </p>
              <p className="mt-1.5 text-zinc-800">{alert.message}</p>
              {alert.booking_id && (
                <Link
                  href={`/admin/bookings/${alert.booking_id}`}
                  className="mt-1 inline-block text-sm text-brand-700 hover:underline"
                >
                  Open booking #{alert.booking?.number}
                </Link>
              )}
            </div>
            <ResolveButton alertId={alert.id} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
