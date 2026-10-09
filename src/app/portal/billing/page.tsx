import type { Metadata } from "next";
import { Suspense } from "react";

import { requireClient } from "@/server/auth/viewer";
import { myBilling } from "@/server/portal";
import { paymentPurpose } from "@/ui/booking-status";
import { Card, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { cardLabel, formatInstant, formatMoney } from "@/ui/format";

export const metadata: Metadata = { title: "Payments" };

export default function BillingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <Billing />
    </Suspense>
  );
}

async function Billing() {
  const { client } = await requireClient("/portal/billing");
  const { card, payments } = await myBilling(client);
  const total = payments
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + p.amountCents - p.refundedCents, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Payments</h1>
      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <Card className="self-start p-5">
          <p className="text-sm text-zinc-500">Saved card</p>
          {card ? (
            <>
              <div className="mt-3 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-950 p-4 text-white shadow">
                <p className="text-xs uppercase tracking-wide text-zinc-400">{card.brand}</p>
                <p className="tabular mt-6 font-mono text-lg tracking-widest">•••• {card.last4}</p>
                <p className="mt-2 text-xs text-zinc-400">
                  Expires {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}
                </p>
              </div>
              <p className="mt-3 text-sm text-zinc-600">
                {cardLabel(card)} pays for visits after they are done and for any late-change fee.
              </p>
              {card.provider === "simulated" && (
                <p className="mt-2 text-xs text-zinc-400">Test payments (simulated).</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">
              No card saved yet. You add one when you book.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Receipts" description={`${formatMoney(total)} paid in total`} />
          {payments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">
                      {paymentPurpose(p.purpose)} · #{p.bookingNumber}
                    </p>
                    <p className="text-xs text-zinc-500">{formatInstant(p.at, client.timezone)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {p.refundedCents > 0 && (
                      <Badge tone="info">{formatMoney(p.refundedCents)} refunded</Badge>
                    )}
                    {p.status === "failed" && <Badge tone="danger">Declined</Badge>}
                    <span className="tabular font-medium text-zinc-900">
                      {formatMoney(p.amountCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
