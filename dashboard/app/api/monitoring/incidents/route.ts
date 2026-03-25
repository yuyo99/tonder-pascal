import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") || "open";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

    const result = await query(
      `SELECT id, created_at, updated_at, status, severity, fingerprint,
              merchant_name, channel_id, first_seen_at, last_seen_at,
              occurrences, latest_details
       FROM pascal_incidents
       WHERE status = $1
       ORDER BY last_seen_at DESC
       LIMIT $2`,
      [status, limit],
    );

    return NextResponse.json({
      incidents: result.rows.map((r: any) => ({
        id: r.id,
        status: r.status,
        severity: r.severity,
        fingerprint: r.fingerprint,
        merchantName: r.merchant_name,
        channelId: r.channel_id,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        occurrences: r.occurrences,
        details: r.latest_details,
      })),
      total: result.rows.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
