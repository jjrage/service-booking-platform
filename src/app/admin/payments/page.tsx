import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { paymentList } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { paymentPurpose } from "@/ui/booking-status";
import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant, formatMoney } from "@/ui/format";

import { RefundButton } from "../bookings/[id]/booking-actions";

export const metadata: Metadata = { title: "Payments" };

const filters = [
  { label: "All", status: undefined, purpose: undefined },
  { label: "Failed", status: "failed", purpose: undefined },
  { label: "Deposits", status: undefined, purpose: "deposit" },
  { label: "After visit", status: undefined, purpose: "balance" },
  { label: "Fees", status: undefined, purpose: "cancellation_fee" },
] as const;

export default function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Payments</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Payments searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Payments({ searchParams }: Pick<PageProps<"/admin/payments">, "searchParams">) {
  const { staff } = await requireStaff("/admin/payments");
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : undefined;
  const purpose = typeof params.purpose === "string" ? params.purpose : undefined;
  const payments = await paymentList(staff, { status, purpose });
  const succeeded = payments.filter((p) => p.status === "succeeded");
  const refunded = succeeded.reduce(
    (sum, p) =>
      sum + p.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount_cents, 0),
    0,
  );
  const collected = succeeded.reduce((sum, p) => sum + p.amount_cents, 0) - refunded;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-white p-0.5 ring-1 ring-zinc-200">
          {filters.map((f) => {
            const active = f.status === status && f.purpose === purpose;
            const query = new URLSearchParams();
            if (f.status) query.set("status", f.status);
            if (f.purpose) query.set("purpose", f.purpose);
            return (
              <Link
                key={f.label}
                href={`/admin/payments${query.size ? `?${query}` : ""}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100",
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
        <p className="text-sm text-zinc-600">
          Net collected{" "}
          <span className="tabular font-semibold text-zinc-900">{formatMoney(collected)}</span> ·
          refunded{" "}
          <span className="tabular font-semibold text-zinc-900">{formatMoney(refunded)}</span>
        </p>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">When</th>
              <th className="px-3 py-3 font-medium">Client</th>
              <th className="px-3 py-3 font-medium">What</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 text-right font-medium">Amount</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {payments.map((p) => {
              const refundedCents = p.refunds
                .filter((r) => r.status !== "failed")
                .reduce((s, r) => s + r.amount_cents, 0);
              return (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 text-zinc-600">
                    {formatInstant(p.succeeded_at ?? p.created_at, staff.timezone)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/admin/clients/${p.client.id}`}
                      className="text-zinc-900 hover:underline"
                    >
                      {p.client.full_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">
                    {paymentPurpose(p.purpose)} ·{" "}
                    <Link
                      href={`/admin/bookings/${p.booking.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      #{p.booking.number}
                    </Link>
                    {p.off_session && <span className="text-zinc-400"> · saved card</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      tone={
                        p.status === "succeeded"
                          ? "success"
                          : p.status === "failed"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {p.status}
                    </Badge>
                    {refundedCents > 0 && (
                      <Badge tone="info" className="ml-1">
                        {formatMoney(refundedCents)} refunded
                      </Badge>
                    )}
                    {p.failure_code && (
                      <span className="ml-1 text-xs text-red-600">{p.failure_code}</span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-medium text-zinc-900">
                    {formatMoney(p.amount_cents)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {p.status === "succeeded" && p.amount_cents - refundedCents > 0 && (
                      <RefundButton
                        paymentId={p.id}
                        maxCents={p.amount_cents - refundedCents}
                        currency="USD"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
