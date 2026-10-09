import type { Metadata } from "next";
import { Suspense } from "react";

import { loadGuestBooking } from "@/server/booking/view";
import { bookingAccessToken, verifyBookingAccessToken } from "@/server/signing";
import { AutoRefresh } from "@/ui/auto-refresh";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Alert, Badge, Skeleton, Spinner } from "@/ui/feedback";
import {
  cardLabel,
  formatDate,
  formatDuration,
  formatMoney,
  formatWindow,
} from "@/ui/format";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false },
};

export default function BookingPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/bookings/[bookingId]">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <BookingDetails params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const statusTone = {
  pending_payment: "warning",
  confirmed: "success",
  completed: "success",
  no_access: "danger",
  cancelled: "neutral",
  expired: "neutral",
} as const;

const statusText: Record<string, string> = {
  pending_payment: "Waiting for payment",
  confirmed: "Confirmed",
  completed: "Completed",
  no_access: "Crew could not get in",
  cancelled: "Cancelled",
  expired: "Expired",
};

async function BookingDetails({
  params,
  searchParams,
}: Pick<
  PageProps<"/[tenant]/bookings/[bookingId]">,
  "params" | "searchParams"
>) {
  const { tenant, bookingId } = await params;
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : undefined;
  const booking =
    /^[0-9a-f-]{36}$/.test(bookingId) &&
    verifyBookingAccessToken(bookingId, token)
      ? await loadGuestBooking(bookingId)
      : null;
  if (!booking || booking.tenantSlug !== tenant) {
    return <Alert tone="danger" title="This booking link is not valid." />;
  }

  const money = (cents: number) => formatMoney(cents, booking.currency);
  const plan = booking.frequency !== "one_time";
  const justBooked = booking.status === "confirmed";
  const waiting = booking.status === "pending_payment";

  return (
    <div className="space-y-6">
      {waiting && <AutoRefresh />}
      <div className="text-center">
        {justBooked ? (
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
            ✓
          </div>
        ) : waiting ? (
          <Spinner className="size-8 text-brand-700" />
        ) : null}
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">
          {justBooked
            ? "You're booked!"
            : waiting
              ? "Confirming your payment…"
              : `Booking #${booking.number}`}
        </h1>
        {justBooked && (
          <p className="mt-2 text-zinc-600">
            A confirmation is on its way to{" "}
            <strong>{booking.clientEmail}</strong>.
          </p>
        )}
        {waiting && (
          <p className="mt-2 text-zinc-600">
            This takes a few seconds.{" "}
            <a
              className="font-medium text-brand-700 underline"
              href={`/${tenant}/pay/${booking.id}?t=${bookingAccessToken(booking.id)}`}
            >
              Back to payment
            </a>
          </p>
        )}
      </div>

      <Card className="divide-y divide-zinc-100">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Booking #{booking.number}
            </p>
            <p className="mt-1 font-semibold text-zinc-900">
              {booking.serviceName}
            </p>
          </div>
          <Badge
            tone={
              statusTone[booking.status as keyof typeof statusTone] ?? "neutral"
            }
          >
            {statusText[booking.status] ?? booking.status}
          </Badge>
        </div>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">When</dt>
            <dd className="mt-0.5 font-medium text-zinc-900">
              {formatDate(booking.date, "long")}
              <br />
              Arrival {formatWindow(booking.localStart, booking.localEnd)}
            </dd>
            <dd className="text-zinc-500">
              About {formatDuration(booking.durationMinutes)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Where</dt>
            <dd className="mt-0.5 font-medium text-zinc-900">
              {booking.address}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Price</dt>
            <dd className="tabular mt-0.5 font-medium text-zinc-900">
              {money(booking.totalCents)}
              {plan && booking.recurringTotalCents !== null && (
                <span className="block font-normal text-zinc-500">
                  then {money(booking.recurringTotalCents)} per regular visit
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Paid</dt>
            <dd className="tabular mt-0.5 font-medium text-zinc-900">
              {money(booking.paidCents)}
              {booking.card && (
                <span className="block font-normal text-zinc-500">
                  {cardLabel(booking.card)} saved
                </span>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {justBooked && (
        <Card className="p-5 text-sm text-zinc-600">
          <p className="font-medium text-zinc-900">What happens next</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              We e-mail you 3 days before the visit to check how the crew gets
              in.
            </li>
            <li>A reminder comes the day before.</li>
            <li>
              {plan
                ? "Your card is charged after each visit."
                : `The remaining ${money(booking.totalCents - booking.paidCents)} is charged after the visit.`}
            </li>
            <li>
              Reschedule or cancel for free up to 48 hours before your arrival
              window.
            </li>
          </ul>
          <ButtonLink
            href="/portal"
            variant="secondary"
            size="sm"
            className="mt-4"
          >
            Manage your booking
          </ButtonLink>
        </Card>
      )}
    </div>
  );
}
