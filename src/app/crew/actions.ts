"use server";

import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { requireCleaner } from "@/server/auth/viewer";
import { completeJob, markNoAccess } from "@/server/booking/jobs";
import { CommandError } from "@/server/db/errors";
import { sendSoon } from "@/server/notifications/sender";

/**
 * Crew app actions. The database checks that the cleaner belongs to the booking's crew; photos were uploaded
 * by the browser straight to storage, where the bucket's policies allowed it only under this job. On success they
 * redirect back to the job with the outcome in `?done=`: the page then shows the report instead of the form, and
 * the outcome above it.
 */

const inputSchema = z.object({
  bookingId: z.uuid(),
  checklist: z.array(z.object({ item: z.string().max(200), done: z.boolean() })).max(30),
  notes: z.string().max(2000),
  photoPaths: z.array(z.string().max(300)).max(12),
});

export async function completeJobAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: false; message: string }> {
  const viewer = await requireCleaner();
  const parsed = inputSchema.parse(input);
  let outcome: "charged" | "payment_pending";
  try {
    const { charge } = await completeJob({ ...parsed, actorUserId: viewer.userId });
    outcome = charge.status === "succeeded" ? "charged" : "payment_pending";
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
  sendSoon();
  redirect(`/crew/jobs/${parsed.bookingId}?done=${outcome}`, RedirectType.replace);
}

export async function noAccessAction(
  bookingId: string,
  note: string,
): Promise<{ ok: false; message: string }> {
  const viewer = await requireCleaner();
  const id = z.uuid().parse(bookingId);
  try {
    await markNoAccess({ bookingId: id, actorUserId: viewer.userId, note });
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
  sendSoon();
  redirect(`/crew/jobs/${id}?done=no_access`, RedirectType.replace);
}
