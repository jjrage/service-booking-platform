import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import type { QuoteLine } from "@/domain/quote";
import { bookingDetail } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { BookingStatus, paymentPurpose } from "@/ui/booking-status";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatDate, formatDuration, formatInstant, formatMoney, formatWindow } from "@/ui/format";

import { BookingAdminActions, RefundButton } from "./booking-actions";

export const metadata: Metadata = { title: "Booking" };

export default function AdminBookingPage({ params }: PageProps<"/admin/bookings/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <AdminBooking params={params} />
    </Suspense>
  );
}

const eventLabel: Record<string, string> = {
  created: "Booked",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  reassigned: "Reassigned",
  cancelled: "Cancelled",
  completed: "Completed",
  no_access: "No access",
  expired: "Expired",
  payment_failed: "Payment failed",
  payment_received: "Payment received",
  refund_issued: "Refund issued",
  fee_charged: "Fee charged",
};

const actorLabel: Record<string, string> = {
  guest: "guest",
  client: "client",
  staff: "office",
  crew: "crew",
  ai: "AI assistant",
  system: "system",
};

async function AdminBooking({ params }: Pick<PageProps<"/admin/bookings/[id]">, "params">) {
  const { id } = await params;
  const { staff } = await requireStaff(`/admin/bookings/${id}`);
  const detail = /^[0-9a-f-]{36}$/.test(id) ? await bookingDetail(staff, id) : null;
  if (!detail) notFound();
  const { booking, payments, events, report, photoUrls, crews } = detail;
  const money = (cents: number) => formatMoney(cents, booking.currency);
  const quote = booking.quote as {
    firstVisit?: { totalCents: number; lines: QuoteLine[] };
    recurringVisit?: { totalCents: number; lines: QuoteLine[] } | null;
    notes?: string[];
  };
  const priced =
    quote.firstVisit?.totalCents === booking.total_cents
      ? quote.firstVisit
      : quote.recurringVisit?.totalCents === booking.total_cents
        ? quote.recurringVisit
        : null;
  const property = booking.property;
  const active = ["confirmed", "pending_payment"].includes(booking.status);

  return (
    <div className="space-y-6">
      <Link href="/admin/calendar" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← Calendar
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            Booking #{booking.number} · {booking.service.name}
            {booking.recurring_plan_id && (
              <Badge tone="brand" className="ml-2">
                Regular plan
              </Badge>
            )}
            {booking.source === "ai" && (
              <Badge tone="info" className="ml-2">
                Booked by AI
              </Badge>
            )}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
            {formatDate(detail.date, "long")}, {formatWindow(detail.localStart, detail.localEnd)}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-zinc-600">
            <span className="size-2.5 rounded-full" style={{ background: booking.crew.color }} />
            {booking.crew.name} · about {formatDuration(booking.duration_minutes)}
          </p>
        </div>
        <BookingStatus status={booking.status} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {active && (
            <BookingAdminActions
              bookingId={booking.id}
              crewId={booking.crew_id}
              crews={crews}
              currency={booking.currency}
              date={detail.date}
              canFinish={detail.canFinish}
            />
          )}

          <Card>
            <CardHeader
              title="Price"
              description={`Quoted with pricing rules v${(booking.quote as { rules?: { pricing?: number } }).rules?.pricing ?? "?"}`}
            />
            <CardBody>
              {priced ? (
                <ul className="space-y-1 text-sm">
                  {priced.lines.map((line) => (
                    <li key={line.code} className="flex justify-between gap-3">
                      <span className="text-zinc-600">
                        {line.label}
                        {line.quantity && line.quantity > 1 ? ` × ${line.quantity}` : ""}
                      </span>
                      <span className="tabular text-zinc-800">{money(line.cents)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex justify-between border-t border-zinc-100 pt-3 font-semibold">
                <span>Total</span>
                <span className="tabular">{money(booking.total_cents)}</span>
              </div>
              {booking.deposit_cents > 0 && (
                <p className="mt-1 text-right text-sm text-zinc-500">
                  Deposit {money(booking.deposit_cents)}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payments" />
            {payments.filter((p) => p.purpose !== "card_setup").length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {payments
                  .filter((p) => p.purpose !== "card_setup")
                  .map((p) => {
                    const refunded = p.refunds
                      .filter((r) => r.status !== "failed")
                      .reduce((sum, r) => sum + r.amount_cents, 0);
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                      >
                        <div>
                          <p className="font-medium text-zinc-900">
                            {paymentPurpose(p.purpose)}{" "}
                            <span className="font-normal text-zinc-500">
                              · {p.off_session ? "saved card" : "checkout"} · {p.provider}
                            </span>
                          </p>
                          <p className="text-xs text-zinc-500">
                            {formatInstant(p.succeeded_at ?? p.created_at, staff.timezone)}
                            {p.failure_code && ` · ${p.failure_code}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {refunded > 0 && <Badge tone="info">{money(refunded)} refunded</Badge>}
                          <Badge
                            tone={
                              p.status === "succeeded"
                                ? "success"
                                : p.status === "failed"
                                  ? "danger"
                                  : "warning"
                            }
                          >
                            {p.status}
                          </Badge>
                          <span className="tabular font-medium">{money(p.amount_cents)}</span>
                          {p.status === "succeeded" && p.amount_cents - refunded > 0 && (
                            <RefundButton
                              paymentId={p.id}
                              maxCents={p.amount_cents - refunded}
                              currency={booking.currency}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Card>

          {(report || photoUrls.length > 0) && (
            <Card>
              <CardHeader
                title="Job report"
                description={
                  report ? formatInstant(report.completed_at, staff.timezone) : undefined
                }
              />
              <CardBody className="space-y-3 text-sm">
                {report?.notes && <p className="text-zinc-700">{report.notes}</p>}
                {Array.isArray(report?.checklist) && report.checklist.length > 0 && (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {(report.checklist as { item: string; done: boolean }[]).map((c) => (
                      <li
                        key={c.item}
                        className={c.done ? "text-zinc-700" : "text-zinc-400 line-through"}
                      >
                        {c.done ? "✓" : "–"} {c.item}
                      </li>
                    ))}
                  </ul>
                )}
                {photoUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {photoUrls.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs
                      <img
                        key={url}
                        src={url}
                        alt="Job photo"
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Client" />
            <CardBody className="space-y-1 text-sm">
              <Link
                href={`/admin/clients/${booking.client.id}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {booking.client.full_name}
              </Link>
              <p className="text-zinc-600">{booking.client.email}</p>
              <p className="text-zinc-600">{booking.client.phone}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Home" />
            <CardBody className="space-y-3 text-sm">
              <p className="font-medium text-zinc-900">
                {property.address_line1}
                {property.address_line2 && `, ${property.address_line2}`}
                <br />
                {property.city}, {property.state} {property.zip}
              </p>
              <p className="text-zinc-600">
                {property.bedrooms} bed · {property.full_baths} bath
                {property.half_baths ? ` · ${property.half_baths} half` : ""}
                {property.sqft ? ` · ${property.sqft.toLocaleString("en-US")} sq ft` : ""}
              </p>
              {property.access_notes && (
                <p>
                  <span className="text-zinc-500">Access:</span> {property.access_notes}
                </p>
              )}
              {property.has_pets && (
                <p>
                  <span className="text-zinc-500">Pets:</span> {property.pet_notes || "Yes"}
                </p>
              )}
              {property.parking_notes && (
                <p>
                  <span className="text-zinc-500">Parking:</span> {property.parking_notes}
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 px-5 py-4 text-sm">
              {events.map((event) => {
                const data = event.data as Record<string, unknown>;
                const amount =
                  typeof data.amount_cents === "number"
                    ? data.amount_cents
                    : typeof data.fee_cents === "number" && data.fee_cents > 0
                      ? data.fee_cents
                      : null;
                return (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-zinc-300" />
                    <div>
                      <p className="text-zinc-800">
                        <span className="font-medium">
                          {eventLabel[event.event] ?? event.event}
                        </span>{" "}
                        <span className="text-zinc-500">by {actorLabel[event.actor_kind]}</span>
                        {amount !== null && (
                          <span className="tabular text-zinc-700"> · {money(amount)}</span>
                        )}
                      </p>
                      {typeof data.reason === "string" && (
                        <p className="text-xs text-zinc-500">{data.reason}</p>
                      )}
                      {typeof data.failure_code === "string" && (
                        <p className="text-xs text-red-600">{data.failure_code}</p>
                      )}
                      <p className="text-xs text-zinc-400">
                        {formatInstant(event.created_at, staff.timezone)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
