import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { z } from "zod";

import { aiConfig } from "@/server/ai/config";
import { openConversation } from "@/server/ai/conversation";
import { describeFailure, runTurn, type ChatEvent } from "@/server/ai/chat";
import { getViewer } from "@/server/auth/viewer";
import { getCatalog } from "@/server/catalog";
import { sendSoon } from "@/server/notifications/sender";

/**
 * The chat endpoint: one POST per visitor message, answered with a stream of newline-delimited JSON events
 * (text deltas, tool activity, cards from tool results). A signed-in client of the business chats in the
 * portal channel and gets the tools for their own visits.
 */

const bodySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  conversationId: z.uuid().nullable().optional(),
  message: z.string().trim().min(1).max(aiConfig.limits.messageChars),
});

const VISITOR_COOKIE = "chat_visitor";

export async function POST(request: Request) {
  if (!aiConfig.enabled) {
    return Response.json(
      { error: "The assistant is switched off in this demo: no Anthropic API key is configured." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Please write a shorter message." }, { status: 400 });
  }
  const { slug, conversationId, message } = parsed.data;

  const catalog = await getCatalog(slug);
  if (!catalog) return Response.json({ error: "Unknown business" }, { status: 404 });

  const viewer = await getViewer();
  const client = viewer?.client?.tenantId === catalog.tenant.id ? viewer.client : null;

  const jar = await cookies();
  let visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!visitorId || !/^[0-9a-f-]{36}$/.test(visitorId)) {
    visitorId = randomUUID();
    jar.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 3600,
    });
  }

  const opened = await openConversation({
    tenantId: catalog.tenant.id,
    channel: client ? "portal" : "web",
    clientId: client?.clientId ?? null,
    userId: client ? viewer!.userId : null,
    visitorId,
    conversationId: conversationId ?? null,
  });
  if (!opened.ok) return Response.json({ error: opened.message }, { status: 429 });

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the visitor closes the chat mid-answer, the turn still finishes on the server, so a booking in
      // progress and the stored conversation stay consistent; there is just no one left to stream to.
      const emit = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      emit({ type: "conversation", id: opened.conversation.id });
      try {
        await runTurn(
          {
            catalog,
            conversationId: opened.conversation.id,
            channel: client ? "portal" : "web",
            client,
            userId: client ? viewer!.userId : null,
          },
          message,
          emit,
        );
      } catch (error) {
        console.error("chat turn", error);
        emit({ type: "error", message: describeFailure(error) });
      } finally {
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
    },
  });

  // A booking made in the chat queues its confirmation; send it once the response is done.
  sendSoon();
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return Response.json({
    enabled: aiConfig.enabled,
    model: aiConfig.enabled ? aiConfig.model : null,
  });
}
