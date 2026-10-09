import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/config/public-env";
import type { Database } from "@/db/database.types";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * The signed-in user's Supabase client in the browser, used only where data goes straight to Supabase under
 * its own policies (uploading job photos to storage). Everything else goes through the app server.
 */
export function browserDb() {
  client ??= createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return client;
}
