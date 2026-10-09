import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { frequencyLabel } from "@/domain/quote";
import type { Frequency } from "@/domain/rules";
import { clientDetail } from "@/server/admin";
import { requireStaff } from "@/server/auth/viewer";
import { BookingStatus } from "@/ui/booking-status";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { cardLabel, formatDate, formatInstant, formatMoney, formatWindow } from "@/ui/format";

import { NoteForm } from "./note-form";

export const metadata: Metadata = { title: "Client" };

export default function ClientPage({ params }: PageProps<"/admin/clients/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Client params={params} />
    </Suspense>
  );
}

async function Client({ params }: Pick<PageProps<"/admin/clients/[id]">, "params">) {
  const { id } = await params;
  const { staff } = await requireStaff(`/admin/clients/${id}`);
  const detail = /^[0-9a-f-]{36}$/.test(id) ? await clientDetail(staff, id) : null;
  if (!detail) notFound();
  const { client, homes, notes, bookings, plans, card } = detail;
  const completed = bookings.filter((b) => b.status === "completed");

  return (
    <div className="space-y-6">
      <Link href="/admin/clients" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← Clients
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {client.full_name}
          </h1>
          <p className="mt-1 text-zinc-600">
            {client.email} · {client.phone} · client since{" "}
            {formatInstant(client.created_at, staff.timezone, { month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>{client.source}</Badge>
          {client.user_id && <Badge tone="success">Portal account</Badge>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Completed visits", String(completed.length)],
          ["Lifetime value", formatMoney(completed.reduce((s, b) => s + b.total_cents, 0))],
          [
            "Saved card",
            card?.card_last4
              ? cardLabel({ brand: card.card_brand ?? "card", last4: card.card_last4 })
              : "None",
          ],
        ].map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Visits" />
            <ul className="divide-y divide-zinc-100 text-sm">
              {bookings.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-zinc-50"
                  >
                    <span>
                      <span className="font-medium text-zinc-900">{formatDate(b.date)}</span>{" "}
                      <span className="text-zinc-500">
                        #{b.number} · {b.service.name} · {b.source}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular text-zinc-700">{formatMoney(b.total_cents)}</span>
                      <BookingStatus status={b.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Office notes" description="Only staff see these." />
            <CardBody className="space-y-3">
              <NoteForm clientId={client.id} />
              <ul className="space-y-3 text-sm">
                {notes.map((note) => (
                  <li key={note.id} className="rounded-lg bg-amber-50 px-3 py-2 text-zinc-800">
                    {note.body}
                    <span className="mt-1 block text-xs text-zinc-500">
                      {formatInstant(note.created_at, staff.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader
                title="Regular plan"
                action={
                  <Badge tone={plan.status === "active" ? "success" : "warning"}>
                    {plan.status}
                  </Badge>
                }
              />
              <CardBody className="text-sm text-zinc-700">
                {frequencyLabel(plan.frequency as Frequency)},{" "}
                {formatWindow(
                  plan.window_start_local.slice(0, 5),
                  plan.window_end_local.slice(0, 5),
                )}{" "}
                · {formatMoney(plan.price_cents)} per visit
              </CardBody>
            </Card>
          ))}

          {homes.map((home) => (
            <Card key={home.id}>
              <CardHeader
                title={home.address_line1}
                description={`${home.city}, ${home.state} ${home.zip}`}
              />
              <CardBody className="space-y-1 text-sm text-zinc-700">
                <p>
                  {home.bedrooms} bed · {home.full_baths} bath
                  {home.half_baths ? ` · ${home.half_baths} half` : ""}
                  {home.sqft ? ` · ${home.sqft.toLocaleString("en-US")} sq ft` : ""}
                </p>
                {home.access_notes && <p>Access: {home.access_notes}</p>}
                {home.has_pets && <p>Pets: {home.pet_notes || "yes"}</p>}
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
