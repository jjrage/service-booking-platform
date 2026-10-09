"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type { ChatCard } from "@/server/ai/handlers";

import { cn } from "../cn";
import {
  formatDate,
  formatDuration,
  formatMoney,
  formatWindow,
  formatWindowShort,
} from "../format";

type Turn = {
  role: "user" | "assistant";
  text: string;
  cards: ChatCard[];
  activity: { name: string; done: boolean; ok: boolean }[];
  notice?: string;
  error?: string;
};

const activityLabel: Record<string, string> = {
  get_business_info: "Looking up the business",
  list_services: "Reading the services",
  get_quote: "Pricing the visit",
  check_availability: "Checking free windows",
  hold_slot: "Holding the window",
  create_booking: "Creating the booking",
  list_my_visits: "Looking up your visits",
  reschedule_booking: "Rescheduling",
  cancel_booking: "Cancelling",
  handoff_to_human: "Passing to the office",
};

/** Renders the assistant's plain text: paragraphs, "- " lists and **bold**. */
function RichText({ text }: { text: string }) {
  const bold = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      );
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-0.5 pl-5">
          {list.map((item, i) => (
            <li key={i}>{bold(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of text.split("\n")) {
    if (/^\s*[-•*]\s+/.test(line)) list.push(line.replace(/^\s*[-•*]\s+/, ""));
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{bold(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function Card({ card, send }: { card: ChatCard; send: (text: string) => void }) {
  const base = "rounded-xl px-3 py-2.5 text-sm ring-1";
  switch (card.kind) {
    case "quote":
      return (
        <div className={cn(base, "bg-white ring-zinc-200")}>
          <p className="font-semibold text-zinc-900">
            {card.service} · {formatMoney(card.totalCents)}
          </p>
          <p className="text-zinc-500">
            About {formatDuration(card.durationMinutes)}
            {card.depositCents > 0 && ` · ${formatMoney(card.depositCents)} deposit`}
            {card.regularCents !== null && ` · then ${formatMoney(card.regularCents)} per visit`}
          </p>
        </div>
      );
    case "windows":
      return (
        <div className={cn(base, "space-y-2 bg-white ring-zinc-200")}>
          {card.days.map((day) => (
            <div key={day.date}>
              <p className="text-xs font-medium text-zinc-500">{formatDate(day.date)}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {day.windows.map((w) => (
                  <button
                    key={w.start}
                    type="button"
                    onClick={() =>
                      send(
                        `${formatDate(day.date, "long")}, ${formatWindow(w.start, w.end)} works for me.`,
                      )
                    }
                    className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100"
                  >
                    {formatWindowShort(w.start, w.end)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    case "hold":
      return (
        <div className={cn(base, "bg-sky-50 text-sky-900 ring-sky-200")}>
          Held for you: {formatDate(card.date, "long")}, {formatWindow(card.start, card.end)}
        </div>
      );
    case "booking":
      return card.status === "confirmed" ? (
        <div className={cn(base, "bg-emerald-50 text-emerald-900 ring-emerald-200")}>
          <p className="font-semibold">Booking #{card.number} confirmed</p>
          <p>
            {formatDate(card.date, "long")}, {formatWindow(card.start, card.end)} ·{" "}
            {formatMoney(card.totalCents)}
          </p>
          <a href={card.bookingUrl} className="mt-1 inline-block font-medium underline">
            View booking
          </a>
        </div>
      ) : (
        <div className={cn(base, "bg-amber-50 text-amber-900 ring-amber-200")}>
          <p className="font-semibold">Booking #{card.number} reserved, not yet confirmed</p>
          <p>
            {formatDate(card.date, "long")}, {formatWindow(card.start, card.end)} ·{" "}
            {formatMoney(card.totalCents)}
          </p>
          {card.payUrl && (
            <a
              href={card.payUrl}
              className="mt-2 inline-flex rounded-lg bg-brand-700 px-3 py-1.5 font-medium text-white hover:bg-brand-800"
            >
              Pay {formatMoney(card.depositCents)} deposit to confirm
            </a>
          )}
        </div>
      );
    case "change":
      return (
        <div className={cn(base, "bg-white ring-zinc-200")}>
          <p className="font-semibold text-zinc-900">
            Visit #{card.number} {card.action === "cancelled" ? "cancelled" : "moved"}
          </p>
          {card.action === "rescheduled" && card.date && card.start && card.end && (
            <p className="text-zinc-600">
              Now {formatDate(card.date, "long")}, {formatWindow(card.start, card.end)}
            </p>
          )}
          <p className="text-zinc-500">
            {card.feeCents > 0 ? `Fee ${formatMoney(card.feeCents)}` : "No fee"}
          </p>
        </div>
      );
    case "handoff":
      return (
        <div className={cn(base, "bg-zinc-50 text-zinc-700 ring-zinc-200")}>
          Passed to the office. A person will follow up.
        </div>
      );
  }
}

export function ChatWidget({
  slug,
  enabled,
  businessName,
  signedIn,
}: {
  slug: string;
  enabled: boolean;
  businessName: string;
  signedIn: boolean;
}) {
  const storageKey = `chat:${slug}:${signedIn ? "portal" : "web"}`;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as {
        id: string;
        turns: Turn[];
      } | null;
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from sessionStorage after mount
        setConversationId(saved.id);
        setTurns(saved.turns);
      }
    } catch {
      // Storage unavailable (private mode): start fresh.
    }
  }, [storageKey]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    try {
      if (conversationId)
        sessionStorage.setItem(storageKey, JSON.stringify({ id: conversationId, turns }));
    } catch {
      // ignore
    }
  }, [turns, conversationId, storageKey]);

  const update = (fn: (turn: Turn) => Turn) =>
    setTurns((all) => [...all.slice(0, -1), fn(all.at(-1)!)]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setInput("");
    setPending(true);
    setTurns((all) => [
      ...all,
      { role: "user", text: message, cards: [], activity: [] },
      { role: "assistant", text: "", cards: [], activity: [] },
    ]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, conversationId, message }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        update((t) => ({ ...t, error: body.error ?? "The assistant is not available right now." }));
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "conversation"; id: string }
            | { type: "text"; delta: string }
            | { type: "tool_start"; name: string }
            | { type: "tool_end"; name: string; ok: boolean; card?: ChatCard }
            | { type: "notice" | "error"; message: string }
            | { type: "done" };
          if (event.type === "conversation") setConversationId(event.id);
          else if (event.type === "text") update((t) => ({ ...t, text: t.text + event.delta }));
          else if (event.type === "tool_start")
            update((t) => ({
              ...t,
              activity: [...t.activity, { name: event.name, done: false, ok: true }],
            }));
          else if (event.type === "tool_end")
            update((t) => ({
              ...t,
              activity: t.activity.map((a) =>
                a.name === event.name && !a.done ? { ...a, done: true, ok: event.ok } : a,
              ),
              cards: event.card ? [...t.cards, event.card] : t.cards,
            }));
          else if (event.type === "notice") update((t) => ({ ...t, notice: event.message }));
          else if (event.type === "error") update((t) => ({ ...t, error: event.message }));
        }
      }
    } catch {
      update((t) => ({ ...t, error: "Connection lost. Please try again." }));
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setTurns([]);
    setConversationId(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[min(620px,calc(100vh-6rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200">
          <div className="flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">{businessName} assistant</p>
              <p className="text-xs text-brand-100">
                AI · prices and times come from the booking system
              </p>
            </div>
            <div className="flex items-center gap-2">
              {turns.length > 0 && (
                <button type="button" onClick={reset} className="text-xs text-brand-100 underline">
                  New chat
                </button>
              )}
              <button
                type="button"
                aria-label="Close chat"
                onClick={() => setOpen(false)}
                className="text-xl leading-none"
              >
                ×
              </button>
            </div>
          </div>

          <div
            ref={scroller}
            className="flex-1 space-y-3 overflow-y-auto bg-zinc-50 px-3 py-4 text-sm"
          >
            {!enabled ? (
              <div className="rounded-xl bg-white p-4 text-zinc-700 ring-1 ring-zinc-200">
                <p className="font-medium text-zinc-900">The assistant is offline in this demo.</p>
                <p className="mt-1">
                  It needs an Anthropic API key, which is not configured here. Everything it does is
                  also available on the{" "}
                  <a href={`/${slug}/book`} className="text-brand-700 underline">
                    booking page
                  </a>
                  .
                </p>
              </div>
            ) : turns.length === 0 ? (
              <div className="space-y-2">
                <p className="rounded-xl bg-white p-3 text-zinc-700 ring-1 ring-zinc-200">
                  Hi! I can price a cleaning, find a free arrival window and book it
                  {signedIn ? ", or move and cancel your visits" : ""}.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(signedIn
                    ? [
                        "When is my next visit?",
                        "Move my next visit to later in the week",
                        "Price a deep clean",
                      ]
                    : [
                        "How much for a 3 bed, 2 bath house?",
                        "Do you clean in Cary?",
                        "Book a cleaning next week",
                      ]
                  ).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="rounded-full bg-white px-3 py-1 text-xs text-zinc-700 ring-1 ring-zinc-200 hover:ring-brand-600"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn, i) =>
                turn.role === "user" ? (
                  <div
                    key={i}
                    className="ml-8 rounded-xl rounded-br-sm bg-brand-700 px-3 py-2 text-white"
                  >
                    {turn.text}
                  </div>
                ) : (
                  <div key={i} className="mr-6 space-y-2">
                    {turn.activity.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {turn.activity.map((a, j) => (
                          <span
                            key={j}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              !a.done
                                ? "animate-pulse bg-zinc-200 text-zinc-600"
                                : a.ok
                                  ? "bg-zinc-100 text-zinc-500"
                                  : "bg-red-50 text-red-700",
                            )}
                          >
                            {activityLabel[a.name] ?? a.name}
                            {a.done && (a.ok ? " ✓" : " ✕")}
                          </span>
                        ))}
                      </div>
                    )}
                    {turn.text && (
                      <div className="rounded-xl rounded-bl-sm bg-white px-3 py-2 text-zinc-800 ring-1 ring-zinc-200">
                        <RichText text={turn.text} />
                      </div>
                    )}
                    {turn.cards.map((card, j) => (
                      <Card key={j} card={card} send={send} />
                    ))}
                    {turn.notice && <p className="text-xs text-amber-700">{turn.notice}</p>}
                    {turn.error && <p className="text-xs text-red-600">{turn.error}</p>}
                    {pending &&
                      i === turns.length - 1 &&
                      !turn.text &&
                      turn.activity.length === 0 && (
                        <span className="inline-block animate-pulse text-zinc-400">Thinking…</span>
                      )}
                  </div>
                ),
              )
            )}
          </div>

          {enabled && (
            <form
              className="flex gap-2 border-t border-zinc-200 bg-white p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={1000}
                placeholder="Ask about prices or book a time"
                aria-label="Message"
                className="flex-1 rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-brand-600"
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                className="rounded-lg bg-brand-700 px-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-800"
      >
        {open ? "Close" : "Chat with us"}
      </button>
    </div>
  );
}
