import type { Metadata } from "next";
import { Suspense } from "react";

import { requireStaff } from "@/server/auth/viewer";
import { userDb } from "@/server/db/user-client";
import { DemoBanner } from "@/ui/demo-banner";
import { Skeleton } from "@/ui/feedback";

import { signOut } from "../login/actions";
import { AdminNav, AdminNavFallback } from "./nav";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white lg:flex">
          <div className="px-5 py-5">
            <Suspense fallback={<Skeleton className="h-10" />}>
              <Brand />
            </Suspense>
          </div>
          <Suspense fallback={<AdminNavFallback />}>
            <NavWithCounts />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
            <Suspense fallback={<AdminNavFallback compact />}>
              <NavWithCounts compact />
            </Suspense>
          </div>
          <main className="w-full flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

async function Brand() {
  const { staff, email } = await requireStaff();
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
          {staff.name.charAt(0)}
        </span>
        <span className="text-sm font-semibold leading-tight text-zinc-900">{staff.name}</span>
      </div>
      <div className="mt-3 text-xs text-zinc-500">
        <span className="capitalize">{staff.role}</span> · {email}
        <form action={signOut}>
          <button type="submit" className="mt-1 underline hover:text-zinc-800">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

async function NavWithCounts({ compact = false }: { compact?: boolean }) {
  const { staff } = await requireStaff();
  const db = await userDb();
  const { count } = await db
    .from("dispatch_alerts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", staff.tenantId)
    .is("resolved_at", null);
  return <AdminNav alerts={count ?? 0} compact={compact} owner={staff.role === "owner"} />;
}
