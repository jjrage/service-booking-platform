import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadCatalog, type Catalog } from "@/server/catalog";

import { createTestTenant } from "./test-tenant";

/**
 * The chat plumbing end to end without spending money: the SDK is pointed at a local stand-in for the
 * Messages API that streams a tool call and then text, in the API's server-sent-event format. Checks that the
 * request carries the settings we rely on (server-side fallback, prompt caching, strict tools), that the tool
 * runs and is logged, that text streams out, and that the conversation is stored append-only and replayed.
 */

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let catalog: Catalog;
let server: Server;
const requests: {
  path: string;
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}[] = [];

function sse(events: [string, unknown][]): string {
  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

const usage = {
  input_tokens: 1200,
  output_tokens: 40,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 900,
};

function messageStart(id: string) {
  return [
    "message_start",
    {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    },
  ] as [string, unknown];
}

/** First request: call get_business_info. After a tool result: answer in text. */
function reply(body: { messages: { role: string; content: { type: string }[] }[] }): string {
  const last = body.messages.at(-1)!;
  const afterTool = last.content.some((b) => b.type === "tool_result");
  if (!afterTool) {
    return sse([
      messageStart("msg_1"),
      [
        "content_block_start",
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Let me check. " },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "get_business_info", input: {} },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: "{}" },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 1 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 30 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ]);
  }
  return sse([
    messageStart("msg_2"),
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "We're open Monday " },
      },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "to Saturday." },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 12 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ]);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({ path: req.url ?? "", headers: req.headers, body });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(reply(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "sk-ant-local-stand-in";

  tenant = await createTestTenant({ crews: 1 });
  catalog = (await loadCatalog(tenant.slug))!;
});

afterAll(async () => {
  await tenant?.cleanup();
  await new Promise((resolve) => server?.close(resolve));
});

describe("chat turn", () => {
  it("streams text, runs the tool, logs it, and stores the turn for replay", async () => {
    const { runTurn } = await import("@/server/ai/chat");
    const { aiConfig } = await import("@/server/ai/config");
    const { strictUnsupportedKeywords } = await import("@/server/ai/tools");
    const { data: conversation } = await tenant.admin
      .from("ai_conversations")
      .insert({
        tenant_id: tenant.tenantId,
        channel: "web",
        visitor_id: crypto.randomUUID(),
        model: "claude-opus-5-5",
      })
      .select("id")
      .single();
    const ctx = {
      catalog,
      conversationId: conversation!.id,
      channel: "web" as const,
      client: null,
      userId: null,
    };

    const events: { type: string; delta?: string; name?: string }[] = [];
    await runTurn(ctx, "When are you open?", (event) => events.push(event));

    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.delta)
        .join(""),
      // Text blocks before and after the tool call stream as separate paragraphs.
    ).toBe("Let me check. \n\nWe're open Monday to Saturday.");
    expect(
      events.filter((e) => e.type.startsWith("tool_")).map((e) => `${e.type}:${e.name}`),
    ).toEqual(["tool_start:get_business_info", "tool_end:get_business_info"]);
    expect(events.at(-1)?.type).toBe("done");

    // The request shape the assistant relies on.
    const first = requests[0]!;
    expect(first.body).toMatchObject({
      model: aiConfig.model,
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      stream: true,
    });
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    const tools = first.body.tools as {
      name: string;
      strict?: boolean;
      eager_input_streaming?: boolean;
    }[];
    expect(tools.every((t) => t.eager_input_streaming === true)).toBe(true);
    // Strict everywhere except create_booking, which opts out to stay under the API's grammar size limit.
    expect(tools.filter((t) => t.strict !== true).map((t) => t.name)).toEqual(["create_booking"]);
    expect(tools.map((t) => t.name)).not.toContain("cancel_booking"); // guests do not get visit-changing tools
    // Strict tool use rejects numeric bounds, string lengths and patterns with a 400.
    const keys = new Set<string>();
    const collect = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        keys.add(key);
        collect(value);
      }
    };
    collect(tools.map((t) => (t as { input_schema?: unknown }).input_schema));
    expect(strictUnsupportedKeywords.filter((k) => keys.has(k))).toEqual([]);

    // The tool call is logged, the turn stored: user, assistant (tool use), user (tool result), assistant.
    const { data: calls } = await tenant.admin
      .from("ai_tool_calls")
      .select("tool_name, ok")
      .eq("conversation_id", ctx.conversationId);
    expect(calls).toEqual([{ tool_name: "get_business_info", ok: true }]);
    const { data: stored } = await tenant.admin
      .from("ai_messages")
      .select("seq, role, stop_reason")
      .eq("conversation_id", ctx.conversationId)
      .order("seq");
    expect(stored).toEqual([
      { seq: 0, role: "user", stop_reason: null },
      { seq: 1, role: "assistant", stop_reason: "tool_use" },
      { seq: 2, role: "user", stop_reason: null },
      { seq: 3, role: "assistant", stop_reason: "end_turn" },
    ]);
    const { data: counters } = await tenant.admin
      .from("ai_conversations")
      .select("user_turns, input_tokens, cache_read_tokens")
      .eq("id", ctx.conversationId)
      .single();
    expect(counters).toEqual({ user_turns: 1, input_tokens: 2400, cache_read_tokens: 1800 });

    // The next turn replays the stored history unchanged, then appends.
    requests.length = 0;
    await runTurn(ctx, "Thanks!", () => {});
    const replayed = requests[0]!.body.messages as unknown[];
    expect(replayed).toHaveLength(5);
    const { count } = await tenant.admin
      .from("ai_messages")
      .select("seq", { count: "exact", head: true })
      .eq("conversation_id", ctx.conversationId);
    expect(count).toBe(8);
  });
});
