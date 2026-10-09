"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { contactSchema, homeNotesSchema } from "@/domain/booking-request";
import type { CancellationReason } from "@/domain/cancellation";
import { addDays, toLocal } from "@/domain/time";
import { requireClient } from "@/server/auth/viewer";
import { toChoices, windowsFor, type DayChoice } from "@/server/booking/availability";
import {
  cancelBooking,
  previewChange,
  rescheduleBooking,
  type ChangePreview,
} from "@/server/booking/change";
import { loadCatalog } from "@/server/catalog";
import { nullable } from "@/server/db/args";
import { adminDb } from "@/server/db/admin";
import { CommandError, ensureOk } from "@/server/db/errors";
import { userDb } from "@/server/db/user-client";
import { sendSoon } from "@/server/notifications/sender";
import { pausePlan, resumePlan } from "@/server/plans";

/**
 * Client portal actions. Each one re-checks the session and reads the booking (or plan, or home) through the
 * client's own session first: if row-level security does not show it to them, they cannot change it. The
 * commands then check the actor again in the database.
 */

const idSchema = z.uuid();
type Failure = { ok: false; message: string };

async function ownBooking(bookingId: string) {
  const viewer = await requireClient();
  const id = idSchema.parse(bookingId);
  const db = await userDb();
  const { data } = await db
    .from("bookings")
    .select("id, status, duration_minutes, crew_id, arrival_window")
    .eq("id", id)
    .eq("client_id", viewer.client.clientId)
    .maybeSingle();
  if (!data) throw new CommandError("not_found", "Booking not found");
  return { viewer, booking: data };
}

function actorOf(viewer: { userId: string }) {
  return { kind: "client" as const, userId: viewer.userId };
}

export async function previewChangeAction(
  bookingId: string,
  reason: Extract<CancellationReason, "cancel" | "reschedule">,
): Promise<ChangePreview> {
  await ownBooking(bookingId);
  return previewChange(bookingId, reason);
}

export async function cancelVisitAction(
  bookingId: string,
): Promise<{ ok: true; message: string } | Failure> {
  const { viewer } = await ownBooking(bookingId);
  try {
    const result = await cancelBooking(bookingId, actorOf(viewer), {
      reason: "Cancelled by the client",
    });
    refresh();
    sendSoon();
    return {
      ok: true,
      message:
        result.feeCents === 0
          ? "Your visit is cancelled. Any deposit is refunded to your card."
          : "Your visit is cancelled. The fee was applied as shown.",
    };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function rescheduleWindowsAction(
  bookingId: string,
  from?: string,
): Promise<{ ok: true; days: DayChoice[] } | Failure> {
  const { viewer, booking } = await ownBooking(bookingId);
  const catalog = await loadCatalog(viewer.client.slug);
  if (!catalog) return { ok: false, message: "Unknown business" };
  const start = z.iso.date().safeParse(from).data;
  const today = toLocal(new Date().toISOString(), viewer.client.timezone).date;
  const first = start && start > today ? start : addDays(today, 1);
  const days = await windowsFor(catalog, {
    from: first,
    to: addDays(first, 13),
    durationMinutes: booking.duration_minutes,
    preferredCrewId: booking.crew_id,
    excludeBookingId: booking.id,
  });
  return { ok: true, days: toChoices(days) };
}

export async function rescheduleVisitAction(
  bookingId: string,
  date: string,
  localStart: string,
): Promise<{ ok: true } | Failure> {
  const { viewer } = await ownBooking(bookingId);
  const target = z
    .object({
      date: z.iso.date(),
      localStart: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .safeParse({ date, localStart });
  if (!target.success) return { ok: false, message: "Pick a window." };
  try {
    const result = await rescheduleBooking(bookingId, actorOf(viewer), target.data);
    if (!result.ok) return { ok: false, message: result.message };
    refresh();
    sendSoon();
    return { ok: true };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

async function ownPlan(planId: string) {
  const viewer = await requireClient();
  const db = await userDb();
  const { data } = await db
    .from("recurring_plans")
    .select("id")
    .eq("id", idSchema.parse(planId))
    .eq("client_id", viewer.client.clientId)
    .maybeSingle();
  if (!data) throw new CommandError("not_found", "Plan not found");
  return viewer;
}

export async function pausePlanAction(
  planId: string,
  until: string,
): Promise<{ ok: true; cancelled: number } | Failure> {
  const viewer = await ownPlan(planId);
  const date = z.iso.date().safeParse(until);
  if (!date.success) return { ok: false, message: "Pick a date." };
  try {
    const cancelled = await pausePlan(planId, actorOf(viewer), date.data);
    refresh();
    sendSoon();
    return { ok: true, cancelled };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function resumePlanAction(planId: string): Promise<{ ok: true } | Failure> {
  const viewer = await ownPlan(planId);
  try {
    await resumePlan(planId, actorOf(viewer));
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateContactAction(input: {
  fullName: string;
  phone: string;
}): Promise<{ ok: true } | (Failure & { fieldErrors?: Record<string, string> })> {
  const viewer = await requireClient();
  const parsed = contactSchema.pick({ fullName: true, phone: true }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please check the highlighted fields.",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join("."), i.message]),
      ),
    };
  }
  ensureOk(
    await adminDb().rpc("cmd_update_client_contact", {
      p_client_id: viewer.client.clientId,
      p_actor: viewer.userId,
      p_actor_kind: "client",
      p_full_name: parsed.data.fullName,
      p_phone: parsed.data.phone,
    }),
    "update contact",
  );
  refresh();
  return { ok: true };
}

export async function updateHomeNotesAction(
  propertyId: string,
  input: z.input<typeof homeNotesSchema>,
): Promise<{ ok: true } | Failure> {
  const viewer = await requireClient();
  const id = idSchema.parse(propertyId);
  const db = await userDb();
  const { data: home } = await db
    .from("properties")
    .select("id")
    .eq("id", id)
    .eq("client_id", viewer.client.clientId)
    .maybeSingle();
  if (!home) return { ok: false, message: "Home not found." };

  const notes = homeNotesSchema.parse(input);
  ensureOk(
    await adminDb().rpc("cmd_update_property_notes", {
      p_property_id: id,
      p_actor: viewer.userId,
      p_actor_kind: "client",
      p_has_pets: notes.hasPets,
      p_pet_notes: nullable<string>(notes.petNotes),
      p_access_notes: nullable<string>(notes.accessNotes),
      p_parking_notes: nullable<string>(notes.parkingNotes),
    }),
    "update home notes",
  );
  refresh();
  return { ok: true };
}
