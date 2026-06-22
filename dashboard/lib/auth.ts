/**
 * Pascal Concierge auth — business_id-bound HMAC session tokens.
 *
 * Token shape (base64url of JSON):
 *   { business_id: number, iat: number, exp: number }   .   <hmac>
 *
 * HMAC = HMAC-SHA256(secret, payload) via WebCrypto so it works in
 * the Edge runtime (middleware) as well as Node (API routes).
 * Secret comes from DASHBOARD_API_KEY. The same token shape can be
 * minted by Tonder's existing dashboard backend (same secret),
 * letting us replace the standalone login flow with SSO without
 * touching the verifier or downstream code.
 *
 * Login flow:
 *   1. User submits { business_id, access_key } via /api/auth/login.
 *   2. Server checks access_key === DASHBOARD_API_KEY and that
 *      business_id is a positive integer (deeper validity is verified
 *      by buildWebMerchantContext on the orchestrator side — we don't
 *      duplicate that lookup here).
 *   3. Server mints a token, sets HttpOnly cookie.
 *
 * Every gated request extracts business_id from the cookie, and that
 * becomes the only input to the merchant context resolver.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const COOKIE_NAME = "pascal_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getApiKey(): string {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) throw new Error("Missing DASHBOARD_API_KEY env var");
  return key;
}

export interface SessionPayload {
  business_id: number;
  iat: number;
  exp: number;
}

function b64urlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getApiKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return b64urlEncode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function mintToken(business_id: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    business_id,
    iat: now,
    exp: now + SESSION_MAX_AGE,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacSign(encoded);
  return `${encoded}.${sig}`;
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig) return null;
    const expected = await hmacSign(encoded);
    if (!timingSafeEqual(sig, expected)) return null;
    const payload = JSON.parse(b64urlDecodeToString(encoded)) as SessionPayload;
    if (typeof payload.business_id !== "number") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyAccessKey(accessKey: string): boolean {
  return accessKey === getApiKey();
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function readSessionFromRequest(
  req: NextRequest,
): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  const session = await readSessionFromRequest(req);
  if (!session) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return null;
}
