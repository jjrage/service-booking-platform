"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/ui/cn";

const links = [
  { href: "/admin", label: "Today" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/assistant", label: "AI assistant" },
  { href: "/admin/crews", label: "Crews & time off" },
  { href: "/admin/rules", label: "Prices & rules" },
  { href: "/admin/alerts", label: "Needs attention" },
] as const;

export function AdminNav(props: { alerts: number; compact?: boolean; owner: boolean }) {
  return <Links {...props} pathname={usePathname()} />;
}

export function AdminNavFallback({ compact = false }: { compact?: boolean }) {
  return <Links alerts={0} compact={compact} owner={false} pathname="" />;
}

function Links({
  alerts,
  compact,
  pathname,
}: {
  alerts: number;
  compact?: boolean;
  owner: boolean;
  pathname: string;
}) {
  return (
    <nav
      className={cn(compact ? "-mx-1 flex gap-1 overflow-x-auto" : "flex flex-col gap-0.5 px-3")}
    >
      {links.map((link) => {
        const active =
          link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm",
              active ? "bg-brand-50 font-medium text-brand-800" : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {link.label}
            {link.href === "/admin/alerts" && alerts > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                {alerts}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
