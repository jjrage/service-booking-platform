"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import type { QuoteInput } from "@/domain/quote";
import type { DayChoice, WindowChoice } from "@/server/booking/availability";
import type { Hold } from "@/server/booking/hold";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Alert, Skeleton, Spinner } from "@/ui/feedback";
import { formatDate, formatDuration, formatWindow, shiftDate } from "@/ui/format";

import { holdWindowAction, loadWindowsAction } from "./actions";
import type { WizardContext } from "./booking-wizard";

const statusLabel: Record<WindowChoice["status"], string> = {
  available: "",
  full: "Booked",
  too_long: "Too late to finish",
};

export function WindowStep({
  context,
  request,
  onBack,
  onHeld,
}: {
  context: WizardContext;
  request: QuoteInput;
  onBack: () => void;
  onHeld: (hold: Hold) => void;
}) {
  const [from, setFrom] = useState<string | undefined>();
  const [data, setData] = useState<{
    days: DayChoice[];
    first: string;
    last: string;
    durationMinutes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState<{
    message: string;
    alternatives: WindowChoice[];
  } | null>(null);
  const [loading, startLoading] = useTransition();
  const [holding, setHolding] = useState<string | null>(null);

  const load = useCallback(
    (start?: string) => {
      startLoading(async () => {
        const result = await loadWindowsAction({
          slug: context.slug,
          quote: request,
          from: start,
        });
        if (result.ok) {
          setData(result);
          setError(null);
        } else {
          setError(result.message);
        }
      });
    },
    [context.slug, request],
  );

  useEffect(() => load(from), [load, from]);

  async function pick(window: WindowChoice) {
    const key = `${window.date} ${window.localStart}`;
    setHolding(key);
    setLost(null);
    try {
      const result = await holdWindowAction({
        slug: context.slug,
        quote: request,
        date: window.date,
        localStart: window.localStart,
      });
      if (result.ok) {
        onHeld(result.hold);
      } else {
        setLost({ message: result.message, alternatives: result.alternatives });
        load(from);
      }
    } finally {
      setHolding(null);
    }
  }

  const visibleFrom = data?.days[0]?.date;
  const visibleTo = data?.days.at(-1)?.date;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Pick an arrival window
        </h1>
        <p className="mt-1 text-zinc-600">
          The crew arrives within the window.
          {data && <> Your visit takes about {formatDuration(data.durationMinutes)}.</>} We hold
          your window for {context.holdMinutes} minutes while you finish booking.
        </p>
      </div>

      {lost && (
        <Alert tone="warning" title={lost.message}>
          {lost.alternatives.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="self-center">Next free windows:</span>
              {lost.alternatives.map((w) => (
                <Button
                  key={`${w.date} ${w.localStart}`}
                  variant="secondary"
                  size="sm"
                  onClick={() => pick(w)}
                >
                  {formatDate(w.date)}, {formatWindow(w.localStart, w.localEnd)}
                </Button>
              ))}
            </div>
          ) : (
            "No other windows are free in the next two weeks."
          )}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || !data || !visibleFrom || visibleFrom <= data.first}
            onClick={() => setFrom(visibleFrom ? shiftDate(visibleFrom, -14) : undefined)}
          >
            ← Earlier
          </Button>
          <span className="text-sm font-medium text-zinc-700">
            {visibleFrom && visibleTo
              ? `${formatDate(visibleFrom)} – ${formatDate(visibleTo)}`
              : "Loading…"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || !data || !visibleTo || visibleTo >= data.last}
            onClick={() => setFrom(visibleTo ? shiftDate(visibleTo, 1) : undefined)}
          >
            Later →
          </Button>
        </div>

        {!data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <ul className={cn("divide-y divide-zinc-100", loading && "opacity-50")}>
            {data.days.map((day) => (
              <li
                key={day.date}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center"
              >
                <span className="w-40 shrink-0 text-sm font-medium text-zinc-800">
                  {formatDate(day.date)}
                </span>
                {day.status !== "open" ? (
                  <span className="text-sm text-zinc-400">
                    {day.status === "holiday" ? "Holiday — closed" : "Closed"}
                  </span>
                ) : (
                  <div className="grid flex-1 grid-cols-3 gap-2">
                    {day.windows.map((w) => {
                      const key = `${w.date} ${w.localStart}`;
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={w.status !== "available" || holding !== null}
                          onClick={() => pick(w)}
                          className={cn(
                            "flex h-10 items-center justify-center gap-2 rounded-lg px-2 text-sm ring-1 transition",
                            w.status === "available"
                              ? "bg-white font-medium text-zinc-900 ring-zinc-300 hover:bg-brand-50 hover:ring-brand-600"
                              : "cursor-not-allowed bg-zinc-50 text-zinc-400 ring-zinc-100",
                          )}
                          title={statusLabel[w.status]}
                        >
                          {holding === key && <Spinner />}
                          <span className="tabular">
                            {w.status === "available"
                              ? formatWindow(w.localStart, w.localEnd)
                              : statusLabel[w.status]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Button variant="ghost" onClick={onBack}>
        ← Back to your home
      </Button>
    </div>
  );
}
