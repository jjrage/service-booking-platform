"use client";

import { useMemo, useState } from "react";

import { quote, type QuoteInput, type QuoteResult } from "@/domain/quote";
import type { PricingRules } from "@/domain/rules";
import type { Hold } from "@/server/booking/hold";
import { cn } from "@/ui/cn";

import { DetailsStep } from "./details-step";
import { HomeStep } from "./home-step";
import { QuoteSummary } from "./quote-summary";
import { WindowStep } from "./window-step";

export type WizardService = {
  code: string;
  name: string;
  description: string;
  bookingMode: "instant" | "quote_request" | "class";
};

export type WizardContext = {
  slug: string;
  tenantName: string;
  phone: string | null;
  currency: string;
  services: WizardService[];
  pricing: PricingRules;
  holdMinutes: number;
  defaultState: string;
};

type Step = "home" | "time" | "details";

const steps: { key: Step; label: string }[] = [
  { key: "home", label: "Your home" },
  { key: "time", label: "Arrival window" },
  { key: "details", label: "Your details" },
];

export function BookingWizard(props: WizardContext & { initialService: string }) {
  const { initialService, ...context } = props;
  const included = context.pricing.included;
  const [step, setStep] = useState<Step>("home");
  const [hold, setHold] = useState<Hold | null>(null);
  const [request, setRequest] = useState<QuoteInput>({
    service: initialService,
    home: {
      bedrooms: Math.max(included.bedrooms, 2),
      fullBaths: Math.max(included.full_baths, 1),
      halfBaths: included.half_baths,
      sqft: null,
    },
    addons: {},
    condition: "normal",
    frequency: "one_time",
    zip: "",
    emptyHome: false,
    recentlyCleaned: false,
  });

  // The same quote() the server uses; the server prices again when the booking is placed.
  const priced: QuoteResult | null = useMemo(
    () => (/^\d{5}$/.test(request.zip) ? quote(context.pricing, request) : null),
    [context.pricing, request],
  );

  return (
    <div>
      <ol className="mb-8 flex items-center gap-2 text-sm">
        {steps.map((s, index) => {
          const current = steps.findIndex((x) => x.key === step);
          return (
            <li key={s.key} className="flex items-center gap-2">
              {index > 0 && <span className="h-px w-6 bg-zinc-300 sm:w-10" />}
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                  index < current && "bg-brand-100 text-brand-800",
                  index === current && "bg-brand-700 text-white",
                  index > current && "bg-zinc-200 text-zinc-500",
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  "hidden sm:inline",
                  index === current ? "font-medium text-zinc-900" : "text-zinc-500",
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {step === "home" && (
            <HomeStep
              context={context}
              request={request}
              onChange={setRequest}
              priced={priced}
              onContinue={() => setStep("time")}
            />
          )}
          {step === "time" && (
            <WindowStep
              context={context}
              request={request}
              onBack={() => setStep("home")}
              onHeld={(held) => {
                setHold(held);
                setStep("details");
              }}
            />
          )}
          {step === "details" && hold && (
            <DetailsStep
              context={context}
              request={request}
              hold={hold}
              onBack={() => setStep("time")}
              onHoldLost={() => {
                setHold(null);
                setStep("time");
              }}
            />
          )}
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <QuoteSummary
            context={context}
            request={request}
            priced={priced}
            hold={step === "details" ? hold : null}
          />
        </aside>
      </div>
    </div>
  );
}
