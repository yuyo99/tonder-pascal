import { NextRequest, NextResponse } from "next/server";
import { verifyAccessKey, mintToken, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accessKey: string | undefined = body.access_key ?? body.password;
    const businessIdRaw = body.business_id;

    if (!accessKey) {
      return NextResponse.json({ error: "Access key required" }, { status: 400 });
    }
    if (!verifyAccessKey(accessKey)) {
      return NextResponse.json({ error: "Invalid access key" }, { status: 401 });
    }

    const businessId = Number(businessIdRaw);
    if (!Number.isFinite(businessId) || businessId <= 0) {
      return NextResponse.json({ error: "Valid business_id required" }, { status: 400 });
    }

    const token = await mintToken(businessId);
    const res = NextResponse.json({ ok: true, business_id: businessId });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
