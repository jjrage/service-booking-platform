"use client";

import { useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { Alert, Spinner } from "@/ui/feedback";
import { Field, Select } from "@/ui/form";
import { shiftDate } from "@/ui/format";

import { pausePlanAction, resumePlanAction } from "../actions";

const pauseOptions = [
  { days: 14, label: "2 weeks" },
  { days: 28, label: "4 weeks" },
  { days: 56, label: "8 weeks" },
];

export function PlanControls({ planId, status }: { planId: string; status: string }) {
  const [weeks, setWeeks] = useState(pauseOptions[0]!.days);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "paused") {
    return (
      <div className="space-y-3">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <p className="text-sm text-zinc-600">Resume and we schedule your next visits right away.</p>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await resumePlanAction(planId);
              setMessage(
                result.ok
                  ? {
                      tone: "success",
                      text: "Welcome back! Your visits are scheduled again.",
                    }
                  : { tone: "danger", text: result.message },
              );
            })
          }
        >
          {pending && <Spinner />}
          Resume plan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Field
        label="Going away?"
        htmlFor="pause-length"
        hint="Visits in the next 48 hours stay; skip them one by one."
      >
        <Select id="pause-length" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          {pauseOptions.map((option) => (
            <option key={option.days} value={option.days}>
              Pause for {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const today = new Date().toISOString().slice(0, 10);
            const result = await pausePlanAction(planId, shiftDate(today, weeks));
            setMessage(
              result.ok
                ? {
                    tone: "success",
                    text: `Paused. ${result.cancelled} ${result.cancelled === 1 ? "visit was" : "visits were"} cancelled at no charge.`,
                  }
                : { tone: "danger", text: result.message },
            );
          })
        }
      >
        {pending && <Spinner />}
        Pause plan
      </Button>
    </div>
  );
}
