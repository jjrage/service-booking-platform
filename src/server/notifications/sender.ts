import "server-only";

import { after } from "next/server";

import { appUrl } from "@/config/public-env";
import { serverEnv } from "@/config/server-env";
import { toLocal } from "@/domain/time";

import { adminDb } from "../db/admin";
import { unwrap } from "../db/errors";
import { parseRange } from "../db/ranges";
import { bookingAccessToken } from "../signing";
import { renderEmail, renderSms, type MessageContext, type Rendered } from "./templates";

/**
 * Delivers due outbox messages. Each message is claimed once (cmd_claim_outbox), rendered, delivered and
 * recorded (cmd_finish_outbox). With a Resend key, e-mail to real addresses goes out with the message's dedupe
 * key as Resend's idempotency key, so a retry after a timeout never sends twice. Without a key, and for the
 * demo's fictional addresses (*.example), the rendered message is only stored: the admin console shows it.
 */

type OutboxRow = {
  id: string;
  kind: string;
  channel: "email" | "sms_log";
  to_address: string;
  booking_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

async function contextFor(bookingId: string): Promise<MessageContext> {
  const booking = unwrap(
    await adminDb()
      .from("bookings")
      .select(
        "id, number, arrival_window, duration_minutes, total_cents, currency, recurring_plan_id, " +
          "tenant:tenants!inner(slug, name, timezone, phone, contact_email), service:services!inner(name), " +
          "client:clients!inner(full_name), property:properties!inner(address_line1, city, state, zip, access_notes)",
      )
      .eq("id", bookingId)
      .single<{
        id: string;
        number: number;
        arrival_window: string;
        duration_minutes: number;
        total_cents: number;
        currency: string;
        recurring_plan_id: string | null;
        tenant: {
          slug: string;
          name: string;
          timezone: string;
          phone: string | null;
          contact_email: string | null;
        };
        service: { name: string };
        client: { full_name: string };
        property: {
          address_line1: string;
          city: string;
          state: string;
          zip: string;
          access_notes: string | null;
        };
      }>(),
    "load booking for message",
  );
  const window = parseRange(booking.arrival_window);
  const start = toLocal(window.start, booking.tenant.timezone);
  const p = booking.property;
  return {
    tenantName: booking.tenant.name,
    tenantPhone: booking.tenant.phone,
    tenantEmail: booking.tenant.contact_email,
    clientFirstName: booking.client.full_name.split(" ")[0] ?? booking.client.full_name,
    bookingNumber: booking.number,
    serviceName: booking.service.name,
    date: start.date,
    localStart: start.time,
    localEnd: toLocal(window.end, booking.tenant.timezone).time,
    durationMinutes: booking.duration_minutes,
    address: `${p.address_line1}, ${p.city}, ${p.state} ${p.zip}`,
    accessNotes: p.access_notes,
    totalCents: booking.total_cents,
    currency: booking.currency,
    bookingUrl: `${appUrl}/${booking.tenant.slug}/bookings/${booking.id}?t=${bookingAccessToken(booking.id)}`,
    portalUrl: `${appUrl}/portal`,
    isRegular: booking.recurring_plan_id !== null,
  };
}

/** Real delivery only to real addresses: the demo's clients use the reserved .example domain. */
function deliverable(address: string): boolean {
  return Boolean(serverEnv.RESEND_API_KEY) && !/\.example$/i.test(address.trim());
}

async function sendWithResend(row: OutboxRow, message: Rendered, tenantName: string) {
  const from = serverEnv.EMAIL_FROM ?? `${tenantName} <onboarding@resend.dev>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": row.dedupe_key,
    },
    body: JSON.stringify({
      from,
      to: [row.to_address],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok || !body.id) {
    throw new Error(`Resend ${response.status}: ${body.message ?? "no message id"}`);
  }
  return body.id;
}

export async function sendDueOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const db = adminDb();
  const rows = unwrap(
    await db.rpc("cmd_claim_outbox", { p_limit: limit }),
    "claim outbox",
  ) as OutboxRow[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    let message: Rendered | null = null;
    try {
      if (!row.booking_id) throw new Error("message has no booking");
      const ctx = await contextFor(row.booking_id);
      message =
        row.channel === "sms_log"
          ? renderSms(row.kind, ctx)
          : renderEmail(row.kind, ctx, row.payload);

      let provider = "log";
      let messageId = `log_${row.id}`;
      if (row.channel === "sms_log") {
        provider = "sms_log";
      } else if (deliverable(row.to_address)) {
        provider = "resend";
        messageId = await sendWithResend(row, message, ctx.tenantName);
      }

      await db.rpc("cmd_finish_outbox", {
        p_id: row.id,
        p_ok: true,
        p_provider: provider,
        p_provider_message_id: messageId,
        p_error: null as unknown as string,
        p_subject: message.subject,
        p_body_html: message.html,
        p_body_text: message.text,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.rpc("cmd_finish_outbox", {
        p_id: row.id,
        p_ok: false,
        p_provider: serverEnv.RESEND_API_KEY ? "resend" : "log",
        p_provider_message_id: null as unknown as string,
        p_error: error instanceof Error ? error.message : String(error),
        p_subject: message?.subject ?? (null as unknown as string),
        p_body_html: message?.html ?? (null as unknown as string),
        p_body_text: message?.text ?? (null as unknown as string),
      });
    }
  }
  return { sent, failed };
}

/**
 * Sends what a request just queued right after the response, instead of waiting for the next scheduled run.
 * The scheduled job still covers anything this misses.
 */
export function sendSoon(): void {
  after(async () => {
    try {
      await sendDueOutbox(20);
    } catch (error) {
      console.error("send outbox after request", error);
    }
  });
}
