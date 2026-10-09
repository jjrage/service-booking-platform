import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import type { Json } from "@/db/database.types";

import { adminDb } from "../db/admin";
import { unwrap } from "../db/errors";
import { aiConfig } from "./config";

/**
 * Conversation storage and limits. Messages are only ever appended (the API sees the history exactly as it
 * happened, which keeps thinking blocks valid and the prompt cache warm), and every limit is checked before a
 * request reaches the model.
 */

export type ConversationRef = { id: string; userTurns: number };

export type OpenResult =
  { ok: true; conversation: ConversationRef } | { ok: false; message: string };

const dayAgo = () => new Date(Date.now() - 24 * 3600_000).toISOString();

export async function openConversation(input: {
  tenantId: string;
  channel: "web" | "portal";
  clientId: string | null;
  userId: string | null;
  visitorId: string;
  conversationId: string | null;
}): Promise<OpenResult> {
  const db = adminDb();
  const { limits } = aiConfig;

  const [tenantToday, visitorToday] = await Promise.all([
    db
      .from("ai_conversations")
      .select("user_turns")
      .eq("tenant_id", input.tenantId)
      .gte("last_activity_at", dayAgo()),
    db
      .from("ai_conversations")
      .select("id, user_turns")
      .eq("visitor_id", input.visitorId)
      .gte("started_at", dayAgo()),
  ]);
  const sum = (rows: { user_turns: number }[] | null) =>
    (rows ?? []).reduce((s, r) => s + r.user_turns, 0);
  if (sum(tenantToday.data) >= limits.turnsPerTenantPerDay) {
    return {
      ok: false,
      message:
        "The assistant has reached today's limit for this demo. Please book online or call us.",
    };
  }
  if (sum(visitorToday.data) >= limits.turnsPerVisitorPerDay) {
    return {
      ok: false,
      message: "You've reached today's message limit. Please book online or call us.",
    };
  }

  if (input.conversationId) {
    const { data } = await db
      .from("ai_conversations")
      .select("id, user_turns, tenant_id, visitor_id, user_id")
      .eq("id", input.conversationId)
      .maybeSingle();
    // A conversation continues only for the visitor (and user) who started it.
    if (
      data &&
      data.tenant_id === input.tenantId &&
      data.visitor_id === input.visitorId &&
      data.user_id === input.userId
    ) {
      if (data.user_turns >= limits.turnsPerConversation) {
        return {
          ok: false,
          message: "This conversation is long enough. Start a new one, or book online.",
        };
      }
      return { ok: true, conversation: { id: data.id, userTurns: data.user_turns } };
    }
  }

  if ((visitorToday.data ?? []).length >= limits.conversationsPerVisitorPerDay) {
    return {
      ok: false,
      message: "You've started several conversations today. Please book online or call us.",
    };
  }
  const created = unwrap(
    await db
      .from("ai_conversations")
      .insert({
        tenant_id: input.tenantId,
        channel: input.channel,
        client_id: input.clientId,
        user_id: input.userId,
        visitor_id: input.visitorId,
        model: aiConfig.model,
      })
      .select("id")
      .single(),
    "start conversation",
  );
  return { ok: true, conversation: { id: created.id, userTurns: 0 } };
}

export async function loadHistory(
  conversationId: string,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = unwrap(
    await adminDb()
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("seq"),
    "load history",
  );
  return rows.map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
  }));
}

export async function appendMessages(
  conversationId: string,
  firstSeq: number,
  messages: Anthropic.Beta.BetaMessageParam[],
  stopReasons: (string | null)[] = [],
) {
  if (messages.length === 0) return;
  const { error } = await adminDb()
    .from("ai_messages")
    .insert(
      messages.map((m, i) => ({
        conversation_id: conversationId,
        seq: firstSeq + i,
        role: m.role,
        content: (typeof m.content === "string"
          ? [{ type: "text", text: m.content }]
          : m.content) as unknown as NonNullable<Json>,
        stop_reason: stopReasons[i] ?? null,
      })),
    );
  if (error) throw new Error(`append messages: ${error.message}`);
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export async function recordTurn(conversationId: string, usage: Usage) {
  const db = adminDb();
  const { data } = await db
    .from("ai_conversations")
    .select("user_turns, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens")
    .eq("id", conversationId)
    .single();
  if (!data) return;
  await db
    .from("ai_conversations")
    .update({
      user_turns: data.user_turns + 1,
      input_tokens: data.input_tokens + usage.input,
      output_tokens: data.output_tokens + usage.output,
      cache_read_tokens: data.cache_read_tokens + usage.cacheRead,
      cache_write_tokens: data.cache_write_tokens + usage.cacheWrite,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
}
