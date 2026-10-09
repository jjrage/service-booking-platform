import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { assistantConversations } from "@/server/admin";
import { aiConfig } from "@/server/ai/config";
import { requireStaff } from "@/server/auth/viewer";
import { BookingStatus } from "@/ui/booking-status";
import { Card } from "@/ui/card";
import { Alert, Badge, Skeleton } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

export const metadata: Metadata = { title: "AI assistant" };

export default function AssistantLogPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">AI assistant</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every conversation and every tool call the assistant made. It books through the same
          server functions as the booking page; this log shows what it actually did.
        </p>
      </div>
      {!aiConfig.enabled && (
        <Alert tone="info">
          The assistant is switched off: no Anthropic API key is configured. Conversations appear
          here once it is on.
        </Alert>
      )}
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Conversations />
      </Suspense>
    </div>
  );
}

async function Conversations() {
  const { staff } = await requireStaff("/admin/assistant");
  const rows = await assistantConversations(staff);
  if (rows.length === 0) {
    return <Card className="p-6 text-sm text-zinc-500">No conversations yet.</Card>;
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-5 py-3 font-medium">Last message</th>
            <th className="px-3 py-3 font-medium">Who</th>
            <th className="px-3 py-3 text-right font-medium">Messages</th>
            <th className="px-3 py-3 text-right font-medium">Tokens in / cached / out</th>
            <th className="px-5 py-3 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-zinc-50">
              <td className="px-5 py-2.5">
                <Link href={`/admin/assistant/${c.id}`} className="text-brand-700 hover:underline">
                  {formatInstant(c.last_activity_at, staff.timezone)}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-zinc-700">
                {c.client?.full_name ?? "Website visitor"} <Badge>{c.channel}</Badge>
              </td>
              <td className="tabular px-3 py-2.5 text-right text-zinc-700">{c.user_turns}</td>
              <td className="tabular px-3 py-2.5 text-right text-zinc-500">
                {c.input_tokens.toLocaleString("en-US")} /{" "}
                {c.cache_read_tokens.toLocaleString("en-US")} /{" "}
                {c.output_tokens.toLocaleString("en-US")}
              </td>
              <td className="px-5 py-2.5">
                {c.booking ? (
                  <span className="flex items-center gap-2">
                    #{c.booking.number} <BookingStatus status={c.booking.status} />
                  </span>
                ) : c.handed_off ? (
                  <Badge tone="warning">Handed off</Badge>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
