import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { publicEnv } from "@/config/public-env";
import { startBookingCheckout } from "@/server/payments/service";
import { loadGuestBooking } from "@/server/booking/view";
import { bookingAccessToken, verifyBookingAccessToken } from "@/server/signing";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Alert, Skeleton } from "@/ui/feedback";
import { formatDate, formatMoney, formatWindow } from "@/ui/format";

import { PaymentForm } from "./payment-form";

export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false },
};

export default function PayPage({ params, searchParams }: PageProps<"/[tenant]/pay/[bookingId]">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Checkout params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Checkout({
  params,
  searchParams,
}: Pick<PageProps<"/[tenant]/pay/[bookingId]">, "params" | "searchParams">) {
  const { tenant, bookingId } = await params;
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : undefined;

  const booking =
    /^[0-9a-f-]{36}$/.test(bookingId) && verifyBookingAccessToken(bookingId, token)
      ? await loadGuestBooking(bookingId)
      : null;
  if (!booking || booking.tenantSlug !== tenant) {
    return <Alert tone="danger" title="This payment link is not valid." />;
  }

  const bookingUrl = `/${tenant}/bookings/${booking.id}?t=${bookingAccessToken(booking.id)}`;
  if (booking.status !== "pending_payment") {
    if (booking.status === "expired") {
      return (
        <Alert tone="warning" title="This booking expired">
          <p>The deposit was not paid in time, so the window was released.</p>
          <ButtonLink href={`/${tenant}/book`} size="sm" className="mt-3">
            Book again
          </ButtonLink>
        </Alert>
      );
    }
    redirect(bookingUrl);
  }

  const session = await startBookingCheckout(booking.id);
  const money = (cents: number) => formatMoney(cents, booking.currency);
  const plan = booking.frequency !== "one_time";

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {plan ? "Save your card" : `Pay the ${money(booking.depositCents)} deposit`}
          </h1>
          <p className="mt-1 text-zinc-600">
            {plan
              ? "Nothing is charged today. We charge your card after each visit."
              : "Your deposit secures the crew. The rest is charged after the visit."}
          </p>
        </div>
        <PaymentForm
          slug={tenant}
          bookingId={booking.id}
          token={token!}
          session={session}
          stripePublishableKey={publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
          amountLabel={plan ? "Save card" : `Pay ${money(booking.depositCents)}`}
          returnUrl={bookingUrl}
          paymentDueBy={booking.paymentDueBy}
        />
      </div>

      <Card className="self-start p-5 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Booking #{booking.number}
        </p>
        <p className="mt-2 font-semibold text-zinc-900">{booking.serviceName}</p>
        <p className="text-zinc-600">
          {formatDate(booking.date, "long")}
          <br />
          Arrival {formatWindow(booking.localStart, booking.localEnd)}
        </p>
        <p className="mt-3 text-zinc-600">{booking.address}</p>
        <dl className="mt-4 space-y-1 border-t border-zinc-100 pt-3">
          <div className="flex justify-between">
            <dt className="text-zinc-500">{plan ? "First visit" : "Visit total"}</dt>
            <dd className="tabular font-medium">{money(booking.totalCents)}</dd>
          </div>
          {plan && booking.recurringTotalCents !== null && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Regular visits</dt>
              <dd className="tabular font-medium">{money(booking.recurringTotalCents)}</dd>
            </div>
          )}
          {!plan && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Due today</dt>
              <dd className="tabular font-semibold text-zinc-900">{money(booking.depositCents)}</dd>
            </div>
          )}
        </dl>
      </Card>
    </div>
  );
}
