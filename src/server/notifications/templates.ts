import "server-only";

import { formatDate, formatDuration, formatMoney, formatWindow } from "@/ui/format";

/**
 * E-mail and text templates. Plain, table-free HTML with inline styles: it renders the same in Gmail, Outlook
 * and Apple Mail, and reads well as text.
 */

export type MessageContext = {
  tenantName: string;
  tenantPhone: string | null;
  tenantEmail: string | null;
  clientFirstName: string;
  bookingNumber: number;
  serviceName: string;
  date: string;
  localStart: string;
  localEnd: string;
  durationMinutes: number;
  address: string;
  accessNotes: string | null;
  totalCents: number;
  currency: string;
  bookingUrl: string;
  portalUrl: string;
  isRegular: boolean;
};

export type Rendered = { subject: string; html: string; text: string };

type Block = { heading?: string; lines: string[] };

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(
  ctx: MessageContext,
  title: string,
  intro: string,
  blocks: Block[],
  action: { label: string; url: string } | null,
): Rendered {
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#0f766e">${escape(ctx.tenantName)}</p>
  <div style="background:#ffffff;border-radius:12px;padding:28px 24px;border:1px solid #e4e4e7">
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${escape(title)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46">${escape(intro)}</p>
    ${blocks
      .map(
        (b) => `<div style="margin:0 0 16px;padding:14px 16px;background:#f8faf9;border-radius:8px">
      ${b.heading ? `<p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#71717a">${escape(b.heading)}</p>` : ""}
      ${b.lines.map((l) => `<p style="margin:0;font-size:15px;line-height:1.6">${escape(l)}</p>`).join("")}
    </div>`,
      )
      .join("")}
    ${action ? `<p style="margin:24px 0 0"><a href="${escape(action.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">${escape(action.label)}</a></p>` : ""}
  </div>
  <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#71717a">
    ${escape(ctx.tenantName)}${ctx.tenantPhone ? ` · ${escape(ctx.tenantPhone)}` : ""}${ctx.tenantEmail ? ` · ${escape(ctx.tenantEmail)}` : ""}<br>
    Demo — fictional business. This message was sent by a portfolio demo.
  </p>
</div></body></html>`;

  const text = [
    title,
    "",
    intro,
    "",
    ...blocks.flatMap((b) => [...(b.heading ? [`${b.heading}:`] : []), ...b.lines, ""]),
    ...(action ? [`${action.label}: ${action.url}`, ""] : []),
    `${ctx.tenantName}${ctx.tenantPhone ? ` · ${ctx.tenantPhone}` : ""}`,
  ].join("\n");

  return { subject: title, html, text };
}

function when(ctx: MessageContext): string {
  return `${formatDate(ctx.date, "long")}, arrival ${formatWindow(ctx.localStart, ctx.localEnd)}`;
}

function visitBlock(ctx: MessageContext): Block {
  return {
    heading: `Visit #${ctx.bookingNumber}`,
    lines: [
      `${ctx.serviceName} · about ${formatDuration(ctx.durationMinutes)}`,
      when(ctx),
      ctx.address,
    ],
  };
}

export function renderEmail(
  kind: string,
  ctx: MessageContext,
  payload: Record<string, unknown>,
): Rendered {
  const money = (cents: number) => formatMoney(cents, ctx.currency);
  const fee = typeof payload.fee_cents === "number" ? payload.fee_cents : 0;
  const manage = { label: "Manage your booking", url: ctx.bookingUrl };

  switch (kind) {
    case "booking_confirmed":
      return layout(
        ctx,
        `You're booked: ${formatDate(ctx.date)}`,
        `Hi ${ctx.clientFirstName}, thanks for booking with ${ctx.tenantName}. Here are the details.`,
        [visitBlock(ctx), { heading: "Price", lines: [`${money(ctx.totalCents)} for this visit`] }],
        manage,
      );
    case "booking_rescheduled":
      return layout(
        ctx,
        `New time: ${formatDate(ctx.date)}`,
        `Hi ${ctx.clientFirstName}, your visit has moved. The crew will come at the new time below.`,
        [
          visitBlock(ctx),
          ...(fee > 0
            ? [{ lines: [`A ${money(fee)} late-change fee was charged to your card.`] }]
            : []),
        ],
        manage,
      );
    case "booking_cancelled":
      return layout(
        ctx,
        `Visit #${ctx.bookingNumber} is cancelled`,
        `Hi ${ctx.clientFirstName}, we have cancelled your visit on ${formatDate(ctx.date, "long")}.`,
        [
          {
            lines: [
              fee > 0
                ? `Cancellation fee: ${money(fee)}. Any rest of your deposit is refunded to your card.`
                : "There is no fee. Any deposit is refunded to your card within a few days.",
            ],
          },
        ],
        { label: "Book another time", url: ctx.portalUrl },
      );
    case "reminder_72h":
      return layout(
        ctx,
        `See you ${formatDate(ctx.date, "long")}`,
        `Hi ${ctx.clientFirstName}, your cleaning is in three days. Please check how the crew gets in.`,
        [
          visitBlock(ctx),
          {
            heading: "Getting in",
            lines: [
              ctx.accessNotes ??
                "No access notes yet. Lockbox code, garage keypad or someone home? Add it in the portal.",
            ],
          },
        ],
        { label: "Update access notes", url: ctx.portalUrl },
      );
    case "reminder_24h":
      return layout(
        ctx,
        `Tomorrow: ${formatWindow(ctx.localStart, ctx.localEnd)}`,
        `Hi ${ctx.clientFirstName}, a reminder that ${ctx.tenantName} is coming tomorrow.`,
        [visitBlock(ctx)],
        manage,
      );
    case "review_request":
      return layout(
        ctx,
        "How did we do?",
        `Hi ${ctx.clientFirstName}, thanks for having us today. A quick reply with how it went helps the crew and the next client.`,
        [visitBlock(ctx)],
        ctx.isRegular
          ? { label: "See your next visits", url: ctx.portalUrl }
          : { label: "Book your next cleaning", url: ctx.portalUrl },
      );
    case "no_access":
      return layout(
        ctx,
        "We couldn't get in today",
        `Hi ${ctx.clientFirstName}, the crew arrived for visit #${ctx.bookingNumber} but could not get into the home.`,
        [
          {
            lines: [
              fee > 0 ? `Under the lockout policy, ${money(fee)} applies.` : "There is no charge.",
            ],
          },
          { lines: ["Reply or call us to book a new time."] },
        ],
        { label: "Book a new time", url: ctx.portalUrl },
      );
    case "payment_failed": {
      const amount = typeof payload.amount_cents === "number" ? payload.amount_cents : null;
      return layout(
        ctx,
        "Your payment didn't go through",
        `Hi ${ctx.clientFirstName}, we could not charge your saved card${amount ? ` ${money(amount)}` : ""} for visit #${ctx.bookingNumber}.`,
        [
          {
            lines: [
              "Your bank declined it. Please update your card or call us; nothing else is needed.",
            ],
          },
        ],
        { label: "Open the client portal", url: ctx.portalUrl },
      );
    }
    default:
      return layout(
        ctx,
        `Update on visit #${ctx.bookingNumber}`,
        `Hi ${ctx.clientFirstName}.`,
        [visitBlock(ctx)],
        manage,
      );
  }
}

export function renderSms(kind: string, ctx: MessageContext): Rendered {
  const text =
    kind === "reminder_24h"
      ? `${ctx.tenantName}: reminder, your cleaning is tomorrow ${formatWindow(ctx.localStart, ctx.localEnd)}. Manage: ${ctx.portalUrl}`
      : `${ctx.tenantName}: update on visit #${ctx.bookingNumber}.`;
  return { subject: "SMS", html: "", text };
}
