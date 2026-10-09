import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { userDb } from "../db/user-client";

/**
 * Who is signed in, and in what capacity: staff of a business, a cleaner, or a client. Read once per request
 * from the session cookie (the proxy keeps it fresh); every page and action that needs a user calls one of
 * the require* helpers, and the database's row-level security applies to everything they read.
 */

type TenantRef = {
  tenantId: string;
  slug: string;
  name: string;
  timezone: string;
};

export type StaffContext = TenantRef & {
  role: "owner" | "dispatcher" | "cleaner";
};
export type ClientContext = TenantRef & { clientId: string; fullName: string };

export type Viewer = {
  userId: string;
  email: string;
  staff: StaffContext | null;
  client: ClientContext | null;
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Signed-in pages render per request: the session check compares token expiry with the current time,
  // which a prerendered (or prefetched) shell must not do.
  await connection();
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;

  const [memberships, clients] = await Promise.all([
    db
      .from("memberships")
      .select("tenant_id, role, tenant:tenants!inner(slug, name, timezone)")
      .eq("user_id", userId),
    db
      .from("clients")
      .select("id, tenant_id, full_name, tenant:tenants!inner(slug, name, timezone)")
      .eq("user_id", userId),
  ]);

  const membership = memberships.data?.[0];
  const client = clients.data?.[0];
  return {
    userId,
    email: String(data.claims.email ?? ""),
    staff: membership
      ? {
          tenantId: membership.tenant_id,
          role: membership.role,
          ...membership.tenant,
        }
      : null,
    client: client
      ? {
          tenantId: client.tenant_id,
          clientId: client.id,
          fullName: client.full_name,
          ...client.tenant,
        }
      : null,
  };
});

/** Where a signed-in user belongs. */
export function homeFor(viewer: Viewer): string {
  if (viewer.staff?.role === "cleaner") return "/crew";
  if (viewer.staff) return "/admin";
  return "/portal";
}

export async function requireClient(next = "/portal"): Promise<Viewer & { client: ClientContext }> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!viewer.client) redirect(viewer.staff ? homeFor(viewer) : "/login?error=no-client");
  return viewer as Viewer & { client: ClientContext };
}

export async function requireStaff(next = "/admin"): Promise<Viewer & { staff: StaffContext }> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!viewer.staff || viewer.staff.role === "cleaner") redirect(homeFor(viewer));
  return viewer as Viewer & { staff: StaffContext };
}

export async function requireCleaner(next = "/crew"): Promise<Viewer & { staff: StaffContext }> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (viewer.staff?.role !== "cleaner") redirect(homeFor(viewer));
  return viewer as Viewer & { staff: StaffContext };
}
