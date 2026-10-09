import { Suspense } from "react";

import { quote } from "@/domain/quote";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatMoney, formatWindow } from "@/ui/format";

import { requireCatalog } from "./catalog";

export default function TenantHome({ params }: PageProps<"/[tenant]">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <TenantHomeContent params={params} />
    </Suspense>
  );
}

async function TenantHomeContent({ params }: { params: Promise<{ tenant: string }> }) {
  const catalog = await requireCatalog(params);
  const { tenant, pricing, schedule } = catalog;
  const smallestHome = {
    bedrooms: pricing.rules.included.bedrooms,
    fullBaths: pricing.rules.included.full_baths,
    halfBaths: pricing.rules.included.half_baths,
    sqft: pricing.rules.included.sqft,
  };
  const anyZip = pricing.rules.zones[0]!.zips[0]!;
  const fromPrice = (code: string) => {
    const result = quote(pricing.rules, {
      service: code,
      home: smallestHome,
      zip: anyZip,
      emptyHome: true,
    });
    return result.ok ? result.quote.firstVisit.totalCents : null;
  };
  const discounts = pricing.rules.frequency_discount_percent;

  return (
    <>
      <section className="border-b border-zinc-200 bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div>
            <Badge tone="brand">Raleigh · Cary · Wake County</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
              A spotless home, booked in two minutes.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-zinc-600">
              See your exact price before you book, pick an arrival window, and manage every visit
              online. Insured two-person crews, the same crew for regular cleanings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={`/${tenant.slug}/book`} size="lg">
                Get an instant price
              </ButtonLink>
              <ButtonLink href="/portal" variant="secondary" size="lg">
                Manage a booking
              </ButtonLink>
            </div>
            <p className="mt-6 text-sm text-zinc-500">
              Arrival windows{" "}
              {schedule.rules.arrival_windows
                .map(([start, end]) => formatWindow(start, end))
                .join(", ")}{" "}
              · Monday to Saturday
            </p>
          </div>
          <Card className="self-start p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Regular cleaning saves more
            </h2>
            <ul className="mt-4 divide-y divide-zinc-100">
              {(
                [
                  ["weekly", "Weekly"],
                  ["biweekly", "Every 2 weeks"],
                  ["monthly", "Every 4 weeks"],
                ] as const
              ).map(([key, label]) => (
                <li key={key} className="flex items-center justify-between py-3">
                  <span className="font-medium text-zinc-800">{label}</span>
                  <Badge tone="success">{discounts[key]}% off</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-zinc-500">
              From the second visit. Skip or pause any time in the client portal.
            </p>
          </Card>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">Services</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.services.map((service) => {
            const price = service.bookingMode === "instant" ? fromPrice(service.code) : null;
            return (
              <Card key={service.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-zinc-900">{service.name}</h3>
                  {price !== null ? (
                    <span className="tabular whitespace-nowrap text-sm font-medium text-zinc-700">
                      from {formatMoney(price, tenant.currency)}
                    </span>
                  ) : (
                    <Badge>Quoted</Badge>
                  )}
                </div>
                <p className="mt-2 flex-1 text-sm text-zinc-600">{service.description}</p>
                {service.bookingMode === "instant" ? (
                  <ButtonLink
                    href={`/${tenant.slug}/book?service=${service.code}`}
                    variant="secondary"
                    size="sm"
                    className="mt-4 self-start"
                  >
                    Price my home
                  </ButtonLink>
                ) : (
                  <p className="mt-4 text-sm text-zinc-500">
                    Call {tenant.phone} or e-mail {tenant.contactEmail} with a few photos.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
          {[
            [
              "Exact price up front",
              "Bedrooms, bathrooms, size and extras — the price you see is the price you pay.",
            ],
            [
              "A real arrival window",
              "Only windows a crew is actually free for. Your slot is held while you check out.",
            ],
            [
              "Fair, clear policy",
              "Free changes up to 48 hours before your window. Your deposit secures the crew.",
            ],
          ].map(([title, body]) => (
            <div key={title}>
              <h3 className="font-semibold text-zinc-900">{title}</h3>
              <p className="mt-2 text-sm text-zinc-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">Where we clean</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {pricing.rules.zones.map((zone) => (
            <Card key={zone.code} className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-zinc-900">{zone.name}</h3>
                <Badge tone={zone.surcharge_cents === 0 ? "success" : "neutral"}>
                  {zone.surcharge_cents === 0
                    ? "No travel fee"
                    : `+${formatMoney(zone.surcharge_cents, tenant.currency)} travel`}
                </Badge>
              </div>
              <p className="tabular mt-3 text-sm leading-6 text-zinc-500">
                {zone.zips.join(" · ")}
              </p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-16 sm:px-6">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
