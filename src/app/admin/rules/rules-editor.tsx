"use client";

import { useMemo, useState, useTransition } from "react";

import { cancellationFee } from "@/domain/cancellation";
import { quote, type QuoteRequest } from "@/domain/quote";
import {
  weekdays,
  type CancellationRules,
  type PricingRules,
  type RuleKind,
  type ScheduleRules,
} from "@/domain/rules";
import { Button } from "@/ui/button";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Alert, Badge, Spinner } from "@/ui/feedback";
import { Field, Input } from "@/ui/form";
import { formatMoney } from "@/ui/format";

import { publishRulesAction } from "../actions";

type Versioned<T> = { id: string; version: number; rules: T };

/** Sample homes the preview prices with the current and the draft rules. */
const samples: { label: string; request: QuoteRequest }[] = [
  {
    label: "1 bed apartment, standard",
    request: {
      service: "standard",
      home: { bedrooms: 1, fullBaths: 1, halfBaths: 0, sqft: 800 },
      zip: "27605",
    },
  },
  {
    label: "3 bed house, standard + fridge",
    request: {
      service: "standard",
      home: { bedrooms: 3, fullBaths: 2, halfBaths: 1, sqft: 2100 },
      zip: "27609",
      addons: { fridge: 1 },
    },
  },
  {
    label: "4 bed house, deep clean, Cary",
    request: {
      service: "deep",
      home: { bedrooms: 4, fullBaths: 3, halfBaths: 0, sqft: 2850 },
      zip: "27513",
    },
  },
  {
    label: "3 bed, every 2 weeks (regular visit)",
    request: {
      service: "standard",
      home: { bedrooms: 3, fullBaths: 2, halfBaths: 0, sqft: 1750 },
      zip: "27612",
      frequency: "biweekly",
      recentlyCleaned: true,
    },
  },
  {
    label: "Move-out, 2 bed condo",
    request: {
      service: "move_in_out",
      home: { bedrooms: 2, fullBaths: 2, halfBaths: 0, sqft: 1300 },
      zip: "27608",
      emptyHome: true,
    },
  },
];

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");
const toCents = (value: string) => Math.round(Number(value) * 100);

function MoneyInput({
  cents,
  onChange,
  label,
}: {
  cents: number;
  onChange: (cents: number) => void;
  label: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
        $
      </span>
      <Input
        aria-label={label}
        inputMode="decimal"
        className="pl-6"
        defaultValue={dollars(cents)}
        onChange={(e) => {
          const next = toCents(e.target.value);
          if (Number.isFinite(next) && next >= 0) onChange(next);
        }}
      />
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  label,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <Input
        aria-label={label}
        inputMode="numeric"
        defaultValue={String(value)}
        className={suffix ? "pr-10" : undefined}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isInteger(next) && next >= 0) onChange(next);
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function RulesEditor({
  canPublish,
  services,
  pricing,
  schedule,
  cancellation,
}: {
  canPublish: boolean;
  services: { code: string; name: string }[];
  pricing: Versioned<PricingRules>;
  schedule: Versioned<ScheduleRules>;
  cancellation: Versioned<CancellationRules>;
}) {
  const [tab, setTab] = useState<RuleKind>("pricing");
  const tabs: { key: RuleKind; label: string; version: number }[] = [
    { key: "pricing", label: "Prices", version: pricing.version },
    { key: "schedule", label: "Schedule", version: schedule.version },
    { key: "cancellation", label: "Cancellation", version: cancellation.version },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-white p-0.5 ring-1 ring-zinc-200 sm:inline-flex">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === t.key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {t.label} <span className="opacity-60">v{t.version}</span>
          </button>
        ))}
      </div>
      {!canPublish && (
        <Alert tone="info">
          Only the owner can publish changes. You can try values and see the preview.
        </Alert>
      )}
      {tab === "pricing" && (
        <PricingEditor
          key={pricing.id}
          current={pricing.rules}
          services={services}
          canPublish={canPublish}
        />
      )}
      {tab === "schedule" && (
        <ScheduleEditor key={schedule.id} current={schedule.rules} canPublish={canPublish} />
      )}
      {tab === "cancellation" && (
        <CancellationEditor
          key={cancellation.id}
          current={cancellation.rules}
          canPublish={canPublish}
        />
      )}
    </div>
  );
}

function PublishBar({
  kind,
  draft,
  changed,
  canPublish,
}: {
  kind: RuleKind;
  draft: unknown;
  changed: boolean;
  canPublish: boolean;
}) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  return (
    <Card className="sticky bottom-4 z-10 shadow-lg">
      <CardBody className="flex flex-wrap items-end gap-3">
        <Field label="What changed?" htmlFor={`note-${kind}`} className="min-w-64 flex-1">
          <Input
            id={`note-${kind}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Raised deep clean to $280"
          />
        </Field>
        <Button
          disabled={!canPublish || !changed || pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await publishRulesAction(kind, draft, note);
              setResult({
                ok: outcome.ok,
                text: outcome.message ?? (outcome.ok ? "Published." : "Failed."),
                issues: outcome.ok ? undefined : outcome.issues,
              });
            })
          }
        >
          {pending && <Spinner />}
          Publish new version
        </Button>
        {!changed && <span className="text-sm text-zinc-500">No changes yet</span>}
        {result && (
          <Alert tone={result.ok ? "success" : "danger"} className="w-full">
            {result.text}
            {result.issues && (
              <ul className="mt-1 list-disc pl-5">
                {result.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}

function PricingEditor({
  current,
  services,
  canPublish,
}: {
  current: PricingRules;
  services: { code: string; name: string }[];
  canPublish: boolean;
}) {
  const [draft, setDraft] = useState<PricingRules>(current);
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const update = (fn: (d: PricingRules) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const preview = useMemo(
    () =>
      samples.map((sample) => {
        const before = quote(current, sample.request);
        const after = quote(draft, sample.request);
        const price = (r: typeof before) =>
          r.ok ? (r.quote.recurringVisit ?? r.quote.firstVisit).totalCents : null;
        return { label: sample.label, before: price(before), after: price(after) };
      }),
    [current, draft],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Services"
            description={`Base price covers ${current.included.bedrooms} bedroom, ${current.included.full_baths} bath, up to ${current.included.sqft.toLocaleString("en-US")} sq ft`}
          />
          <CardBody className="space-y-3">
            {services.map((service) =>
              draft.services[service.code] ? (
                <div
                  key={service.code}
                  className="grid grid-cols-[1fr_120px_120px] items-center gap-3"
                >
                  <span className="text-sm font-medium text-zinc-800">{service.name}</span>
                  <MoneyInput
                    label={`${service.name} price`}
                    cents={draft.services[service.code]!.base_cents}
                    onChange={(cents) =>
                      update((d) => void (d.services[service.code]!.base_cents = cents))
                    }
                  />
                  <NumberInput
                    label={`${service.name} minutes`}
                    suffix="min"
                    value={draft.services[service.code]!.base_minutes}
                    onChange={(n) =>
                      update((d) => void (d.services[service.code]!.base_minutes = n))
                    }
                  />
                </div>
              ) : null,
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Home size" />
          <CardBody className="space-y-3">
            {(
              [
                ["bedroom", "Each extra bedroom"],
                ["full_bath", "Each extra full bath"],
                ["half_bath", "Each extra half bath"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid grid-cols-[1fr_120px_120px] items-center gap-3">
                <span className="text-sm text-zinc-800">{label}</span>
                <MoneyInput
                  label={label}
                  cents={draft.home_size[key].cents}
                  onChange={(c) => update((d) => void (d.home_size[key].cents = c))}
                />
                <NumberInput
                  label={`${label} minutes`}
                  suffix="min"
                  value={draft.home_size[key].minutes}
                  onChange={(n) => update((d) => void (d.home_size[key].minutes = n))}
                />
              </div>
            ))}
            <div className="grid grid-cols-[1fr_120px_120px] items-center gap-3">
              <span className="text-sm text-zinc-800">
                Each {draft.home_size.sqft_step.size} sq ft over{" "}
                {draft.included.sqft.toLocaleString("en-US")}
              </span>
              <MoneyInput
                label="Size step price"
                cents={draft.home_size.sqft_step.cents}
                onChange={(c) => update((d) => void (d.home_size.sqft_step.cents = c))}
              />
              <NumberInput
                label="Size step minutes"
                suffix="min"
                value={draft.home_size.sqft_step.minutes}
                onChange={(n) => update((d) => void (d.home_size.sqft_step.minutes = n))}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Extras" />
          <CardBody className="space-y-3">
            {Object.entries(draft.addons).map(([code, addon]) => (
              <div key={code} className="grid grid-cols-[1fr_120px_120px] items-center gap-3">
                <span className="text-sm text-zinc-800">
                  {addon.name}
                  {addon.per_unit && <span className="text-zinc-400"> (each)</span>}
                </span>
                <MoneyInput
                  label={`${addon.name} price`}
                  cents={addon.cents}
                  onChange={(c) => update((d) => void (d.addons[code]!.cents = c))}
                />
                <NumberInput
                  label={`${addon.name} minutes`}
                  suffix="min"
                  value={addon.minutes}
                  onChange={(n) => update((d) => void (d.addons[code]!.minutes = n))}
                />
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Discounts, minimum and deposit" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            {(["weekly", "biweekly", "monthly"] as const).map((f) => (
              <Field
                key={f}
                label={
                  {
                    weekly: "Weekly discount",
                    biweekly: "Every 2 weeks",
                    monthly: "Every 4 weeks",
                  }[f]
                }
              >
                <NumberInput
                  label={`${f} discount`}
                  suffix="%"
                  value={draft.frequency_discount_percent[f]}
                  onChange={(n) => update((d) => void (d.frequency_discount_percent[f] = n))}
                />
              </Field>
            ))}
            <Field label="Heavy condition">
              <NumberInput
                label="Heavy condition surcharge"
                suffix="%"
                value={draft.condition.heavy.percent}
                onChange={(n) => update((d) => void (d.condition.heavy.percent = n))}
              />
            </Field>
            <Field label="Minimum per visit">
              <MoneyInput
                label="Minimum per visit"
                cents={draft.minimum_cents}
                onChange={(c) => update((d) => void (d.minimum_cents = c))}
              />
            </Field>
            <Field label="Deposit">
              <NumberInput
                label="Deposit percent"
                suffix="%"
                value={draft.deposit.percent}
                onChange={(n) => update((d) => void (d.deposit.percent = n))}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Service area" description="Travel fee per zone" />
          <CardBody className="space-y-3">
            {draft.zones.map((zone, index) => (
              <div key={zone.code} className="grid grid-cols-[1fr_120px] items-start gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-800">
                    Zone {zone.code}: {zone.name}
                  </p>
                  <p className="tabular text-xs text-zinc-500">{zone.zips.join(", ")}</p>
                </div>
                <MoneyInput
                  label={`Zone ${zone.code} travel fee`}
                  cents={zone.surcharge_cents}
                  onChange={(c) => update((d) => void (d.zones[index]!.surcharge_cents = c))}
                />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader title="Preview" description="The same quote() the booking page uses" />
          <ul className="divide-y divide-zinc-100 text-sm">
            {preview.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="text-zinc-700">{row.label}</span>
                <span className="tabular flex items-center gap-2 whitespace-nowrap">
                  {row.before !== row.after && row.before !== null && (
                    <span className="text-zinc-400 line-through">{formatMoney(row.before)}</span>
                  )}
                  <span
                    className={cn(
                      "font-semibold",
                      row.before !== row.after ? "text-brand-700" : "text-zinc-900",
                    )}
                  >
                    {row.after === null ? "—" : formatMoney(row.after)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <PublishBar kind="pricing" draft={draft} changed={changed} canPublish={canPublish} />
      </div>
    </div>
  );
}

function ScheduleEditor({ current, canPublish }: { current: ScheduleRules; canPublish: boolean }) {
  const [draft, setDraft] = useState<ScheduleRules>(current);
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const update = (fn: (d: ScheduleRules) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const [newDate, setNewDate] = useState("");

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Opening hours" description="Visits must finish by closing time" />
          <CardBody className="space-y-2">
            {weekdays.map((day) => {
              const hours = draft.business_hours[day];
              return (
                <div
                  key={day}
                  className="grid grid-cols-[60px_1fr_1fr_auto] items-center gap-2 text-sm"
                >
                  <span className="font-medium capitalize text-zinc-800">{day}</span>
                  {hours ? (
                    <>
                      <Input
                        type="time"
                        aria-label={`${day} open`}
                        value={hours[0]}
                        onChange={(e) =>
                          update((d) => void (d.business_hours[day] = [e.target.value, hours[1]]))
                        }
                      />
                      <Input
                        type="time"
                        aria-label={`${day} close`}
                        value={hours[1]}
                        onChange={(e) =>
                          update((d) => void (d.business_hours[day] = [hours[0], e.target.value]))
                        }
                      />
                      <button
                        type="button"
                        className="text-xs text-zinc-500 underline"
                        onClick={() => update((d) => void (d.business_hours[day] = null))}
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="col-span-2 text-zinc-400">Closed</span>
                      <button
                        type="button"
                        className="text-xs text-brand-700 underline"
                        onClick={() =>
                          update((d) => void (d.business_hours[day] = ["08:00", "18:00"]))
                        }
                      >
                        Open
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Booking" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Travel buffer between jobs">
              <NumberInput
                label="Travel buffer"
                suffix="min"
                value={draft.travel_buffer_minutes}
                onChange={(n) => update((d) => void (d.travel_buffer_minutes = n))}
              />
            </Field>
            <Field label="Book up to">
              <NumberInput
                label="Booking horizon"
                suffix="days"
                value={draft.horizon_days}
                onChange={(n) => update((d) => void (d.horizon_days = n))}
              />
            </Field>
            <Field
              label="Next-day cutoff"
              hint="After this time, the earliest date is the day after tomorrow"
            >
              <Input
                type="time"
                value={draft.next_day_cutoff}
                onChange={(e) => update((d) => void (d.next_day_cutoff = e.target.value))}
              />
            </Field>
            <Field label="Hold a window while booking">
              <NumberInput
                label="Hold minutes"
                suffix="min"
                value={draft.hold_minutes}
                onChange={(n) => update((d) => void (d.hold_minutes = n))}
              />
            </Field>
            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-zinc-800">Arrival windows</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {draft.arrival_windows.map(([start, end], index) => (
                  <span key={index} className="flex items-center gap-1">
                    <Input
                      type="time"
                      className="w-28"
                      aria-label="Window start"
                      value={start}
                      onChange={(e) =>
                        update((d) => void (d.arrival_windows[index] = [e.target.value, end]))
                      }
                    />
                    <span className="text-zinc-400">–</span>
                    <Input
                      type="time"
                      className="w-28"
                      aria-label="Window end"
                      value={end}
                      onChange={(e) =>
                        update((d) => void (d.arrival_windows[index] = [start, e.target.value]))
                      }
                    />
                  </span>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Closed dates"
          description="Holidays: no bookings, regular visits skip them"
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {draft.closed_dates.map((date) => (
              <Badge key={date}>
                {date}
                <button
                  type="button"
                  aria-label={`Remove ${date}`}
                  className="ml-1 text-zinc-400 hover:text-red-600"
                  onClick={() =>
                    update((d) => void (d.closed_dates = d.closed_dates.filter((x) => x !== date)))
                  }
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              className="w-48"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              aria-label="New closed date"
            />
            <Button
              variant="secondary"
              disabled={!newDate || draft.closed_dates.includes(newDate)}
              onClick={() => {
                update((d) => void (d.closed_dates = [...d.closed_dates, newDate].sort()));
                setNewDate("");
              }}
            >
              Add
            </Button>
          </div>
        </CardBody>
      </Card>
      <PublishBar kind="schedule" draft={draft} changed={changed} canPublish={canPublish} />
    </div>
  );
}

function CancellationEditor({
  current,
  canPublish,
}: {
  current: CancellationRules;
  canPublish: boolean;
}) {
  const [draft, setDraft] = useState<CancellationRules>(current);
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const update = (fn: (d: CancellationRules) => void) =>
    setDraft((d) => {
      const next = { ...d };
      fn(next);
      return next;
    });
  const visit = 25500;
  // A fixed reference point keeps the preview pure: hours before an arrival at a fixed instant.
  const arrival = "2030-01-01T12:00:00Z";
  const at = (hours: number) => new Date(Date.parse(arrival) - hours * 3600_000).toISOString();

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Cancelling and rescheduling" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Free up to" hint="Hours before the arrival window">
            <NumberInput
              label="Free cancellation hours"
              suffix="h"
              value={draft.free_before_hours}
              onChange={(n) => update((d) => void (d.free_before_hours = n))}
            />
          </Field>
          <Field label="Flat fee inside that period">
            <MoneyInput
              label="Flat fee"
              cents={draft.flat_fee_cents}
              onChange={(c) => update((d) => void (d.flat_fee_cents = c))}
            />
          </Field>
          <Field label="Late period" hint="Hours before the arrival window">
            <NumberInput
              label="Late period hours"
              suffix="h"
              value={draft.late_within_hours}
              onChange={(n) => update((d) => void (d.late_within_hours = n))}
            />
          </Field>
          <Field label="Late fee">
            <NumberInput
              label="Late fee percent"
              suffix="%"
              value={draft.late_fee_percent}
              onChange={(n) => update((d) => void (d.late_fee_percent = n))}
            />
          </Field>
          <Field label="Lockout (no access) fee">
            <NumberInput
              label="Lockout fee percent"
              suffix="%"
              value={draft.no_access_fee_percent}
              onChange={(n) => update((d) => void (d.no_access_fee_percent = n))}
            />
          </Field>
        </CardBody>
      </Card>
      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader title="Preview" description={`For a ${formatMoney(visit)} visit`} />
          <ul className="divide-y divide-zinc-100 text-sm">
            {[
              ["3 days before", 72, "cancel"],
              ["30 hours before", 30, "cancel"],
              ["12 hours before", 12, "cancel"],
              ["Crew locked out", 0, "no_access"],
            ].map(([label, hours, reason]) => {
              const fee = (rules: CancellationRules) =>
                cancellationFee(
                  rules,
                  { totalCents: visit, arrivalStart: arrival },
                  reason as "cancel",
                  at(hours as number),
                ).feeCents;
              const before = fee(current);
              const after = fee(draft);
              return (
                <li key={label as string} className="flex justify-between gap-3 px-5 py-2.5">
                  <span className="text-zinc-700">{label}</span>
                  <span className="tabular flex gap-2">
                    {before !== after && (
                      <span className="text-zinc-400 line-through">{formatMoney(before)}</span>
                    )}
                    <span
                      className={cn(
                        "font-semibold",
                        before !== after ? "text-brand-700" : "text-zinc-900",
                      )}
                    >
                      {after === 0 ? "Free" : formatMoney(after)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
        <PublishBar kind="cancellation" draft={draft} changed={changed} canPublish={canPublish} />
      </div>
    </div>
  );
}
