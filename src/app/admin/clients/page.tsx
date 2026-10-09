import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { clientList } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { Input } from "@/ui/form";
import { formatInstant, formatMoney } from "@/ui/format";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Clients</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Clients searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Clients({ searchParams }: Pick<PageProps<"/admin/clients">, "searchParams">) {
  const { staff } = await requireStaff("/admin/clients");
  const { q } = await searchParams;
  const search = typeof q === "string" ? q : "";
  const clients = await clientList(staff, search);

  return (
    <>
      <form className="flex max-w-md gap-2">
        <Input name="q" defaultValue={search} placeholder="Search by name, e-mail or phone" />
      </form>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-3 py-3 font-medium">City</th>
              <th className="px-3 py-3 text-right font-medium">Visits</th>
              <th className="px-3 py-3 text-right font-medium">Lifetime</th>
              <th className="px-5 py-3 font-medium">Next visit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {clients.map((client) => (
              <tr key={client.id} className="hover:bg-zinc-50">
                <td className="px-5 py-3">
                  <Link
                    href={`/admin/clients/${client.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {client.fullName}
                  </Link>
                  {client.onPlan && (
                    <Badge tone="brand" className="ml-2">
                      Regular
                    </Badge>
                  )}
                  <span className="block text-xs text-zinc-500">{client.email}</span>
                </td>
                <td className="px-3 py-3 text-zinc-600">{client.city}</td>
                <td className="tabular px-3 py-3 text-right text-zinc-700">{client.visits}</td>
                <td className="tabular px-3 py-3 text-right text-zinc-700">
                  {formatMoney(client.lifetimeCents)}
                </td>
                <td className="px-5 py-3 text-zinc-600">
                  {client.nextVisit
                    ? formatInstant(client.nextVisit, staff.timezone, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-zinc-500">
                  No clients match “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
