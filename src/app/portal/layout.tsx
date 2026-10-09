import type { Metadata } from "next";
import { Suspense } from "react";

import { requireClient } from "@/server/auth/viewer";
import { DemoBanner } from "@/ui/demo-banner";
import { Skeleton } from "@/ui/feedback";

import { signOut } from "../login/actions";
import { PortalNav, PortalNavFallback } from "./nav";

export const metadata: Metadata = {
  title: { default: "Client portal", template: "%s · Client portal" },
  robots: { index: false },
};

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DemoBanner />
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Suspense fallback={<Skeleton className="h-8 w-56" />}>
            <PortalBrand />
          </Suspense>
          <Suspense fallback={<PortalNavFallback />}>
            <PortalNav />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

async function PortalBrand() {
  const { client } = await requireClient();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
        {client.name.charAt(0)}
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-zinc-900">{client.name}</p>
        <div className="text-xs text-zinc-500">
          {client.fullName} ·{" "}
          <form action={signOut} className="inline">
            <button type="submit" className="underline hover:text-zinc-800">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
