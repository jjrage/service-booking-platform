import type { Metadata } from "next";
import { Suspense } from "react";

import { requireCatalog } from "../catalog";
import { RaceDemo } from "./race-demo";

export const metadata: Metadata = { title: "Race two bookings" };

export default function RacePage({ params }: PageProps<"/[tenant]/race">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <p className="text-sm font-medium text-brand-700">Under the hood</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">
        Two clients, one slot: who gets it?
      </h1>
      <div className="mt-4 space-y-3 text-zinc-600">
        <p>
          Press a button and the server fires that many booking attempts at the
          same arrival window of the same crew, all at once. Each attempt is a
          separate request and database transaction, like real checkouts from
          different phones.
        </p>
        <p>
          The application never checks &quot;is it free?&quot; before writing.
          Postgres does the check itself, at the moment of writing: an{" "}
          <code className="text-sm">EXCLUDE</code> constraint on the crew&apos;s
          time ranges refuses any overlap with error{" "}
          <code className="text-sm">23P01</code>. Exactly one attempt wins; the
          others are offered the next free windows.
        </p>
      </div>
      <Suspense>
        <Demo params={params} />
      </Suspense>
    </main>
  );
}

async function Demo({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await requireCatalog(params);
  return <RaceDemo tenant={tenant.slug} />;
}
