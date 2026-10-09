"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { appUrl } from "@/config/public-env";
import { demoAccounts, demoPassword, type DemoRole } from "@/server/auth/demo";
import { adminDb } from "@/server/db/admin";
import { userDb } from "@/server/db/user-client";

/** A same-site path to continue to after signing in; anything else falls back to the user's home. */
function safeNext(next: unknown): string | null {
  return typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : null;
}

/** The section a user belongs in: admin for staff, the crew app for cleaners, otherwise the portal. */
async function homeOf(userId: string): Promise<string> {
  const { data } = await adminDb()
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (data?.role === "cleaner") return "/crew";
  if (data) return "/admin";
  return "/portal";
}

export type SignInState = { error?: string; sent?: string } | undefined;

const passwordSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function signInWithPassword(
  _state: SignInState,
  form: FormData,
): Promise<SignInState> {
  const parsed = passwordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your e-mail and password." };

  const db = await userDb();
  const { data, error } = await db.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) return { error: "Wrong e-mail or password." };
  redirect(safeNext(parsed.data.next) ?? (await homeOf(data.user.id)));
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  next: z.string().optional(),
});

/**
 * Sends a one-time sign-in link. Only addresses the businesses know (clients or staff) get one, but the
 * answer is the same either way, so the form does not reveal who is a client.
 */
export async function sendMagicLink(_state: SignInState, form: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter a valid e-mail address." };
  const { email } = parsed.data;

  const { count } = await adminDb()
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("email", email);
  if ((count ?? 0) > 0) {
    const next = safeNext(parsed.data.next) ?? "/portal";
    const db = await userDb();
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error)
      return {
        error: "We could not send the link right now. Try again in a minute.",
      };
  }
  return { sent: email };
}

export async function signInAsDemo(role: DemoRole): Promise<SignInState> {
  const account = demoAccounts[role];
  const password = demoPassword();
  if (!account || !password) return { error: "Demo sign-in is not configured." };

  const db = await userDb();
  const { data, error } = await db.auth.signInWithPassword({
    email: account.email,
    password,
  });
  if (error || !data.user) return { error: "Demo sign-in failed. Has the demo data been seeded?" };
  redirect(await homeOf(data.user.id));
}

export async function signOut(): Promise<void> {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/login");
}
