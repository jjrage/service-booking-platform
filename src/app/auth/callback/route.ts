import { NextResponse, type NextRequest } from "next/server";

import { adminDb } from "@/server/db/admin";
import { userDb } from "@/server/db/user-client";

/**
 * Where a magic link lands. Exchanges the one-time code for a session, then links the user to the client
 * records with their e-mail (the link proved they own it), so the portal shows their bookings.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/portal";
  const target = /^\/(?!\/)/.test(next) ? next : "/portal";

  if (code) {
    const db = await userDb();
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    if (!error && data.user?.email) {
      await adminDb().rpc("cmd_link_client_account", {
        p_user_id: data.user.id,
        p_email: data.user.email,
      });
      return NextResponse.redirect(new URL(target, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
