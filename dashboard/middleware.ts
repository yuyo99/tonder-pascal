import { NextRequest } from "next/server";
import { requireAuth } from "./lib/auth";

export function middleware(req: NextRequest) {
  if (
    req.nextUrl.pathname === "/login" ||
    req.nextUrl.pathname === "/api/auth/login"
  ) {
    return;
  }

  return requireAuth(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
