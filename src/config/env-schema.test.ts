import { describe, expect, it } from "vitest";

import { parseEnv, publicEnvSchema, serverEnvSchema } from "./env-schema";

describe("parseEnv", () => {
  it("accepts a complete public configuration", () => {
    const env = parseEnv(
      publicEnvSchema,
      {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:44321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
      "public",
    );
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:44321");
  });

  it("lists every missing or malformed variable in one error", () => {
    expect(() =>
      parseEnv(
        publicEnvSchema,
        { NEXT_PUBLIC_SUPABASE_URL: "not-a-url" },
        "public",
      ),
    ).toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("does not leak unrelated variables into the parsed result", () => {
    const env = parseEnv(
      serverEnvSchema,
      {
        SUPABASE_SECRET_KEY: "sb_secret_test",
        APP_SECRET: "x".repeat(32),
        UNRELATED: "value",
      },
      "server",
    );
    expect(env).toEqual({
      SUPABASE_SECRET_KEY: "sb_secret_test",
      APP_SECRET: "x".repeat(32),
    });
  });

  it("treats empty integration keys as not configured and refuses live Stripe keys", () => {
    const base = { SUPABASE_SECRET_KEY: "s", APP_SECRET: "x".repeat(32) };
    expect(
      parseEnv(serverEnvSchema, { ...base, STRIPE_SECRET_KEY: "" }, "server")
        .STRIPE_SECRET_KEY,
    ).toBeUndefined();
    expect(() =>
      parseEnv(
        serverEnvSchema,
        { ...base, STRIPE_SECRET_KEY: "sk_live_123" },
        "server",
      ),
    ).toThrowError(/test-mode/);
  });
});
