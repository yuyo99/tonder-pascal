import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status"); // ok | warning | critical
    const messageType = searchParams.get("message_type");
    const channelId = searchParams.get("channel_id");
    const hours = parseInt(searchParams.get("hours") || "24", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

    const conditions: string[] = ["created_at >= now() - make_interval(hours => $1)"];
    const params: unknown[] = [hours];
    let idx = 2;

    if (status) { conditions.push(`status = $${idx}`); params.push(status); idx++; }
    if (messageType) { conditions.push(`message_type = $${idx}`); params.push(messageType); idx++; }
    if (channelId) { conditions.push(`channel_id = $${idx}`); params.push(channelId); idx++; }

    const [events, stats] = await Promise.all([
      query(
        `SELECT id, created_at, platform, channel_id, merchant_name, business_id,
                message_type, status, latency_ms, parse_confidence, answer_confidence,
                fallback_used, responded, failure_reason, details
         FROM pascal_self_qa_events
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT $${idx}`,
        [...params, limit],
      ),
      query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'ok') as ok_count,
           COUNT(*) FILTER (WHERE status = 'warning') as warning_count,
           COUNT(*) FILTER (WHERE status = 'critical') as critical_count,
           AVG(latency_ms) as avg_latency_ms,
           COUNT(*) FILTER (WHERE responded = false) as no_response_count
         FROM pascal_self_qa_events
         WHERE created_at >= now() - make_interval(hours => $1)`,
        [hours],
      ),
    ]);

    const s = stats.rows[0];
    return NextResponse.json({
      stats: {
        total: parseInt(s.total),
        ok: parseInt(s.ok_count),
        warnings: parseInt(s.warning_count),
        critical: parseInt(s.critical_count),
        avgLatencyMs: Math.round(parseFloat(s.avg_latency_ms) || 0),
        noResponseCount: parseInt(s.no_response_count),
      },
      events: events.rows.map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        platform: r.platform,
        channelId: r.channel_id,
        merchantName: r.merchant_name,
        messageType: r.message_type,
        status: r.status,
        latencyMs: r.latency_ms,
        responded: r.responded,
        fallbackUsed: r.fallback_used,
        failureReason: r.failure_reason,
        details: r.details,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
