import "server-only";

import { serverEnv } from "@/config/server-env";

/**
 * Assistant settings. The model and its cost are the owner's decision: ANTHROPIC_MODEL overrides the default.
 * Without ANTHROPIC_API_KEY the assistant is switched off and the chat says so.
 */
export const aiConfig = {
  enabled: Boolean(serverEnv.ANTHROPIC_API_KEY),
  model: serverEnv.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  /** Thinking counts toward max_tokens on Claude Opus 5.5 (it is always on), so leave room for it. */
  maxTokens: 16000,
  /** Claude Opus 5.5 defaults to medium; set explicitly so a model change does not silently change it. */
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
