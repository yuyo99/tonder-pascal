import { NextRequest } from "next/server";
import { requireAuth } from "./lib/auth";

// Paths that must NOT be auth-gated — login flow + Next.js auto-emitted
// favicon route. Anything else with a static file extension (svg/png/etc.)
// is matched by the regex below so brand assets in /public stay public.
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/icon", // Next.js App Router auto-emits this from app/icon.svg
]);

const STATIC_ASSET_RE = /\.(svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml|woff2?)$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || STATIC_ASSET_RE.test(pathname)) {
    return;
  }

  return requireAuth(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
