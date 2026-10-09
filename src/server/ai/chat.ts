import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { appendMessages, loadHistory, recordTurn, type Usage } from "./conversation";
import { aiConfig } from "./config";
import type { AssistantContext, ChatCard } from "./handlers";
import { systemPrompt } from "./prompt";
import { buildTools, type ToolEvent } from "./tools";

/**
 * One chat turn: the visitor's message goes to Claude with the business's tools; the SDK's tool runner loops
 * through tool calls; text streams to the browser as it is generated and every tool result can add a card.
 * The finished turn (assistant messages with their thinking blocks, tool results) is appended to the stored
 * conversation as is.
 */

export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | ToolEvent
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

let client: Anthropic | undefined;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

class TruncatedToolInput extends Error {}

export async function runTurn(
  ctx: AssistantContext,
  userText: string,
  emit: (event: ChatEvent) => void,
) {
  const history = await loadHistory(ctx.conversationId);
  const userMessage: Anthropic.Beta.BetaMessageParam = {
    role: "user",
    content: [{ type: "text", text: userText }],
  };
  await appendMessages(ctx.conversationId, history.length, [userMessage]);

  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const stopReasons: (string | null)[] = [];
  const tools = buildTools(ctx, (event) => emit(event));

  let runner = anthropic().beta.messages.toolRunner({
    model: aiConfig.model,
    max_tokens: aiConfig.maxTokens,
    max_iterations: aiConfig.maxIterations,
    // Stable per business and channel; tools come first and never change mid-conversation, so the whole
    // prefix is cached and each turn pays full price only for what is new.
    system: [{ type: "text", text: systemPrompt(ctx.catalog.tenant.name, ctx.channel) }],
    cache_control: { type: "ephemeral" },
    output_config: { effort: aiConfig.effort },
    // A classifier decline is retried server-side on the model Anthropic recommends for that category.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools,
    messages: [...history, userMessage],
    stream: true,
  });

  // Short remarks between tool calls arrive as separate text blocks; keep them apart as paragraphs.
  let wroteText = false;
  let startsBlock = false;
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const stream of runner) {
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "text") {
            startsBlock = wroteText;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (startsBlock && event.delta.text.trim()) {
              emit({ type: "text", delta: "\n\n" });
              startsBlock = false;
            }
            emit({ type: "text", delta: event.delta.text });
            wroteText ||= event.delta.text.trim().length > 0;
          }
        }
        const message = await stream.finalMessage();
        attempt = 0;
        stopReasons.push(message.stop_reason);
        usage.input += message.usage.input_tokens;
        usage.output += message.usage.output_tokens;
        usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

        if (message.stop_reason === "refusal") {
          emit({
            type: "notice",
            message: "I can't help with that here. You can book online or call the office.",
          });
        }
        // A tool input cut off by max_tokens can still look valid: stop instead of running it.
        if (
          message.stop_reason === "max_tokens" &&
          message.content.some((b) => b.type === "tool_use")
        ) {
          throw new TruncatedToolInput("tool input truncated");
        }
      }
      break;
    } catch (error) {
      // Eager input streaming: JSON the SDK could not parse at all rejects the iteration. Re-issue the turn
      // from the conversation so far (completed tool calls are not repeated); everything else is final.
      if (
        error instanceof Anthropic.APIError ||
        error instanceof TruncatedToolInput ||
        attempt >= 2
      ) {
        await persist(
          ctx,
          history.length + 1,
          runner.params.messages.slice(history.length + 1),
          stopReasons,
          usage,
        );
        throw error;
      }
      runner = anthropic().beta.messages.toolRunner({ ...runner.params });
    }
  }

  await persist(
    ctx,
    history.length + 1,
    runner.params.messages.slice(history.length + 1),
    stopReasons,
    usage,
  );
  emit({ type: "done" });
}

async function persist(
  ctx: AssistantContext,
  firstSeq: number,
  messages: Anthropic.Beta.BetaMessageParam[],
  stopReasons: (string | null)[],
  usage: Usage,
) {
  // Assistant messages carry their stop reason; tool-result messages (user role) carry none.
  let assistantIndex = 0;
  const reasons = messages.map((m) =>
    m.role === "assistant" ? (stopReasons[assistantIndex++] ?? null) : null,
  );
  await appendMessages(ctx.conversationId, firstSeq, messages, reasons);
  await recordTurn(ctx.conversationId, usage);
}

/** A user-facing explanation for an API failure; the details go to the server log. */
export function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError)
    return "The assistant is busy right now. Please try again in a minute.";
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return "The assistant is not available right now. You can book online or call the office.";
  }
  if (error instanceof Anthropic.APIError) return "The assistant hit a problem. Please try again.";
  return "Something went wrong. Please try again, or book online.";
}

export type { ChatCard };
