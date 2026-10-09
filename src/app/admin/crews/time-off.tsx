"use client";

import { useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { Alert } from "@/ui/feedback";
import { Field, Input, Select } from "@/ui/form";
import { shiftDate } from "@/ui/format";

import { addTimeOffAction, removeTimeOffAction } from "../actions";

export function TimeOffForm({ crewId, today }: { crewId: string; today: string }) {
  const [date, setDate] = useState(shiftDate(today, 1));
  const [days, setDays] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3 border-t border-zinc-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await addTimeOffAction(crewId, date, days, note);
          if (result.ok) setNote("");
          else setError(result.message);
        });
      }}
    >
      <p className="text-sm font-medium text-zinc-800">Add time off</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" htmlFor={`from-${crewId}`}>
          <Input
            id={`from-${crewId}`}
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Days" htmlFor={`days-${crewId}`}>
          <Select
            id={`days-${crewId}`}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[1, 2, 3, 5, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note" htmlFor={`note-${crewId}`}>
        <Input
          id={`note-${crewId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Vacation"
        />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Add time off
      </Button>
    </form>
  );
}

export function RemoveTimeOff({ allocationId }: { allocationId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-zinc-500 underline hover:text-red-600"
      onClick={() => startTransition(async () => void (await removeTimeOffAction(allocationId)))}
    >
      Remove
    </button>
  );
}
