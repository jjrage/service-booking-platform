"use client";

import type { QuoteInput, QuoteResult } from "@/domain/quote";
import { frequencies, type Frequency } from "@/domain/rules";
import { Button } from "@/ui/button";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Alert, Badge } from "@/ui/feedback";
import { Checkbox, Field, Input, Stepper } from "@/ui/form";
import { formatMoney } from "@/ui/format";

import type { WizardContext } from "./booking-wizard";

const frequencyNames: Record<Frequency, string> = {
  one_time: "One time",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Every 4 weeks",
};

export function HomeStep({
  context,
  request,
  onChange,
  priced,
  onContinue,
}: {
  context: WizardContext;
  request: QuoteInput;
  onChange: (next: QuoteInput) => void;
  priced: QuoteResult | null;
  onContinue: () => void;
}) {
  const { pricing, currency } = context;
  const money = (cents: number) => formatMoney(cents, currency);
  const service = pricing.services[request.service];
  const zone = pricing.zones.find((z) => z.zips.includes(request.zip));
  const set = (patch: Partial<QuoteInput>) => onChange({ ...request, ...patch });
  const setHome = (patch: Partial<QuoteInput["home"]>) =>
    set({ home: { ...request.home, ...patch } });
  const setAddon = (code: string, quantity: number) => {
    const addons = { ...request.addons };
    if (quantity > 0) addons[code] = quantity;
    else delete addons[code];
    set({ addons });
  };
  const instant = context.services.filter((s) => s.bookingMode === "instant");
  const quoted = context.services.filter((s) => s.bookingMode === "quote_request");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Get your price</h1>
        <p className="mt-1 text-zinc-600">Tell us about your home. The price updates as you go.</p>
      </div>

      <Card>
        <CardHeader title="Service" />
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {instant.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() =>
                  set({
                    service: s.code,
                    frequency: pricing.services[s.code]?.recurring ? request.frequency : "one_time",
                  })
                }
                className={cn(
                  "rounded-lg p-3 text-left ring-1 transition",
                  request.service === s.code
                    ? "bg-brand-50 ring-2 ring-brand-600"
                    : "bg-white ring-zinc-200 hover:ring-zinc-300",
                )}
              >
                <span className="block font-medium text-zinc-900">{s.name}</span>
                <span className="mt-1 block text-xs text-zinc-500">{s.description}</span>
              </button>
            ))}
          </div>
          {quoted.length > 0 && (
            <p className="text-sm text-zinc-500">
              {quoted.map((s) => s.name).join(" and ")} are quoted after we see photos — call{" "}
              {context.phone}.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your home" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <CountField
            label="Bedrooms"
            value={request.home.bedrooms}
            min={0}
            onChange={(bedrooms) => setHome({ bedrooms })}
          />
          <CountField
            label="Full bathrooms"
            value={request.home.fullBaths}
            min={0}
            onChange={(fullBaths) => setHome({ fullBaths })}
          />
          <CountField
            label="Half bathrooms"
            value={request.home.halfBaths}
            min={0}
            onChange={(halfBaths) => setHome({ halfBaths })}
          />
          <Field label="Size (sq ft)" htmlFor="sqft">
            <Input
              id="sqft"
              type="number"
              inputMode="numeric"
              min={200}
              max={10000}
              step={50}
              value={request.home.sqft}
              onChange={(e) =>
                setHome({
                  sqft: Math.min(10000, Math.max(200, Number(e.target.value) || 200)),
                })
              }
              className="max-w-36"
            />
          </Field>
          <Field
            label="ZIP code"
            htmlFor="zip"
            hint={
              zone
                ? `${zone.name}${zone.surcharge_cents ? ` · ${money(zone.surcharge_cents)} travel` : " · no travel fee"}`
                : "We serve Raleigh, Cary and most of Wake County."
            }
            error={
              /^\d{5}$/.test(request.zip) && !zone
                ? "Sorry, this ZIP is outside our service area."
                : undefined
            }
          >
            <Input
              id="zip"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              placeholder="27609"
              value={request.zip}
              aria-invalid={/^\d{5}$/.test(request.zip) && !zone}
              onChange={(e) => set({ zip: e.target.value.replace(/\D/g, "").slice(0, 5) })}
              className="max-w-36"
            />
          </Field>
          <Field label="Condition">
            <div className="flex gap-2">
              {(["normal", "heavy"] as const).map((condition) => (
                <button
                  key={condition}
                  type="button"
                  onClick={() => set({ condition })}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm ring-1",
                    request.condition === condition
                      ? "bg-brand-50 font-medium text-brand-900 ring-2 ring-brand-600"
                      : "bg-white text-zinc-700 ring-zinc-200 hover:ring-zinc-300",
                  )}
                >
                  {condition === "normal"
                    ? "Lived-in"
                    : `Needs extra work (+${pricing.condition.heavy.percent}%)`}
                </button>
              ))}
            </div>
          </Field>
          {service?.empty_home_only && (
            <Checkbox
              className="sm:col-span-2"
              checked={request.emptyHome}
              onChange={(e) => set({ emptyHome: e.target.checked })}
              label="The home will be empty"
              description="Move-in / move-out cleans are done in an empty home."
            />
          )}
        </CardBody>
      </Card>

      {service?.recurring && (
        <Card>
          <CardHeader
            title="How often?"
            description="Regular visits keep the same crew and cost less from the second visit."
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {frequencies.map((frequency) => {
                const discount = pricing.frequency_discount_percent[frequency];
                return (
                  <button
                    key={frequency}
                    type="button"
                    onClick={() => set({ frequency })}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-left text-sm ring-1",
                      request.frequency === frequency
                        ? "bg-brand-50 ring-2 ring-brand-600"
                        : "bg-white ring-zinc-200 hover:ring-zinc-300",
                    )}
                  >
                    <span className="block font-medium text-zinc-900">
                      {frequencyNames[frequency]}
                    </span>
                    {discount > 0 && (
                      <span className="text-xs text-emerald-700">{discount}% off</span>
                    )}
                  </button>
                );
              })}
            </div>
            {request.frequency !== "one_time" && pricing.first_visit && (
              <Checkbox
                checked={request.recentlyCleaned}
                onChange={(e) => set({ recentlyCleaned: e.target.checked })}
                label={`My home was cleaned professionally in the last ${pricing.first_visit.if_no_professional_clean_days} days`}
                description="Otherwise the first visit is a deep clean, so regular visits start from a clean slate."
              />
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Extras" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {Object.entries(pricing.addons).map(([code, addon]) => {
            const quantity = request.addons[code] ?? 0;
            return (
              <div
                key={code}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg p-3 ring-1",
                  quantity > 0 ? "bg-brand-50 ring-brand-200" : "ring-zinc-200",
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">{addon.name}</p>
                  <p className="tabular text-xs text-zinc-500">
                    {money(addon.cents)}
                    {addon.per_unit ? " each" : ""}
                  </p>
                </div>
                {addon.per_unit ? (
                  <Stepper
                    label={addon.name}
                    value={quantity}
                    min={0}
                    max={addon.max_units ?? 20}
                    onChange={(value) => setAddon(code, value)}
                  />
                ) : (
                  <input
                    type="checkbox"
                    aria-label={addon.name}
                    className="size-5 accent-brand-700"
                    checked={quantity > 0}
                    onChange={(e) => setAddon(code, e.target.checked ? 1 : 0)}
                  />
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {priced && !priced.ok && priced.error.code !== "out_of_area" && (
        <Alert tone="warning">{priced.error.message}</Alert>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">
          {priced?.ok ? (
            <>
              Total{" "}
              <span className="tabular font-semibold text-zinc-900">
                {money(priced.quote.firstVisit.totalCents)}
              </span>{" "}
              {priced.quote.needsReview && <Badge tone="warning">reviewed by the office</Badge>}
            </>
          ) : (
            "Enter your ZIP code to see the price."
          )}
        </p>
        <Button size="lg" disabled={!priced?.ok} onClick={onContinue}>
          Choose a time
        </Button>
      </div>
    </div>
  );
}

function CountField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      <Stepper label={label.toLowerCase()} value={value} min={min} max={10} onChange={onChange} />
    </div>
  );
}
