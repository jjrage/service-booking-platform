import "server-only";

import { serverEnv } from "@/config/server-env";

/**
 * Assistant settings. The model and its cost are the owner's decision: ANTHROPIC_MODEL overrides the default.
 * Without ANTHROPIC_API_KEY the assistant is switched off and the chat says so.
 */
export const aiConfig = {
  enabled: Boolean(serverEnv.ANTHROPIC_API_KEY),
  model: serverEnv.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  /** Thinking is on by default on Claude Opus 5.5 and Sonnet 5.5 and counts toward max_tokens. */
  maxTokens: 16000,
  /** Set explicitly: defaults differ by model (medium on Opus 5.5, high on Sonnet 5.5). */
  effort: "medium" as const,
  /** API requests per user message: enough for quote → availability → hold → book, not for a runaway loop. */
  maxIterations: 8,
  limits: {
    messageChars: 1000,
    turnsPerConversation: 24,
    conversationsPerVisitorPerDay: 6,
    turnsPerVisitorPerDay: 60,
    /** A ceiling for the whole public demo per business per day; the API key also has a spending limit. */
    turnsPerTenantPerDay: 400,
  },
} as const;
