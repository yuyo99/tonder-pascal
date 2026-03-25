import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [heartbeat, recentIncidents, recentQA] = await Promise.all([
      query(`SELECT service_name, last_seen_at, meta FROM pascal_health_heartbeats`),
      query(`SELECT COUNT(*) as count FROM pascal_incidents WHERE status = 'open'`),
      query(`
        SELECT status, COUNT(*) as count
        FROM pascal_self_qa_events
        WHERE created_at >= now() - interval '1 hour'
        GROUP BY status
      `),
    ]);

    const hb = heartbeat.rows[0];
    const ageMs = hb ? Date.now() - new Date(hb.last_seen_at).getTime() : null;

    return NextResponse.json({
      status: hb && ageMs !== null && ageMs < 180000 ? "healthy" : "unhealthy",
      heartbeat: hb
        ? {
            serviceName: hb.service_name,
            lastSeenAt: hb.last_seen_at,
            ageSeconds: ageMs !== null ? Math.round(ageMs / 1000) : null,
            meta: hb.meta,
          }
        : null,
      openIncidents: parseInt(recentIncidents.rows[0]?.count ?? "0"),
      lastHourQA: Object.fromEntries(
        recentQA.rows.map((r: any) => [r.status, parseInt(r.count)])
      ),
    });
  } catch (err) {
    return NextResponse.json({ status: "error", error: String(err) }, { status: 500 });
  }
}
