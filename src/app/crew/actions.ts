"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireCleaner } from "@/server/auth/viewer";
import { completeJob, markNoAccess } from "@/server/booking/jobs";
import { CommandError } from "@/server/db/errors";
import { sendSoon } from "@/server/notifications/sender";

/**
 * Crew app actions. The database checks that the cleaner belongs to the booking's crew; photos were uploaded
 * by the browser straight to storage, where the bucket's policies allowed it only under this job.
 */

const inputSchema = z.object({
  bookingId: z.uuid(),
  checklist: z.array(z.object({ item: z.string().max(200), done: z.boolean() })).max(30),
  notes: z.string().max(2000),
  photoPaths: z.array(z.string().max(300)).max(12),
});

export async function completeJobAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const viewer = await requireCleaner();
  const parsed = inputSchema.parse(input);
  try {
    const { charge } = await completeJob({ ...parsed, actorUserId: viewer.userId });
    refresh();
    sendSoon();
    return {
      ok: true,
      message:
        charge.status === "succeeded"
          ? "Job done. The client's card was charged."
          : "Job done. The office will follow up on the payment.",
    };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function noAccessAction(
  bookingId: string,
  note: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const viewer = await requireCleaner();
  try {
    await markNoAccess({ bookingId: z.uuid().parse(bookingId), actorUserId: viewer.userId, note });
    refresh();
    sendSoon();
    return { ok: true, message: "Reported. The office and the client are notified." };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}
