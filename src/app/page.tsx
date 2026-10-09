import Link from "next/link";

import { demoAccounts } from "@/server/auth/demo";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { DemoBanner } from "@/ui/demo-banner";
import { Badge } from "@/ui/feedback";

import { DemoButtons } from "./login/forms";

const parts = [
  {
    title: "Online booking",
    body: "Instant quote from the business's own price rules, real arrival windows, a 10-minute slot hold, card deposit.",
    href: "/wrenfield/book",
    cta: "Book a cleaning",
  },
  {
    title: "Client portal",
    body: "Sign in by e-mail link. Reschedule or cancel with the exact fee shown first, skip or pause a regular plan, receipts.",
    href: "/login",
    cta: "Sign in as a client",
  },
  {
    title: "Crew app",
    body: "Today's jobs on a phone: address and access notes only around the visit, checklist, photos, done or no access.",
    href: "/login",
    cta: "Sign in as a cleaner",
  },
  {
    title: "Admin console",
    body: "Crew calendar with drag-and-drop, booking history, clients and notes, payments and refunds, versioned rules, reports.",
    href: "/login",
    cta: "Sign in as the owner",
  },
  {
    title: "AI assistant",
    body: "Prices, books and reschedules through the same server functions as the forms, and never confirms what the server didn't do.",
    href: "/wrenfield",
    cta: "Open the chat",
  },
  {
    title: "Race demo",
    body: "Fire several booking attempts at the same arrival window at once: exactly one wins, the others are offered other times.",
    href: "/wrenfield/race",
    cta: "Run the race",
  },
];

const guarantees = [
  [
    "No double bookings",
    "A Postgres EXCLUDE constraint on each crew's time ranges refuses any overlap, under concurrent load too.",
  ],
  [
    "Each role sees only its data",
    "Row-level security in the database, tested with pgTAP: a cleaner never sees another crew's addresses.",
  ],
  [
    "One pricing function",
    "Booking page, portal, admin and AI call the same quote(); each booking stores its quote snapshot.",
  ],
  [
    "Rules belong to the owner",
    "Prices, hours and cancellation fees are versioned data with a live preview, not code.",
  ],
  [
    "Deposits, saved cards, fees",
    "Stripe (test mode) or a built-in simulator; webhooks are applied exactly once.",
  ],
  [
    "DST-safe regular visits",
    "Plans are stored in local time; a biweekly 8:00 visit stays at 8:00 across the November clock change.",
  ],
  [
    "Reminders that arrive once",
    "An outbox written in the same transaction as the booking; retries never send twice.",
  ],
  [
    "AI without made-up answers",
    "Booking cards come from tool results; every tool call is logged and reviewable.",
  ],
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DemoBanner />
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="font-semibold tracking-tight text-zinc-900">
            Booking &amp; Client Portal Platform
          </span>
          <Link href="/login" className="text-sm text-zinc-600 hover:text-zinc-900">
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b border-zinc-200 bg-gradient-to-b from-brand-50 to-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_1fr] lg:py-20">
            <div>
              <Badge tone="brand">Portfolio demo</Badge>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
                Booking, a client portal and an AI assistant for a service business.
              </h1>
              <p className="mt-4 max-w-xl text-lg text-zinc-600">
                One multi-tenant core: the business&apos;s rules live in the database, every screen
                and the AI use the same server functions, and the database itself guarantees what
                must never go wrong.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/wrenfield" size="lg">
                  Visit the demo business
                </ButtonLink>
                <ButtonLink href="/wrenfield/race" size="lg" variant="secondary">
                  Race two bookings
                </ButtonLink>
              </div>
              <p className="mt-6 text-sm text-zinc-500">
                The demo business is Wrenfield Home Cleaning, a fictional company in Raleigh, NC.
                Data resets every night.
              </p>
            </div>
            <Card className="self-start p-6">
              <h2 className="text-sm font-semibold text-zinc-900">Try every role</h2>
              <p className="mt-1 text-sm text-zinc-500">One click, no password.</p>
              <DemoButtons
                accounts={Object.entries(demoAccounts).map(([role, account]) => ({
                  role: role as keyof typeof demoAccounts,
                  label: account.label,
                  name: account.name,
                }))}
              />
            </Card>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
            What&apos;s inside
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {parts.map((part) => (
              <Card key={part.title} className="flex flex-col p-5">
                <h3 className="font-semibold text-zinc-900">{part.title}</h3>
                <p className="mt-2 flex-1 text-sm text-zinc-600">{part.body}</p>
                <Link
                  href={part.href}
                  className="mt-4 text-sm font-medium text-brand-700 hover:underline"
                >
                  {part.cta} →
                </Link>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Guarantees, enforced and tested
            </h2>
            <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {guarantees.map(([title, body]) => (
                <div key={title}>
                  <dt className="font-medium text-zinc-900">{title}</dt>
                  <dd className="mt-1 text-sm text-zinc-600">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-zinc-500 sm:px-6">
          Next.js 16 · Supabase (Postgres, row-level security, Auth, Storage) · Stripe test mode ·
          Resend · Claude API. A portfolio project; the business, people and data are fictional.
        </div>
      </footer>
    </div>
  );
}
