import Link from "next/link";
import { Suspense } from "react";

import { buttonClasses } from "@/ui/button";
import { DemoBanner } from "@/ui/demo-banner";
import { Skeleton } from "@/ui/feedback";

import { requireCatalog } from "./catalog";

export default function TenantLayout({
  children,
  params,
}: LayoutProps<"/[tenant]">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DemoBanner />
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Suspense fallback={<Skeleton className="h-6 w-56" />}>
            <TenantNav params={params} />
          </Suspense>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-zinc-500 sm:flex-row sm:justify-between sm:px-6">
          <Suspense fallback={<span />}>
            <TenantContact params={params} />
          </Suspense>
          <Link href="/" className="hover:text-zinc-800">
            Booking &amp; Client Portal Platform — portfolio demo
          </Link>
        </div>
      </footer>
    </div>
  );
}

async function TenantNav({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await requireCatalog(params);
  return (
    <>
      <Link href={`/${tenant.slug}`} className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
          {tenant.name.charAt(0)}
        </span>
        <span className="font-semibold tracking-tight text-zinc-900">
          {tenant.name}
        </span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        <Link
          href="/portal"
          className="hidden rounded-lg px-3 py-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 sm:block"
        >
          Client portal
        </Link>
        <Link
          href={`/${tenant.slug}/book`}
          className={buttonClasses("primary", "sm")}
        >
          Book online
        </Link>
      </nav>
    </>
  );
}

async function TenantContact({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await requireCatalog(params);
  return (
    <span>
      {tenant.name} · {tenant.phone} · {tenant.contactEmail}
    </span>
  );
}
