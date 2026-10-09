import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { assistantConversation } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { Card, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

export const metadata: Metadata = { title: "Conversation" };

type Block = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

export default function ConversationPage({ params }: PageProps<"/admin/assistant/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Conversation params={params} />
    </Suspense>
  );
}

/** Tool inputs and results are JSON; show them indented. */
function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        v && typeof v === "object" && "text" in v
          ? pretty((v as { text: string }).text)
          : pretty(v),
      )
      .join("\n");
  }
  return JSON.stringify(value, null, 2);
}

async function Conversation({ params }: Pick<PageProps<"/admin/assistant/[id]">, "params">) {
  const { id } = await params;
  const { staff } = await requireStaff(`/admin/assistant/${id}`);
  const data = /^[0-9a-f-]{36}$/.test(id) ? await assistantConversation(staff, id) : null;
  if (!data) notFound();
  const { conversation, messages, calls } = data;
  const callByUse = new Map(calls.map((c) => [c.tool_use_id, c]));

  return (
    <div className="space-y-6">
      <Link href="/admin/assistant" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← AI assistant
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {conversation.client?.full_name ?? "Website visitor"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {formatInstant(conversation.started_at, staff.timezone)} · {conversation.model} ·{" "}
            {conversation.user_turns} messages · {calls.length} tool calls
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>{conversation.channel}</Badge>
          {conversation.booking && (
            <Link href={`/admin/bookings/${conversation.booking.id}`}>
              <Badge tone="brand">Booking #{conversation.booking.number}</Badge>
            </Link>
          )}
          {conversation.handed_off && <Badge tone="warning">Handed off</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader title="Transcript" description="Exactly what the model saw and did, in order" />
        <ol className="space-y-3 px-5 py-4 text-sm">
          {messages.flatMap((m) =>
            (m.content as Block[]).map((block, i) => {
              const key = `${m.seq}-${i}`;
              if (block.type === "text") {
                return (
                  <li key={key} className={m.role === "user" ? "" : "ml-6"}>
                    <p className="text-xs font-medium text-zinc-500">
                      {m.role === "user" ? "Client" : "Assistant"}
                    </p>
                    <p className="whitespace-pre-wrap text-zinc-800">{block.text}</p>
                  </li>
                );
              }
              if (block.type === "tool_use") {
                const call = block.id ? callByUse.get(block.id) : undefined;
                return (
                  <li key={key} className="ml-6 rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200">
                    <p className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                      Tool call: <code className="text-zinc-900">{block.name}</code>
                      {call && (
                        <Badge tone={call.ok ? "success" : "danger"}>
                          {call.ok ? "ok" : "failed"} · {call.duration_ms} ms
                        </Badge>
                      )}
                    </p>
                    <pre className="mt-2 max-h-48 overflow-auto text-xs text-zinc-700">
                      {pretty(block.input)}
                    </pre>
                  </li>
                );
              }
              if (block.type === "tool_result") {
                return (
                  <li key={key} className="ml-6 rounded-lg bg-white p-3 ring-1 ring-zinc-200">
                    <p className="text-xs font-medium text-zinc-600">
                      Result{block.is_error ? <span className="text-red-600"> (error)</span> : null}
                    </p>
                    <pre className="mt-2 max-h-48 overflow-auto text-xs text-zinc-700">
                      {pretty(block.content)}
                    </pre>
                  </li>
                );
              }
              if (block.type === "thinking" || block.type === "redacted_thinking") {
                return (
                  <li key={key} className="ml-6 text-xs italic text-zinc-400">
                    (model reasoning, not shown)
                  </li>
                );
              }
              return null;
            }),
          )}
        </ol>
      </Card>
    </div>
  );
}
