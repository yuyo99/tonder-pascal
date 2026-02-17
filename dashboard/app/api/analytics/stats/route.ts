import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [totals, merchants] = await Promise.all([
      query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') as last_24h,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') as last_7d,
          COUNT(DISTINCT merchant_name) FILTER (WHERE created_at >= now() - interval '7 days') as active_merchants_7d
        FROM pascal_conversation_log
      `),
      query(`
        SELECT
          merchant_name,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') as last_7d,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') as last_24h,
          MAX(created_at) as last_question,
          ROUND(AVG(latency_ms)) as avg_latency_ms
        FROM pascal_conversation_log
        GROUP BY merchant_name
        ORDER BY last_7d DESC, total DESC
      `),
    ]);

    return NextResponse.json({
      summary: {
        total: parseInt(totals.rows[0].total),
        last24h: parseInt(totals.rows[0].last_24h),
        last7d: parseInt(totals.rows[0].last_7d),
        activeMerchants7d: parseInt(totals.rows[0].active_merchants_7d),
      },
      merchants: merchants.rows.map((r) => ({
        merchantName: r.merchant_name,
        total: parseInt(r.total),
        last7d: parseInt(r.last_7d),
        last24h: parseInt(r.last_24h),
        lastQuestion: r.last_question,
        avgLatencyMs: r.avg_latency_ms ? parseInt(r.avg_latency_ms) : null,
      })),
    });
  } catch (err) {
    console.error("Analytics stats error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
