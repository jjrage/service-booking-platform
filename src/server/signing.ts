import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/config/server-env";

/**
 * HMAC signatures for values the server hands to a browser and must get back unchanged: the link a guest
 * uses to see their booking, and the slot-hold cookie.
 */

function mac(purpose: string, value: string): string {
  return createHmac("sha256", serverEnv.APP_SECRET)
    .update(`${purpose}:${value}`)
    .digest("base64url");
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The token in a guest's booking link: proves they received the link, without an account. */
export function bookingAccessToken(bookingId: string): string {
  return mac("booking", bookingId).slice(0, 32);
}

export function verifyBookingAccessToken(
  bookingId: string,
  token: string | undefined,
): boolean {
  return (
    typeof token === "string" && same(bookingAccessToken(bookingId), token)
  );
}

/** A JSON payload with a signature, for cookies. */
export function sealJson(purpose: string, payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(purpose, body)}`;
}

export function openJson<T>(
  purpose: string,
  sealed: string | undefined,
): T | null {
  if (!sealed) return null;
  const [body, signature] = sealed.split(".");
  if (!body || !signature || !same(mac(purpose, body), signature)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}
