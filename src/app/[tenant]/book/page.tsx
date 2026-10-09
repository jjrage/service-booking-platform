import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/ui/feedback";

import { requireCatalog } from "../catalog";
import { BookingWizard } from "./booking-wizard";

export const metadata: Metadata = { title: "Book a cleaning" };

export default function BookPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/book">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Suspense fallback={<WizardSkeleton />}>
        <Wizard params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Wizard({
  params,
  searchParams,
}: Pick<PageProps<"/[tenant]/book">, "params" | "searchParams">) {
  const catalog = await requireCatalog(params);
  const { service } = await searchParams;
  const instant = catalog.services.filter((s) => s.bookingMode === "instant");
  const initialService =
    typeof service === "string" && instant.some((s) => s.code === service)
      ? service
      : instant[0]?.code;

  return (
    <BookingWizard
      slug={catalog.tenant.slug}
      tenantName={catalog.tenant.name}
      phone={catalog.tenant.phone}
      currency={catalog.tenant.currency}
      services={catalog.services.map(
        ({ code, name, description, bookingMode }) => ({
          code,
          name,
          description,
          bookingMode,
        }),
      )}
      pricing={catalog.pricing.rules}
      holdMinutes={catalog.schedule.rules.hold_minutes}
      initialService={initialService ?? ""}
      // The demo business is in North Carolina; most clients book for a home in the same state.
      defaultState="NC"
    />
  );
}

function WizardSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
