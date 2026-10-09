"use client";

import { useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { CardBody } from "@/ui/card";
import { Alert, Spinner } from "@/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/ui/form";

import { updateContactAction, updateHomeNotesAction } from "../actions";

export function ContactForm(props: { fullName: string; phone: string }) {
  const [fullName, setFullName] = useState(props.fullName);
  const [phone, setPhone] = useState(props.phone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <CardBody>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          startTransition(async () => {
            const result = await updateContactAction({ fullName, phone });
            setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
            setSaved(result.ok);
          });
        }}
      >
        <Field label="Full name" htmlFor="fullName" error={errors.fullName}>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Mobile phone" htmlFor="phone" error={errors.phone}>
          <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save
          </Button>
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
      </form>
    </CardBody>
  );
}

export function HomeNotesForm(props: {
  propertyId: string;
  hasPets: boolean;
  petNotes: string;
  accessNotes: string;
  parkingNotes: string;
}) {
  const [notes, setNotes] = useState({
    hasPets: props.hasPets,
    petNotes: props.petNotes,
    accessNotes: props.accessNotes,
    parkingNotes: props.parkingNotes,
  });
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const id = (name: string) => `${name}-${props.propertyId}`;

  return (
    <CardBody>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          startTransition(async () => {
            const outcome = await updateHomeNotesAction(props.propertyId, notes);
            setResult(
              outcome.ok ? { ok: true, text: "Saved" } : { ok: false, text: outcome.message },
            );
          });
        }}
      >
        <Field
          label="How does the crew get in?"
          htmlFor={id("access")}
          hint="Only the crew assigned to your visit sees this, and only around the visit."
        >
          <Textarea
            id={id("access")}
            value={notes.accessNotes}
            onChange={(e) => setNotes({ ...notes, accessNotes: e.target.value })}
          />
        </Field>
        <Field label="Parking" htmlFor={id("parking")}>
          <Input
            id={id("parking")}
            value={notes.parkingNotes}
            onChange={(e) => setNotes({ ...notes, parkingNotes: e.target.value })}
          />
        </Field>
        <Checkbox
          checked={notes.hasPets}
          onChange={(e) => setNotes({ ...notes, hasPets: e.target.checked })}
          label="Pets in the home"
        />
        {notes.hasPets && (
          <Field label="About your pets" htmlFor={id("pets")}>
            <Input
              id={id("pets")}
              value={notes.petNotes}
              onChange={(e) => setNotes({ ...notes, petNotes: e.target.value })}
            />
          </Field>
        )}
        {result && !result.ok && <Alert tone="danger">{result.text}</Alert>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save home notes
          </Button>
          {result?.ok && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
      </form>
    </CardBody>
  );
}
