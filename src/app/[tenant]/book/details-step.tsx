"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { QuoteInput } from "@/domain/quote";
import type { Hold } from "@/server/booking/hold";
import { Button } from "@/ui/button";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { Alert, Spinner } from "@/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/ui/form";
import { formatDate, formatWindow } from "@/ui/format";

import { placeBookingAction, releaseHoldAction } from "./actions";
import type { WizardContext } from "./booking-wizard";

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  hasPets: boolean;
  petNotes: string;
  accessNotes: string;
  parkingNotes: string;
};

/** Seconds left until an instant, updated every second. */
function useCountdown(until: string): number {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000)),
  );
  useEffect(() => {
    const timer = setInterval(
      () =>
        setLeft(
          Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000)),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

export function DetailsStep({
  context,
  request,
  hold,
  onBack,
  onHoldLost,
}: {
  context: WizardContext;
  request: QuoteInput;
  hold: Hold;
  onBack: () => void;
  onHoldLost: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    fullName: "",
    email: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: context.defaultState,
    hasPets: false,
    petNotes: "",
    accessNotes: "",
    parkingNotes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const secondsLeft = useCountdown(hold.expiresAt);
  const expired = secondsLeft === 0;

  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));
  const field = (name: keyof FormState, path: string) => ({
    id: name,
    value: form[name] as string,
    "aria-invalid": Boolean(errors[path]),
    onChange: (e: { target: { value: string } }) =>
      set({ [name]: e.target.value }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await placeBookingAction({
        slug: context.slug,
        request: {
          quote: request,
          contact: {
            fullName: form.fullName,
            email: form.email,
            phone: form.phone,
          },
          address: {
            line1: form.line1,
            line2: form.line2,
            city: form.city,
            state: form.state,
            zip: request.zip,
          },
          notes: {
            hasPets: form.hasPets,
            petNotes: form.petNotes,
            accessNotes: form.accessNotes,
            parkingNotes: form.parkingNotes,
          },
        },
      });
      if (result.ok) {
        router.push(result.url);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message);
      if (result.code === "hold_expired" || result.code === "slot_taken")
        onHoldLost();
    });
  }

  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Your details
        </h1>
        <p className="mt-1 text-zinc-600">
          Held for you: <strong>{formatDate(hold.date, "long")}</strong>,
          arrival{" "}
          <strong>{formatWindow(hold.localStart, hold.localEnd)}</strong>.
        </p>
      </div>

      <Alert tone={expired ? "danger" : secondsLeft < 120 ? "warning" : "info"}>
        {expired ? (
          <>
            Your hold expired.{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={onHoldLost}
            >
              Pick a window again
            </button>
          </>
        ) : (
          <>
            We are holding this window for{" "}
            <span className="tabular font-semibold">
              {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </span>
            .
          </>
        )}
      </Alert>

      {message && <Alert tone="danger">{message}</Alert>}

      <Card>
        <CardHeader
          title="Contact"
          description="We send the confirmation and reminders here."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Full name"
            htmlFor="fullName"
            error={errors["contact.fullName"]}
            className="sm:col-span-2"
          >
            <Input
              autoComplete="name"
              {...field("fullName", "contact.fullName")}
            />
          </Field>
          <Field label="E-mail" htmlFor="email" error={errors["contact.email"]}>
            <Input
              type="email"
              autoComplete="email"
              {...field("email", "contact.email")}
            />
          </Field>
          <Field
            label="Mobile phone"
            htmlFor="phone"
            error={errors["contact.phone"]}
          >
            <Input
              type="tel"
              autoComplete="tel"
              placeholder="(919) 555-0123"
              {...field("phone", "contact.phone")}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Address" />
        <CardBody className="grid gap-4 sm:grid-cols-6">
          <Field
            label="Street address"
            htmlFor="line1"
            error={errors["address.line1"]}
            className="sm:col-span-4"
          >
            <Input
              autoComplete="address-line1"
              {...field("line1", "address.line1")}
            />
          </Field>
          <Field label="Apt, suite" htmlFor="line2" className="sm:col-span-2">
            <Input
              autoComplete="address-line2"
              {...field("line2", "address.line2")}
            />
          </Field>
          <Field
            label="City"
            htmlFor="city"
            error={errors["address.city"]}
            className="sm:col-span-3"
          >
            <Input
              autoComplete="address-level2"
              {...field("city", "address.city")}
            />
          </Field>
          <Field
            label="State"
            htmlFor="state"
            error={errors["address.state"]}
            className="sm:col-span-1"
          >
            <Input
              autoComplete="address-level1"
              maxLength={2}
              {...field("state", "address.state")}
            />
          </Field>
          <Field
            label="ZIP"
            htmlFor="zipLocked"
            hint="From your quote"
            className="sm:col-span-2"
          >
            <Input id="zipLocked" value={request.zip} disabled readOnly />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Getting in"
          description="Only the crew assigned to your visit sees this."
        />
        <CardBody className="space-y-4">
          <Field
            label="How do we get in?"
            htmlFor="accessNotes"
            hint="Lockbox code, garage keypad, someone home…"
          >
            <Textarea {...field("accessNotes", "notes.accessNotes")} />
          </Field>
          <Field label="Parking" htmlFor="parkingNotes">
            <Input {...field("parkingNotes", "notes.parkingNotes")} />
          </Field>
          <Checkbox
            checked={form.hasPets}
            onChange={(e) => set({ hasPets: e.target.checked })}
            label="There are pets in the home"
          />
          {form.hasPets && (
            <Field label="About your pets" htmlFor="petNotes">
              <Input {...field("petNotes", "notes.petNotes")} />
            </Field>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <Button
          variant="ghost"
          onClick={async () => {
            await releaseHoldAction({ slug: context.slug });
            onBack();
          }}
        >
          ← Change the time
        </Button>
        <Button type="submit" size="lg" disabled={pending || expired}>
          {pending && <Spinner />}
          Continue to payment
        </Button>
      </div>
    </form>
  );
}
