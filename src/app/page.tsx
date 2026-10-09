import Link from "next/link";

const parts = [
  "Online booking with an instant quote and a card deposit",
  "Client portal: visits, reschedule and cancel with a fee preview, receipts",
  "Crew app: today's jobs, checklist, photo on completion",
  "Admin console: crew calendar, clients, pricing rules, payments, reports",
  "AI assistant that books through the same server functions as the forms",
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Work in progress
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Booking &amp; Client Portal Platform
      </h1>
      <ul className="list-disc space-y-2 pl-5 text-zinc-700">
        {parts.map((part) => (
          <li key={part}>{part}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-4 text-sm font-medium">
        <Link href="/wrenfield" className="text-brand-700 underline">
          Demo business: Wrenfield Home Cleaning
        </Link>
        <Link href="/wrenfield/race" className="text-brand-700 underline">
          Race two bookings for one slot
        </Link>
      </div>
    </main>
  );
}
