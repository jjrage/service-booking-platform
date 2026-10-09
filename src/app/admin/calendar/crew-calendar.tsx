"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { BoardCrew } from "@/server/admin";
import { cn } from "@/ui/cn";
import { Alert, Spinner } from "@/ui/feedback";
import { formatDate, formatMoney } from "@/ui/format";

import { reassignAction } from "../actions";

export type CalendarBlock = {
  kind: "booking" | "time_off";
  id: string;
  crewId: string;
  date: string;
  /** Minutes since local midnight: arrival window start and end, latest finish, end of travel buffer. */
  start: number;
  windowEnd: number;
  jobEnd: number;
  busyEnd: number;
  title: string;
  subtitle: string;
  status: string;
  number: number;
  totalCents: number;
  regular: boolean;
  ai: boolean;
};

const DAY_START = 7 * 60;
const DAY_END = 20 * 60;
const SPAN = DAY_END - DAY_START;

function pct(minute: number) {
  return `${((Math.min(Math.max(minute, DAY_START), DAY_END) - DAY_START) / SPAN) * 100}%`;
}

function clock(minute: number) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

export function CrewCalendar({
  view,
  days,
  today,
  crews,
  blocks,
  nowMinute,
}: {
  view: "day" | "week";
  days: string[];
  today: string;
  crews: BoardCrew[];
  blocks: CalendarBlock[];
  nowMinute: number | null;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<CalendarBlock | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const draggable = (block: CalendarBlock) =>
    block.kind === "booking" && ["confirmed", "pending_payment"].includes(block.status);

  function drop(crewId: string) {
    const block = dragging;
    setDragging(null);
    setOver(null);
    if (!block || block.crewId === crewId) return;
    startTransition(async () => {
      const result = await reassignAction(block.id, crewId);
      setMessage({
        ok: result.ok,
        text: result.ok ? `#${block.number} reassigned.` : result.message,
      });
      router.refresh();
    });
  }

  // A visit moves between crews on its own day; moving it to another day is a reschedule (booking page).
  const dropProps = (crewId: string, key: string, day: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || dragging.date !== day) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((current) => (current === key ? null : current)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      drop(crewId);
    },
  });

  const crewColor = (crewId: string) => crews.find((c) => c.id === crewId)?.color ?? "#71717a";

  return (
    <div className="space-y-3">
      {message && (
        <Alert tone={message.ok ? "success" : "danger"}>
          {pending && <Spinner className="mr-2" />}
          {message.text}
        </Alert>
      )}

      {view === "day" ? (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="min-w-[860px]">
            <div className="flex border-b border-zinc-100">
              <div className="w-36 shrink-0" />
              <div className="relative h-8 flex-1">
                {Array.from(
                  { length: (DAY_END - DAY_START) / 60 + 1 },
                  (_, i) => DAY_START + i * 60,
                ).map((m) => (
                  <span
                    key={m}
                    className="absolute top-2 -translate-x-1/2 text-xs text-zinc-400"
                    style={{ left: pct(m) }}
                  >
                    {clock(m)}
                  </span>
                ))}
              </div>
            </div>
            {crews.map((crew) => {
              const key = `${crew.id}|${days[0]}`;
              return (
                <div key={crew.id} className="flex border-b border-zinc-100 last:border-0">
                  <div className="flex w-36 shrink-0 items-center gap-2 px-4 text-sm font-medium text-zinc-800">
                    <span className="size-2.5 rounded-full" style={{ background: crew.color }} />
                    {crew.name}
                  </div>
                  <div
                    {...dropProps(crew.id, key, days[0]!)}
                    className={cn(
                      "relative h-24 flex-1 transition-colors",
                      over === key && "bg-brand-50",
                    )}
                  >
                    {Array.from(
                      { length: (DAY_END - DAY_START) / 60 + 1 },
                      (_, i) => DAY_START + i * 60,
                    ).map((m) => (
                      <span
                        key={m}
                        className="absolute inset-y-0 w-px bg-zinc-100"
                        style={{ left: pct(m) }}
                      />
                    ))}
                    {nowMinute !== null && days[0] === today && (
                      <span
                        className="absolute inset-y-0 z-10 w-0.5 bg-red-500"
                        style={{ left: pct(nowMinute) }}
                      />
                    )}
                    {blocks
                      .filter((b) => b.crewId === crew.id && b.date === days[0])
                      .map((block) => (
                        <DayBlock
                          key={block.id}
                          block={block}
                          color={crewColor(block.crewId)}
                          draggable={draggable(block)}
                          onDragStart={() => setDragging(block)}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-200">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className="w-32 px-3 py-2" />
                {days.map((day) => (
                  <th
                    key={day}
                    className={cn(
                      "px-2 py-2 text-left font-medium",
                      day === today ? "text-brand-700" : "text-zinc-600",
                    )}
                  >
                    <Link href={`/admin/calendar?view=day&date=${day}`} className="hover:underline">
                      {formatDate(day)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crews.map((crew) => (
                <tr key={crew.id} className="border-b border-zinc-100 align-top last:border-0">
                  <td className="px-3 py-3 font-medium text-zinc-800">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: crew.color }} />
                      {crew.name}
                    </span>
                  </td>
                  {days.map((day) => {
                    const key = `${crew.id}|${day}`;
                    return (
                      <td
                        key={day}
                        {...dropProps(crew.id, key, day)}
                        className={cn(
                          "space-y-1.5 border-l border-zinc-100 px-1.5 py-2",
                          over === key && "bg-brand-50",
                        )}
                      >
                        {blocks
                          .filter((b) => b.crewId === crew.id && b.date === day)
                          .sort((a, b) => a.start - b.start)
                          .map((block) => (
                            <WeekChip
                              key={block.id}
                              block={block}
                              color={crewColor(block.crewId)}
                              draggable={draggable(block)}
                              onDragStart={() => setDragging(block)}
                              onDragEnd={() => {
                                setDragging(null);
                                setOver(null);
                              }}
                            />
                          ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded bg-zinc-400" /> arrival window and job
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded bg-zinc-200" /> travel buffer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-dashed border-amber-500 bg-amber-50" />{" "}
          awaiting payment
        </span>
      </div>
    </div>
  );
}

function DayBlock({
  block,
  color,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  block: CalendarBlock;
  color: string;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  if (block.kind === "time_off") {
    return (
      <div
        className="absolute inset-y-2 rounded-md border border-zinc-300 bg-[repeating-linear-gradient(45deg,#f4f4f5,#f4f4f5_6px,#e4e4e7_6px,#e4e4e7_12px)] px-2 py-1 text-xs text-zinc-600"
        style={{
          left: pct(block.start),
          width: `calc(${pct(block.busyEnd)} - ${pct(block.start)})`,
        }}
      >
        <span className="font-medium">Time off</span> {block.subtitle}
      </div>
    );
  }
  const muted = block.status === "completed" || block.status === "no_access";
  return (
    <Link
      href={`/admin/bookings/${block.id}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", block.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group absolute inset-y-2 flex overflow-hidden rounded-md text-left text-xs shadow-sm ring-1 ring-black/5",
        draggable && "cursor-grab active:cursor-grabbing",
        block.status === "pending_payment" && "border border-dashed border-amber-500",
      )}
      style={{ left: pct(block.start), width: `calc(${pct(block.busyEnd)} - ${pct(block.start)})` }}
      title={`#${block.number} ${block.title} · ${clock(block.start)}–${clock(block.windowEnd)} arrival`}
    >
      <span
        className={cn("min-w-0 px-2 py-1.5 text-white", muted && "opacity-60")}
        style={{
          background: color,
          width: `${((block.jobEnd - block.start) / Math.max(1, block.busyEnd - block.start)) * 100}%`,
        }}
      >
        <span className="block truncate font-semibold">{block.title}</span>
        <span className="block truncate opacity-90">
          {clock(block.start)}–{clock(block.windowEnd)} · {block.subtitle}
        </span>
        <span className="mt-0.5 flex gap-1">
          {block.regular && <span className="rounded bg-white/25 px-1">Regular</span>}
          {block.ai && <span className="rounded bg-white/25 px-1">AI</span>}
          {block.status === "completed" && <span className="rounded bg-white/25 px-1">Done</span>}
          {block.status === "no_access" && (
            <span className="rounded bg-white/25 px-1">No access</span>
          )}
        </span>
      </span>
      <span className="flex-1" style={{ background: `${color}33` }} />
    </Link>
  );
}

function WeekChip({
  block,
  color,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  block: CalendarBlock;
  color: string;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  if (block.kind === "time_off") {
    return (
      <div className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-500">
        Time off {block.subtitle && `· ${block.subtitle}`}
      </div>
    );
  }
  return (
    <Link
      href={`/admin/bookings/${block.id}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", block.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "block rounded-md border-l-4 bg-zinc-50 px-2 py-1 text-xs hover:bg-zinc-100",
        draggable && "cursor-grab",
        (block.status === "completed" || block.status === "no_access") && "opacity-60",
        block.status === "pending_payment" && "border-dashed",
      )}
      style={{ borderLeftColor: color }}
    >
      <span className="font-medium text-zinc-800">{clock(block.start)}</span>{" "}
      <span className="text-zinc-700">{block.title}</span>
      <span className="block truncate text-zinc-500">
        {block.subtitle.split(" · ")[0]} · {formatMoney(block.totalCents)}
      </span>
    </Link>
  );
}
