"use client";

import { useState, useTransition } from "react";

import type { RaceResult } from "@/server/booking/race";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Alert, Badge, Spinner } from "@/ui/feedback";
import { formatDate, formatWindow } from "@/ui/format";

import { raceAction } from "./actions";

export function RaceDemo({ tenant }: { tenant: string }) {
  const [result, setResult] = useState<RaceResult | null>(null);
  const [empty, setEmpty] = useState(false);
  const [pending, startTransition] = useTransition();

  function race(contenders: 2 | 10 | 20) {
    startTransition(async () => {
      const outcome = await raceAction({ slug: tenant, contenders });
      setResult(outcome);
      setEmpty(outcome === null);
    });
  }

  const winners = result?.contenders.filter((c) => c.outcome === "won").length ?? 0;

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={pending} onClick={() => race(2)}>
          {pending && <Spinner />}
          Race 2 bookings
        </Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => race(10)}>
          Race 10
        </Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => race(20)}>
          Race 20
        </Button>
      </div>

      {empty && <Alert tone="warning">No free window in the next three weeks to race for.</Alert>}

      {result && (
        <Card className="overflow-hidden">
          <div className="border-b border-zinc-100 px-5 py-4">
            <p className="text-sm text-zinc-500">
              Target: {result.crewName}, {formatDate(result.window.date, "long")},{" "}
              {formatWindow(result.window.localStart, result.window.localEnd)}
            </p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {winners === 1
                ? `1 of ${result.contenders.length} got the slot. No double booking.`
                : `${winners} of ${result.contenders.length} got the slot.`}
            </p>
          </div>
          <ul className="divide-y divide-zinc-100">
            {result.contenders.map((c) => (
              <li key={c.index} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="text-zinc-700">Client {c.index}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular text-xs text-zinc-400">{c.ms} ms</span>
                  {c.outcome === "won" ? (
                    <Badge tone="success">Slot held</Badge>
                  ) : (
                    <Badge tone="neutral">
                      Refused · <code>{c.code}</code>
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.alternatives.length > 0 && (
            <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4 text-sm">
              <p className="font-medium text-zinc-800">Offered to the others instead:</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.alternatives.map((w) => (
                  <li key={`${w.date} ${w.localStart}`}>
                    <Badge tone="brand">
                      {formatDate(w.date)}, {formatWindow(w.localStart, w.localEnd)}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-zinc-500">
                The demo releases the winning hold right away, so it never takes a real slot.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
