"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/ui/cn";

const links = [
  { href: "/portal", label: "Visits" },
  { href: "/portal/plan", label: "Regular plan" },
  { href: "/portal/billing", label: "Payments" },
  { href: "/portal/profile", label: "Home & profile" },
] as const;

export function PortalNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** The links without the current page highlighted, while the URL is not known yet (prerendered shell). */
export function PortalNavFallback() {
  return <NavLinks pathname="" />;
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto text-sm">
      {links.map((link) => {
        const active =
          link.href === "/portal"
            ? pathname === "/portal" || pathname.startsWith("/portal/visits")
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-2",
              active ? "bg-brand-50 font-medium text-brand-800" : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
