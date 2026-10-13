"use client";

import type { QuoteInput, QuoteResult, VisitPrice } from "@/domain/quote";
import type { Hold } from "@/server/booking/hold";
import { Card } from "@/ui/card";
import { Badge } from "@/ui/feedback";
import { formatDate, formatDuration, formatMoney, formatWindow } from "@/ui/format";

import type { WizardContext } from "./booking-wizard";

export function QuoteSummary({
  context,
  request,
  priced,
  hold,
}: {
  context: WizardContext;
  request: QuoteInput;
  priced: QuoteResult | null;
  hold: Hold | null;
}) {
  const money = (cents: number) => formatMoney(cents, context.currency);
  const serviceName = (code: string) => context.services.find((s) => s.code === code)?.name ?? code;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Your price</p>
        <p className="mt-1 font-semibold text-zinc-900">{serviceName(request.service)}</p>
        <p className="text-sm text-zinc-500">
          {request.home.bedrooms} bed · {request.home.fullBaths} bath
          {request.home.halfBaths > 0 && ` · ${request.home.halfBaths} half bath`}
          {request.home.sqft !== null && ` · ${request.home.sqft.toLocaleString("en-US")} sq ft`}
        </p>
        {hold && (
          <p className="mt-2 text-sm font-medium text-brand-800">
            {formatDate(hold.date)}, {formatWindow(hold.localStart, hold.localEnd)}
          </p>
        )}
      </div>

      {!priced ? (
        <p className="px-5 py-6 text-sm text-zinc-500">Enter your ZIP code to see the price.</p>
      ) : !priced.ok ? (
        <p className="px-5 py-6 text-sm text-zinc-600">{priced.error.message}</p>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <Visit
            title={priced.quote.recurringVisit ? "First visit" : undefined}
            visit={priced.quote.firstVisit}
            serviceName={serviceName(priced.quote.firstVisit.service)}
            money={money}
          />
          {priced.quote.recurringVisit && (
            <Visit
              title="Each regular visit after that"
              visit={priced.quote.recurringVisit}
              serviceName={serviceName(priced.quote.recurringVisit.service)}
              money={money}
            />
          )}

          <div className="rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-900">
            {priced.quote.depositCents > 0 ? (
              <>
                <span className="font-semibold">{money(priced.quote.depositCents)} deposit</span>{" "}
                today; the rest after the visit.
              </>
            ) : (
              <>Nothing to pay today. We save your card and charge after each visit.</>
            )}
          </div>

          {priced.quote.needsReview && (
            <Badge tone="warning">The office confirms the price after seeing photos</Badge>
          )}
          {priced.quote.notes
            .filter((note) => !note.startsWith("Heavy"))
            .map((note) => (
              <p key={note} className="text-xs text-zinc-500">
                {note}
              </p>
            ))}
          <p className="text-xs text-zinc-500">
            Free changes up to 48 hours before your arrival window.
          </p>
        </div>
      )}
    </Card>
  );
}

function Visit({
  title,
  visit,
  serviceName,
  money,
}: {
  title?: string;
  visit: VisitPrice;
  serviceName: string;
  money: (cents: number) => string;
}) {
  return (
    <div>
      {title && (
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title} · {serviceName}
        </p>
      )}
      <ul className="space-y-1 text-sm">
        {visit.lines.map((line) => (
          <li key={line.code} className="flex justify-between gap-3">
            <span className="text-zinc-600">
              {line.label}
              {line.quantity && line.quantity > 1 ? ` × ${line.quantity}` : ""}
            </span>
            <span className="tabular whitespace-nowrap text-zinc-800">{money(line.cents)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-zinc-100 pt-2">
        <span className="text-sm text-zinc-500">about {formatDuration(visit.durationMinutes)}</span>
        <span className="tabular text-lg font-semibold text-zinc-900">
          {money(visit.totalCents)}
        </span>
      </div>
    </div>
  );
}
