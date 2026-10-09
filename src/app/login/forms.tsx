"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { Alert, Spinner } from "@/ui/feedback";
import { Field, Input } from "@/ui/form";

import { sendMagicLink, signInAsDemo, signInWithPassword } from "./actions";

type Role = "client" | "owner" | "dispatcher" | "cleaner";

export function DemoButtons({
  accounts,
}: {
  accounts: { role: Role; label: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {accounts.map((account) => (
          <button
            key={account.role}
            type="button"
            disabled={pending}
            onClick={() => {
              setActive(account.role);
              setError(null);
              startTransition(async () => {
                const result = await signInAsDemo(account.role);
                if (result?.error) setError(result.error);
              });
            }}
            className="rounded-lg p-3 text-left ring-1 ring-zinc-200 transition hover:bg-brand-50 hover:ring-brand-600 disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              {pending && active === account.role && <Spinner />}
              {account.label}
            </span>
            <span className="block text-xs text-zinc-500">{account.name}</span>
          </button>
        ))}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

export function MagicLinkForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(sendMagicLink, undefined);
  if (state?.sent) {
    return (
      <Alert tone="success" className="mt-4" title="Check your e-mail">
        If {state.sent} has bookings with us, a sign-in link is on its way. It works once and
        expires in an hour.
      </Alert>
    );
  }
  return (
    <form action={action} className="mt-4 space-y-3">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="E-mail" htmlFor="magic-email" error={state?.error}>
        <Input id="magic-email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        E-mail me a sign-in link
      </Button>
    </form>
  );
}

export function PasswordForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, undefined);
  return (
    <form action={action} className="mt-4 space-y-3">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="E-mail" htmlFor="staff-email">
        <Input id="staff-email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" htmlFor="staff-password" error={state?.error}>
        <Input
          id="staff-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Button type="submit" variant="dark" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Sign in
      </Button>
    </form>
  );
}
