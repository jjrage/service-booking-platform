"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DayChoice, WindowChoice } from "@/server/booking/availability";
import type { ChangePreview } from "@/server/booking/change";
import { Button } from "@/ui/button";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Alert, Skeleton, Spinner } from "@/ui/feedback";
import { formatDate, formatMoney, formatWindow, formatWindowShort, shiftDate } from "@/ui/format";

import {
  cancelVisitAction,
  previewChangeAction,
  rescheduleVisitAction,
  rescheduleWindowsAction,
} from "../../actions";

type Mode = "idle" | "cancel" | "reschedule";

export function VisitActions({
  bookingId,
  currency,
  isPlanVisit,
  currentDate,
}: {
  bookingId: string;
  currency: string;
  isPlanVisit: boolean;
  currentDate: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [days, setDays] = useState<DayChoice[] | null>(null);
  const [from, setFrom] = useState<string | undefined>();
  const [picked, setPicked] = useState<WindowChoice | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (cents: number) => formatMoney(cents, currency);

  function open(next: Exclude<Mode, "idle">) {
    setMode(next);
    setPreview(null);
    setPicked(null);
    setMessage(null);
    startTransition(async () => {
      setPreview(await previewChangeAction(bookingId, next === "cancel" ? "cancel" : "reschedule"));
      if (next === "reschedule") await loadDays(undefined);
    });
  }

  async function loadDays(start: string | undefined) {
    setFrom(start);
    const result = await rescheduleWindowsAction(bookingId, start);
    if (result.ok) setDays(result.days);
    else setMessage({ tone: "danger", text: result.message });
  }

  function confirmCancel() {
    startTransition(async () => {
      const result = await cancelVisitAction(bookingId);
      setMessage({
        tone: result.ok ? "success" : "danger",
        text: result.message,
      });
      if (result.ok) {
        setMode("idle");
        router.refresh();
      }
    });
  }

  function confirmReschedule() {
    if (!picked) return;
    startTransition(async () => {
      const result = await rescheduleVisitAction(bookingId, picked.date, picked.localStart);
      if (result.ok) {
        setMessage({
          tone: "success",
          text: `Moved to ${formatDate(picked.date, "long")}, ${formatWindow(picked.localStart, picked.localEnd)}.`,
        });
        setMode("idle");
        router.refresh();
      } else {
        setMessage({ tone: "danger", text: result.message });
        await loadDays(from);
      }
    });
  }

  return (
    <div className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {mode === "idle" && (
        <Card className="p-5">
          <p className="text-sm text-zinc-600">
            Plans changed? Move or cancel this visit. You see the exact fee, if any, before you
            confirm.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => open("reschedule")}>Reschedule</Button>
            <Button variant="secondary" onClick={() => open("cancel")}>
              {isPlanVisit ? "Skip this visit" : "Cancel visit"}
            </Button>
          </div>
        </Card>
      )}

      {mode !== "idle" && (
        <Card>
          <CardHeader
            title={
              mode === "cancel"
                ? isPlanVisit
                  ? "Skip this visit"
                  : "Cancel this visit"
                : "Reschedule"
            }
            action={
              <Button variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={pending}>
                Close
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {!preview ? (
              <Skeleton className="h-16" />
            ) : (
              <FeeNotice preview={preview} mode={mode} money={money} isPlanVisit={isPlanVisit} />
            )}

            {mode === "reschedule" && (
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="text-zinc-500 hover:text-zinc-900 disabled:opacity-40"
                    disabled={pending || !from}
                    onClick={() =>
                      startTransition(() => loadDays(from ? shiftDate(from, -14) : undefined))
                    }
                  >
                    ← Earlier
                  </button>
                  <span className="text-zinc-500">Currently {formatDate(currentDate)}</span>
                  <button
                    type="button"
                    className="text-zinc-500 hover:text-zinc-900"
                    disabled={pending || !days}
                    onClick={() =>
                      startTransition(() =>
                        loadDays(days?.at(-1) ? shiftDate(days.at(-1)!.date, 1) : undefined),
                      )
                    }
                  >
                    Later →
                  </button>
                </div>
                {!days ? (
                  <Skeleton className="h-48" />
                ) : (
                  <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200">
                    {days
                      .filter((d) => d.status === "open")
                      .map((day) => (
                        <li
                          key={day.date}
                          className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center"
                        >
                          <span className="w-32 shrink-0 text-sm font-medium text-zinc-800">
                            {formatDate(day.date)}
                          </span>
                          <div className="grid flex-1 grid-cols-3 gap-2">
                            {day.windows.map((w) => {
                              const selected =
                                picked?.date === w.date && picked.localStart === w.localStart;
                              return (
                                <button
                                  key={w.localStart}
                                  type="button"
                                  disabled={w.status !== "available"}
                                  onClick={() => setPicked(w)}
                                  className={cn(
                                    "h-9 rounded-md px-2 text-xs ring-1 sm:text-sm",
                                    selected
                                      ? "bg-brand-700 font-medium text-white ring-brand-700"
                                      : w.status === "available"
                                        ? "bg-white text-zinc-800 ring-zinc-300 hover:ring-brand-600"
                                        : "cursor-not-allowed bg-zinc-50 text-zinc-300 ring-zinc-100",
                                  )}
                                >
                                  {w.status === "available"
                                    ? formatWindowShort(w.localStart, w.localEnd)
                                    : "—"}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              {mode === "cancel" ? (
                <Button variant="danger" onClick={confirmCancel} disabled={pending || !preview}>
                  {pending && <Spinner />}
                  {isPlanVisit ? "Skip visit" : "Cancel visit"}
                  {preview && preview.feeCents > 0 && ` · ${money(preview.feeCents)} fee`}
                </Button>
              ) : (
                <Button onClick={confirmReschedule} disabled={pending || !picked}>
                  {pending && <Spinner />}
                  {picked
                    ? `Move to ${formatDate(picked.date)}, ${formatWindow(picked.localStart, picked.localEnd)}`
                    : "Pick a new window"}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function FeeNotice({
  preview,
  mode,
  money,
  isPlanVisit,
}: {
  preview: ChangePreview;
  mode: Exclude<Mode, "idle">;
  money: (cents: number) => string;
  isPlanVisit: boolean;
}) {
  if (preview.feeCents === 0) {
    return (
      <Alert tone="success" title={mode === "cancel" ? "No fee" : "Free to reschedule"}>
        {preview.explanation}
        {mode === "cancel" && preview.refundCents > 0 && (
          <> Your {money(preview.refundCents)} deposit is refunded to your card.</>
        )}
        {mode === "cancel" && isPlanVisit && <> Your regular plan continues as usual.</>}
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title={`${money(preview.feeCents)} fee`}>
      <p>{preview.explanation}</p>
      {mode === "cancel" && (
        <p className="mt-1">
          {preview.refundCents > 0 &&
            `We keep ${money(preview.feeCents)} of your deposit and refund ${money(preview.refundCents)}. `}
          {preview.chargeCents > 0 &&
            `${preview.paidCents > 0 ? `Your deposit covers ${money(preview.feeCents - preview.chargeCents)}; ` : ""}${money(preview.chargeCents)} is charged to your saved card.`}
          {preview.refundCents === 0 &&
            preview.chargeCents === 0 &&
            "The fee is kept from your deposit."}
        </p>
      )}
      {mode === "reschedule" && (
        <p className="mt-1">It is charged to your saved card when you confirm.</p>
      )}
    </Alert>
  );
}
