import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { demoAccounts } from "@/server/auth/demo";
import { Card } from "@/ui/card";
import { Alert, Skeleton } from "@/ui/feedback";

import { DemoButtons, MagicLinkForm, PasswordForm } from "./forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-start justify-center bg-zinc-50 px-4 py-12 sm:py-20">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="text-sm font-medium text-brand-700">
            Booking &amp; Client Portal Platform
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
        </div>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-zinc-900">Try the demo</h2>
          <p className="mt-1 text-sm text-zinc-500">
            One click, no password. Each role sees only what it is allowed to.
          </p>
          <DemoButtons
            accounts={Object.entries(demoAccounts).map(([role, account]) => ({
              role: role as keyof typeof demoAccounts,
              label: account.label,
              name: account.name,
            }))}
          />
        </Card>

        <Suspense fallback={<Skeleton className="h-64" />}>
          <SignInForms searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SignInForms({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error =
    params.error === "link"
      ? "That sign-in link has expired or was already used. Request a new one."
      : params.error === "no-client"
        ? "This account is not linked to any bookings yet."
        : null;

  return (
    <>
      {error && <Alert tone="warning">{error}</Alert>}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Clients</h2>
        <p className="mt-1 text-sm text-zinc-500">
          We e-mail you a one-time link. Use the address you booked with.
        </p>
        <MagicLinkForm next={next} />
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Staff</h2>
        <PasswordForm next={next} />
      </Card>
    </>
  );
}
