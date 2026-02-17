import { NextRequest, NextResponse } from "next/server";
import { fetchIntegrationData } from "@/lib/linear";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const data = await fetchIntegrationData(refresh);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Integrations API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch integration data" },
      { status: 500 }
    );
  }
}
