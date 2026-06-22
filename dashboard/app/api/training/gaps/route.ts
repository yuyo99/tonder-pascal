export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") || "pending";

  const result = await query(
    `SELECT id, question, channel_id, platform, merchant_name, business_id,
            frequency, status, suggested_category, detected_at, updated_at
     FROM pascal_knowledge_gaps
     WHERE status = $1
     ORDER BY frequency DESC, detected_at DESC
     LIMIT 100`,
    [status]
  );

  return NextResponse.json({ gaps: result.rows });
}
