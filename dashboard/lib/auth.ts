/**
 * Simple shared-password auth using a cookie token.
 * Validates against DASHBOARD_API_KEY env var.
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

export function verifyPassword(password: string): boolean {
  return password === getApiKey();
}

export function generateToken(): string {
  const ts = Date.now().toString(36);
  const key = getApiKey();
  const raw = `${key.slice(0, 8)}:${ts}`;
  return Buffer.from(raw).toString("base64");
}

function validateToken(token: string): boolean {
  try {
    const raw = Buffer.from(token, "base64").toString("utf-8");
    const [prefix] = raw.split(":");
    return prefix === getApiKey().slice(0, 8);
  } catch {
    return false;
  }
}

export async function login(password: string): Promise<boolean> {
  if (password !== getApiKey()) return false;

  const token = generateToken();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return true;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return validateToken(token);
}

export function requireAuth(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token || !validateToken(token)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return null;
}
