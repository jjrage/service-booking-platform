import "server-only";

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import type { z } from "zod";

import type { Json } from "@/db/database.types";

import { adminDb } from "../db/admin";
import { CommandError } from "../db/errors";
import * as handlers from "./handlers";
import type { AssistantContext, ChatCard, ToolOutput } from "./handlers";

/**
 * The assistant's tool set for one conversation. Each tool is a thin wrapper over a server function in
 * handlers.ts; this layer validates input (strict Zod schemas), logs every call to ai_tool_calls (input,
 * output, success, duration) and turns a failure into an error result the model can explain, instead of
 * something it might paper over.
 */

type ToolSpec<S extends z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  run: (ctx: AssistantContext, input: z.infer<S>) => Promise<ToolOutput>;
  /** Only for signed-in clients in the portal. */
  portalOnly?: boolean;
  /**
   * Strict tool use (schema-valid input guaranteed by the API) is on by default. The API caps the combined
   * size of strict schemas in one request, so a tool may opt out; Zod still validates its input.
   */
  strict?: false;
};

function spec<S extends z.ZodType>(s: ToolSpec<S>): ToolSpec<S> {
  return s;
}

export const toolSpecs = [
  spec({
    name: "get_business_info",
    description:
      "Today's date and time, opening hours, closed dates, arrival windows, booking horizon, service area with travel fees, deposit and cancellation policy. Call first in every conversation.",
    schema: handlers.businessInfoSchema,
    run: (ctx) => handlers.getBusinessInfo(ctx),
  }),
  spec({
    name: "list_services",
    description:
      "Services with descriptions and base prices, what the base price covers, extras with codes and prices, regular-plan frequencies and discounts.",
    schema: handlers.listServicesSchema,
    run: (ctx) => handlers.listServices(ctx),
  }),
  spec({
    name: "get_quote",
    description:
      "The exact price, duration and deposit for a visit, computed from the business's current price rules. The only source of prices.",
    schema: handlers.getQuoteSchema,
    run: handlers.getQuote,
  }),
  spec({
    name: "check_availability",
    description:
      "Free arrival windows for a visit over up to 14 days, accounting for crew bookings, travel time, holidays and the visit's length.",
    schema: handlers.checkAvailabilitySchema,
    run: handlers.checkAvailability,
  }),
  spec({
    name: "hold_slot",
    description:
      "Hold an arrival window for this client for a few minutes while booking. Replaces any window held earlier in this conversation. If it was just taken, returns the next free windows.",
    schema: handlers.holdSlotSchema,
    run: handlers.holdSlot,
  }),
  spec({
    name: "create_booking",
    description:
      "Create the booking for the held window, after the client confirmed the read-back. Guests: give name, e-mail, phone and address; the result is pending payment with a payment link. Signed-in clients: their home on file is used and their saved card pays the deposit.",
    schema: handlers.createBookingSchema,
    run: handlers.createBooking,
    // With its nine nullable fields next to the three tools that carry the visit, the strict schemas exceed
    // the API's grammar size limit ("compiled grammar is too large"). An invalid input comes back to the
    // model as an error, and nothing is booked without a held window anyway.
    strict: false,
  }),
  spec({
    name: "list_my_visits",
    description: "The signed-in client's upcoming visits with booking numbers.",
    schema: handlers.listMyVisitsSchema,
    run: (ctx) => handlers.listMyVisits(ctx),
    portalOnly: true,
  }),
  spec({
    name: "reschedule_booking",
    description:
      "Move one of the signed-in client's visits to another free window. confirm=false returns the fee; confirm=true moves it.",
    schema: handlers.rescheduleSchema,
    run: handlers.rescheduleMyBooking,
    portalOnly: true,
  }),
  spec({
    name: "cancel_booking",
    description:
      "Cancel one of the signed-in client's visits. confirm=false returns the fee and refund; confirm=true cancels.",
    schema: handlers.cancelSchema,
    run: handlers.cancelMyBooking,
    portalOnly: true,
  }),
  spec({
    name: "handoff_to_human",
    description:
      "Pass the conversation to the office: quoted services, complaints, special requests, anything the tools cannot answer.",
    schema: handlers.handoffSchema,
    run: handlers.handoffToHuman,
  }),
] as const;

export type ToolEvent =
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean; card?: ChatCard };

async function logCall(
  ctx: AssistantContext,
  entry: {
    toolUseId: string;
    name: string;
    input: unknown;
    output: unknown;
    ok: boolean;
    error: string | null;
    started: number;
    bookingId?: string;
  },
) {
  const { error } = await adminDb()
    .from("ai_tool_calls")
    .insert({
      tenant_id: ctx.catalog.tenant.id,
      conversation_id: ctx.conversationId,
      tool_use_id: entry.toolUseId,
      tool_name: entry.name,
      input: (entry.input ?? {}) as NonNullable<Json>,
      output: (entry.output ?? null) as Json,
      ok: entry.ok,
      error: entry.error,
      duration_ms: Math.round(performance.now() - entry.started),
      booking_id: entry.bookingId ?? null,
    });
  if (error) console.error("log tool call", error.message);
}

/** Runs one tool call with logging. Exported for tests, which call tools without a model. */
export async function runLogged<S extends z.ZodType>(
  ctx: AssistantContext,
  tool: ToolSpec<S>,
  input: z.infer<S>,
  toolUseId: string,
  onEvent?: (event: ToolEvent) => void,
): Promise<ToolOutput> {
  const started = performance.now();
  onEvent?.({ type: "tool_start", name: tool.name });
  try {
    const output = await tool.run(ctx, input);
    await logCall(ctx, {
      toolUseId,
      name: tool.name,
      input,
      output: output.result,
      ok: true,
      error: null,
      started,
      bookingId: output.bookingId,
    });
    onEvent?.({ type: "tool_end", name: tool.name, ok: true, card: output.card });
    return output;
  } catch (error) {
    const message =
      error instanceof CommandError
        ? error.message
        : "Something went wrong on our side. Apologize and offer handoff_to_human.";
    await logCall(ctx, {
      toolUseId,
      name: tool.name,
      input,
      output: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      started,
    });
    onEvent?.({ type: "tool_end", name: tool.name, ok: false });
    if (!(error instanceof CommandError)) console.error(`tool ${tool.name}`, error);
    throw new ToolError(message);
  }
}

/** JSON Schema keywords that strict tool use rejects (the API answers 400). */
export const strictUnsupportedKeywords = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
] as const;

/**
 * Strict tool schemas accept a subset of JSON Schema. Bounds are removed from the schema sent to the API and
 * written into the field's description instead, so the model still knows them; Zod enforces them when the
 * tool runs.
 */
export function forStrictTools(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forStrictTools);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  const limits: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if ((strictUnsupportedKeywords as readonly string[]).includes(key)) {
      limits.push(key === "pattern" ? `format ${String(value)}` : `${key} ${String(value)}`);
    } else if (key === "properties" && value && typeof value === "object") {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [name, forStrictTools(property)]),
      );
    } else {
      out[key] = forStrictTools(value);
    }
  }
  if (limits.length > 0) {
    const note = `Limits: ${limits.join(", ")}.`;
    const text = typeof out.description === "string" ? out.description.trim() : "";
    out.description = text ? `${text}${/[.!?]$/.test(text) ? "" : "."} ${note}` : note;
  }
  return out;
}

/** The runnable tools for a conversation: strict schemas, inputs streamed as generated. */
export function buildTools(ctx: AssistantContext, onEvent: (event: ToolEvent) => void) {
  return toolSpecs
    .filter((t) => !("portalOnly" in t && t.portalOnly) || ctx.channel === "portal")
    .map((t) => {
      const runnable = betaZodTool({
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
        run: async (input, context) => {
          const output = await runLogged(
            ctx,
            t as ToolSpec<z.ZodType>,
            input,
            context?.toolUse.id ?? "unknown",
            onEvent,
          );
          return JSON.stringify(output.result);
        },
      });
      // betaZodTool always builds a custom tool, the member of its return type with an input schema.
      const tool = runnable as Extract<typeof runnable, { input_schema: unknown }>;
      const strict = !("strict" in t && t.strict === false);
      return {
        ...tool,
        input_schema: forStrictTools(tool.input_schema) as typeof tool.input_schema,
        strict,
        eager_input_streaming: true,
      };
    });
}
