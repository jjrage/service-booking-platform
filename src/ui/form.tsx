import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

const control =
  "block w-full rounded-lg border-0 bg-white px-3 text-sm text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 " +
  "placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-zinc-50 disabled:text-zinc-500 " +
  "aria-invalid:ring-red-400";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-10 pr-8", className)} {...props} />;
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className={cn("flex cursor-pointer gap-3", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 accent-brand-700"
        {...props}
      />
      <span className="text-sm">
        <span className="font-medium text-zinc-800">{label}</span>
        {description && <span className="block text-zinc-500">{description}</span>}
      </span>
    </label>
  );
}

/** A number input with − and + buttons, for counts like bedrooms. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const button =
    "flex size-9 items-center justify-center rounded-md text-lg text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-300 disabled:hover:bg-transparent";
  return (
    <div className="inline-flex items-center rounded-lg bg-white p-0.5 shadow-sm ring-1 ring-zinc-300">
      <button
        type="button"
        className={button}
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="tabular w-8 text-center text-sm font-semibold" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={button}
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}
