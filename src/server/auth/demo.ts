import "server-only";

import { publicEnv } from "@/config/public-env";
import { serverEnv } from "@/config/server-env";

/**
 * The demo accounts behind the "Log in as …" buttons. Their password lives only in the server environment;
 * against a local database a fixed one is used (the seed sets the same).
 */
export const demoAccounts = {
  client: {
    email: "emily.thornton@mail.example",
    label: "Client",
    name: "Emily Thornton",
  },
  owner: {
    email: "owner@wrenfield.example",
    label: "Owner",
    name: "Lauren Mercer",
  },
  dispatcher: {
    email: "dispatch@wrenfield.example",
    label: "Dispatcher",
    name: "Marcus Hill",
  },
  cleaner: {
    email: "ana@wrenfield.example",
    label: "Cleaner",
    name: "Ana Ramirez, Crew Blue",
  },
} as const;

export type DemoRole = keyof typeof demoAccounts;

const isLocalDatabase = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL,
);

export function demoPassword(): string | null {
  return serverEnv.DEMO_USER_PASSWORD ?? (isLocalDatabase ? "wrenfield-local-demo" : null);
}
