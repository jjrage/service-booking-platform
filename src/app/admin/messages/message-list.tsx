"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

export type MessageRow = {
  id: string;
  kind: string;
  channel: "email" | "sms_log";
  to: string;
  status: string;
  at: string;
  provider: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  attempts: number;
  error: string | null;
  bookingId: string | null;
  bookingNumber: number | null;
};

const kindLabel: Record<string, string> = {
  booking_confirmed: "Confirmation",
  booking_rescheduled: "Rescheduled",
  booking_cancelled: "Cancelled",
  reminder_72h: "Reminder, 3 days",
  reminder_24h: "Reminder, 1 day",
  review_request: "Review request",
  no_access: "Lockout",
  payment_failed: "Payment failed",
};

const statusTone = {
  pending: "info",
  sending: "info",
  sent: "success",
  failed: "danger",
  cancelled: "neutral",
} as const;

export function MessageList({ rows, timezone }: { rows: MessageRow[]; timezone: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-zinc-500">No messages.</p>;

  return (
    <ul className="divide-y divide-zinc-100">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => setOpen(open === row.id ? null : row.id)}
            className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-zinc-50"
          >
            <span className="min-w-0">
              <span className="font-medium text-zinc-900">
                {row.channel === "sms_log" ? "Text" : "E-mail"} · {kindLabel[row.kind] ?? row.kind}
              </span>{" "}
              <span className="text-zinc-500">to {row.to}</span>
              {row.subject && <span className="block truncate text-zinc-600">{row.subject}</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{formatInstant(row.at, timezone)}</span>
              {row.provider && row.status === "sent" && <Badge>{row.provider}</Badge>}
              <Badge tone={statusTone[row.status as keyof typeof statusTone] ?? "neutral"}>
                {row.status === "pending" ? "scheduled" : row.status}
              </Badge>
            </span>
          </button>
          {open === row.id && (
            <div className="space-y-3 border-t border-zinc-100 bg-zinc-50 px-5 py-4">
              <p className="text-xs text-zinc-500">
                {row.bookingId && (
                  <Link
                    href={`/admin/bookings/${row.bookingId}`}
                    className="text-brand-700 hover:underline"
                  >
                    Booking #{row.bookingNumber}
                  </Link>
                )}{" "}
                · attempts {row.attempts}
                {row.error && <span className="text-red-600"> · {row.error}</span>}
              </p>
              {row.html ? (
                <iframe
                  title={row.subject ?? "Message"}
                  srcDoc={row.html}
                  sandbox=""
                  className="h-[520px] w-full rounded-lg bg-white ring-1 ring-zinc-200"
                />
              ) : row.text ? (
                <pre className="whitespace-pre-wrap rounded-lg bg-white p-4 text-sm ring-1 ring-zinc-200">
                  {row.text}
                </pre>
              ) : (
                <p className="text-sm text-zinc-500">Rendered when it is sent.</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
