import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white shadow-sm hover:bg-brand-800 focus-visible:outline-brand-700 disabled:bg-brand-700/50",
  secondary:
    "bg-white text-zinc-900 ring-1 ring-inset ring-zinc-300 shadow-sm hover:bg-zinc-50 focus-visible:outline-zinc-400 disabled:text-zinc-400",
  ghost: "text-zinc-700 hover:bg-zinc-100 focus-visible:outline-zinc-400 disabled:text-zinc-400",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:outline-red-600 disabled:bg-red-600/50",
  dark: "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 focus-visible:outline-zinc-900 disabled:bg-zinc-900/50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
