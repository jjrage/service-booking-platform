import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireCleaner } from "@/server/auth/viewer";
import { myCrew } from "@/server/crew";
import { DemoBanner } from "@/ui/demo-banner";
import { Skeleton } from "@/ui/feedback";

import { signOut } from "../login/actions";

export const metadata: Metadata = {
  title: { default: "Crew", template: "%s · Crew" },
  robots: { index: false },
};

export default function CrewLayout({ children }: LayoutProps<"/crew">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50">
      <DemoBanner />
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <Suspense fallback={<Skeleton className="h-8 w-40" />}>
            <CrewBrand />
          </Suspense>
          <form action={signOut}>
            <button type="submit" className="text-sm text-zinc-500 underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}

async function CrewBrand() {
  const viewer = await requireCleaner();
  const crew = await myCrew(viewer.staff, viewer.userId);
  return (
    <Link href="/crew" className="flex items-center gap-2.5">
      <span
        className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
        style={{ background: crew?.color ?? "#0f766e" }}
      >
        {crew?.name.split(" ").at(-1)?.charAt(0) ?? "C"}
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-zinc-900">
          {crew?.name ?? "No crew yet"}
        </span>
        <span className="block text-xs text-zinc-500">{viewer.staff.name}</span>
      </span>
    </Link>
  );
}
