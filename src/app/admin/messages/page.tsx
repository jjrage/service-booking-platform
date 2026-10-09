import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { outboxList } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Skeleton } from "@/ui/feedback";

import { MessageList } from "./message-list";

export const metadata: Metadata = { title: "Messages" };

const filters = [
  { key: undefined, label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
  { key: "cancelled", label: "Cancelled" },
  { key: "failed", label: "Failed" },
] as const;

export default function MessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Messages</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every e-mail and text the system queues, in the same transaction as the change that caused
          it. Demo clients have fictional addresses, so their messages are kept here instead of
          being sent.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Messages searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Messages({ searchParams }: Pick<PageProps<"/admin/messages">, "searchParams">) {
  const { staff } = await requireStaff("/admin/messages");
  const { status } = await searchParams;
  const current = typeof status === "string" ? status : undefined;
  const rows = await outboxList(staff, { status: current });

  return (
    <>
      <div className="flex flex-wrap gap-1 rounded-lg bg-white p-0.5 ring-1 ring-zinc-200 sm:inline-flex">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={f.key ? `/admin/messages?status=${f.key}` : "/admin/messages"}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              f.key === current ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <Card>
        <MessageList
          timezone={staff.timezone}
          rows={rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            channel: row.channel,
            to: row.to_address,
            status: row.status,
            at: row.sent_at ?? row.send_after,
            provider: row.provider,
            subject: row.subject,
            html: row.body_html,
            text: row.body_text,
            attempts: row.attempts,
            error: row.last_error,
            bookingId: row.booking?.id ?? null,
            bookingNumber: row.booking?.number ?? null,
          }))}
        />
      </Card>
    </>
  );
}
