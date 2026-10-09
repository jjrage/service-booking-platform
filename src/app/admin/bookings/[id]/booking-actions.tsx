"use client";

import { useState, useTransition } from "react";

import type { BoardCrew } from "@/server/admin";
import type { DayChoice, WindowChoice } from "@/server/booking/availability";
import type { ChangePreview } from "@/server/booking/change";
import { Button } from "@/ui/button";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Alert, Skeleton, Spinner } from "@/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/ui/form";
import { formatDate, formatMoney, formatWindowShort, shiftDate } from "@/ui/format";

import {
  reassignAction,
  refundAction,
  staffCancelAction,
  staffCompleteAction,
  staffNoAccessAction,
  staffPreviewAction,
  staffRescheduleAction,
  staffWindowsAction,
} from "../../actions";

type Panel = "none" | "reschedule" | "cancel" | "finish";

export function BookingAdminActions({
  bookingId,
  crewId,
  crews,
  currency,
  date,
  canFinish,
}: {
  bookingId: string;
  crewId: string;
  crews: BoardCrew[];
  currency: string;
  date: string;
  canFinish: boolean;
}) {
  const [panel, setPanel] = useState<Panel>("none");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [days, setDays] = useState<DayChoice[] | null>(null);
  const [from, setFrom] = useState(date);
  const [picked, setPicked] = useState<WindowChoice | null>(null);
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState("");
  const money = (cents: number) => formatMoney(cents, currency);

  function run(action: () => Promise<{ ok: boolean; message?: string }>, done?: string) {
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message ?? done ?? "Done." });
      if (result.ok) setPanel("none");
    });
  }

  function open(next: Panel) {
    setPanel(next);
    setMessage(null);
    setPreview(null);
    setPicked(null);
    setWaive(false);
    if (next === "cancel" || next === "reschedule") {
      startTransition(async () => {
        setPreview(await staffPreviewAction(bookingId, next));
        if (next === "reschedule") setDays(await staffWindowsAction(bookingId, from));
      });
    }
  }

  function load(start: string) {
    setFrom(start);
    startTransition(async () => setDays(await staffWindowsAction(bookingId, start)));
  }

  return (
    <Card>
      <CardHeader title="Actions" />
      <CardBody className="space-y-4">
        {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Crew" htmlFor="crew" className="w-48">
            <Select
              id="crew"
              defaultValue={crewId}
              disabled={pending}
              onChange={(e) => run(() => reassignAction(bookingId, e.target.value))}
            >
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" onClick={() => open("reschedule")} disabled={pending}>
            Reschedule
          </Button>
          <Button variant="secondary" onClick={() => open("cancel")} disabled={pending}>
            Cancel
          </Button>
          {canFinish && (
            <Button variant="secondary" onClick={() => open("finish")} disabled={pending}>
              Mark done / no access
            </Button>
          )}
          {pending && <Spinner />}
        </div>

        {panel === "reschedule" && (
          <div className="space-y-3 rounded-lg bg-zinc-50 p-4">
            {preview ? <FeeLine preview={preview} money={money} /> : <Skeleton className="h-6" />}
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-zinc-500 hover:text-zinc-900"
                onClick={() => load(shiftDate(from, -14))}
              >
                ← Earlier
              </button>
              <span className="text-zinc-500">Staff can book past the client horizon</span>
              <button
                type="button"
                className="text-zinc-500 hover:text-zinc-900"
                onClick={() => load(shiftDate(from, 14))}
              >
                Later →
              </button>
            </div>
            {!days ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg bg-white ring-1 ring-zinc-200">
                {days
                  .filter((d) => d.status === "open")
                  .map((day) => (
                    <li key={day.date} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-28 shrink-0 text-sm text-zinc-800">
                        {formatDate(day.date)}
                      </span>
                      <div className="grid flex-1 grid-cols-3 gap-2">
                        {day.windows.map((w) => (
                          <button
                            key={w.localStart}
                            type="button"
                            disabled={w.status !== "available"}
                            onClick={() => setPicked(w)}
                            className={cn(
                              "h-8 rounded-md text-xs ring-1",
                              picked?.date === w.date && picked.localStart === w.localStart
                                ? "bg-brand-700 text-white ring-brand-700"
                                : w.status === "available"
                                  ? "bg-white ring-zinc-300 hover:ring-brand-600"
                                  : "bg-zinc-50 text-zinc-300 ring-zinc-100",
                            )}
                          >
                            {w.status === "available"
                              ? formatWindowShort(w.localStart, w.localEnd)
                              : "—"}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            {preview && preview.feeCents > 0 && (
              <Checkbox
                checked={waive}
                onChange={(e) => setWaive(e.target.checked)}
                label="Waive the fee"
              />
            )}
            <Button
              disabled={!picked || pending}
              onClick={() =>
                picked &&
                run(() => staffRescheduleAction(bookingId, picked.date, picked.localStart, waive))
              }
            >
              {picked
                ? `Move to ${formatDate(picked.date)}, ${formatWindowShort(picked.localStart, picked.localEnd)}`
                : "Pick a window"}
            </Button>
          </div>
        )}

        {panel === "cancel" && (
          <div className="space-y-3 rounded-lg bg-zinc-50 p-4">
            {preview ? <FeeLine preview={preview} money={money} /> : <Skeleton className="h-6" />}
            <Field label="Reason" htmlFor="reason">
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Client called to cancel"
              />
            </Field>
            {preview && preview.feeCents > 0 && (
              <Checkbox
                checked={waive}
                onChange={(e) => setWaive(e.target.checked)}
                label="Waive the fee (refund the whole deposit)"
              />
            )}
            <Button
              variant="danger"
              disabled={pending || !preview}
              onClick={() => run(() => staffCancelAction(bookingId, waive, reason))}
            >
              Cancel booking
            </Button>
          </div>
        )}

        {panel === "finish" && (
          <div className="flex flex-wrap gap-3 rounded-lg bg-zinc-50 p-4">
            <Button disabled={pending} onClick={() => run(() => staffCompleteAction(bookingId))}>
              Mark done and charge the balance
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => staffNoAccessAction(bookingId, "Reported by the office"))}
            >
              No access (lockout fee)
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function FeeLine({ preview, money }: { preview: ChangePreview; money: (cents: number) => string }) {
  return (
    <p className={cn("text-sm", preview.feeCents > 0 ? "text-amber-800" : "text-emerald-800")}>
      {preview.feeCents > 0 ? `${money(preview.feeCents)} fee. ` : "No fee. "}
      {preview.explanation}
    </p>
  );
}

export function RefundButton({
  paymentId,
  maxCents,
  currency,
}: {
  paymentId: string;
  maxCents: number;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((maxCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Refund
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Input
        className="h-8 w-24"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Refund amount"
      />
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const cents = Math.round(Number(amount) * 100);
            if (!Number.isFinite(cents) || cents <= 0 || cents > maxCents) {
              setError(`Up to ${formatMoney(maxCents, currency)}`);
              return;
            }
            const result = await refundAction(paymentId, cents, "Refund by the office");
            if (result.ok) setOpen(false);
            else setError(result.message);
          })
        }
      >
        Refund
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
