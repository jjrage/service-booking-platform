import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requireCleaner } from "@/server/auth/viewer";
import { crewJob } from "@/server/crew";
import { BookingStatus } from "@/ui/booking-status";
import { Card, CardBody, CardHeader } from "@/ui/card";
import { Alert, Skeleton } from "@/ui/feedback";
import { formatDate, formatDuration, formatWindow } from "@/ui/format";

import { FinishJob } from "./finish-job";

export const metadata: Metadata = { title: "Job" };

export default function JobPage({ params }: PageProps<"/crew/jobs/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Job params={params} />
    </Suspense>
  );
}

async function Job({ params }: Pick<PageProps<"/crew/jobs/[id]">, "params">) {
  const { id } = await params;
  const viewer = await requireCleaner(`/crew/jobs/${id}`);
  const job = /^[0-9a-f-]{36}$/.test(id) ? await crewJob(viewer.staff, id) : null;
  if (!job) notFound();
  const p = job.property;
  const mapQuery = p
    ? encodeURIComponent(`${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`)
    : null;

  return (
    <div className="space-y-4">
      <Link href="/crew" className="text-sm text-zinc-500">
        ← All jobs
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500">
            #{job.number} · {formatDate(job.date, "long")}
          </p>
          <h1 className="text-xl font-semibold text-zinc-900">
            {formatWindow(job.localStart, job.localEnd)} · {job.serviceName}
          </h1>
          <p className="text-sm text-zinc-600">About {formatDuration(job.durationMinutes)}</p>
        </div>
        <BookingStatus status={job.status} />
      </div>

      {p ? (
        <Card>
          <CardBody className="space-y-3 text-sm">
            <div>
              <p className="font-semibold text-zinc-900">{job.client?.full_name}</p>
              {job.client?.phone && (
                <a href={`tel:${job.client.phone}`} className="text-brand-700 underline">
                  {job.client.phone}
                </a>
              )}
            </div>
            <div>
              <p className="text-zinc-900">
                {p.address_line1}
                {p.address_line2 && `, ${p.address_line2}`}, {p.city}
              </p>
              {mapQuery && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 underline"
                >
                  Open in Maps
                </a>
              )}
            </div>
            <p className="text-zinc-600">
              {p.bedrooms} bed · {p.full_baths} bath{p.half_baths ? ` · ${p.half_baths} half` : ""}
              {p.sqft ? ` · ${p.sqft.toLocaleString("en-US")} sq ft` : ""}
            </p>
            {p.access_notes && (
              <Alert tone="info" title="Getting in">
                {p.access_notes}
              </Alert>
            )}
            {p.has_pets && (
              <Alert tone="warning" title="Pets">
                {p.pet_notes || "There are pets in the home."}
              </Alert>
            )}
            {p.parking_notes && <p className="text-zinc-600">Parking: {p.parking_notes}</p>}
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">The address and access notes appear closer to the day of the job.</Alert>
      )}

      {job.extras.length > 0 && (
        <Card>
          <CardHeader title="Extras on this job" />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
              {job.extras.map((extra) => (
                <li key={extra}>{extra}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {job.status === "confirmed" ? (
        <FinishJob
          bookingId={job.id}
          tenantId={job.tenantId}
          checklist={job.checklist}
          canFinish={job.canFinish}
        />
      ) : (
        <Card>
          <CardHeader title="Report" />
          <CardBody className="space-y-3 text-sm">
            {job.report?.notes && <p className="text-zinc-700">{job.report.notes}</p>}
            {job.photoUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {job.photoUrls.map((url) => (
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
  );
}
