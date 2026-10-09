import { connection } from "next/server";

import { publicEnv } from "@/config/public-env";

type DependencyStatus = "ok" | "unreachable";

/** Liveness check for local development and deployment: the app is up and can reach Supabase. */
export async function GET() {
  // Always evaluate at request time; a prerendered health check would report stale status.
  await connection();

  const supabase = await checkSupabase();
  const healthy = supabase === "ok";

  return Response.json(
    { status: healthy ? "ok" : "degraded", dependencies: { supabase } },
    { status: healthy ? 200 : 503 },
  );
}

async function checkSupabase(): Promise<DependencyStatus> {
  try {
    const response = await fetch(
      `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`,
      {
        headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(3_000),
      },
    );
    return response.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}
