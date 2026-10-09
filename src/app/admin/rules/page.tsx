import type { Metadata } from "next";
import { Suspense } from "react";

import { ruleHistory } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { loadCatalog } from "@/server/catalog";
import { Card, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

import { RulesEditor } from "./rules-editor";

export const metadata: Metadata = { title: "Prices & rules" };

export default function RulesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Prices &amp; rules</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Changes publish a new version. New quotes use it right away; existing bookings keep the
          price they were booked at.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <Rules />
      </Suspense>
    </div>
  );
}

async function Rules() {
  const { staff } = await requireStaff("/admin/rules");
  const [catalog, history] = await Promise.all([loadCatalog(staff.slug), ruleHistory(staff)]);
  if (!catalog) return null;

  return (
    <div className="space-y-6">
      <RulesEditor
        canPublish={staff.role === "owner"}
        services={catalog.services
          .filter((s) => s.bookingMode === "instant")
          .map((s) => ({ code: s.code, name: s.name }))}
        pricing={catalog.pricing}
        schedule={catalog.schedule}
        cancellation={catalog.cancellation}
      />
      <Card>
        <CardHeader
          title="Version history"
          description="Rule versions are never edited or deleted."
        />
        <ul className="divide-y divide-zinc-100 text-sm">
          {history.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5"
            >
              <span>
                <Badge>{v.kind}</Badge>{" "}
                <span className="font-medium text-zinc-900">v{v.version}</span>{" "}
                <span className="text-zinc-500">{v.note}</span>
              </span>
              <span className="text-xs text-zinc-500">
                {formatInstant(v.created_at, staff.timezone)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
