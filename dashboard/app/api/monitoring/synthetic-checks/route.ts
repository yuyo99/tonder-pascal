import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const checkName = searchParams.get("check_name");
    const hours = parseInt(searchParams.get("hours") || "24", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

    const conditions: string[] = ["created_at >= now() - make_interval(hours => $1)"];
    const params: unknown[] = [hours];
    let idx = 2;

    if (checkName) { conditions.push(`check_name = $${idx}`); params.push(checkName); idx++; }

    const [runs, summary] = await Promise.all([
      query(
        `SELECT id, created_at, check_name, status, latency_ms, details
         FROM pascal_synthetic_check_runs
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT $${idx}`,
        [...params, limit],
      ),
      query(
        `SELECT check_name,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'pass') as pass_count,
                COUNT(*) FILTER (WHERE status = 'fail') as fail_count,
                AVG(latency_ms) as avg_latency_ms,
                MAX(created_at) as last_run_at
         FROM pascal_synthetic_check_runs
         WHERE created_at >= now() - make_interval(hours => $1)
         GROUP BY check_name
         ORDER BY check_name`,
        [hours],
      ),
    ]);

    return NextResponse.json({
      summary: summary.rows.map((r: any) => ({
        checkName: r.check_name,
        total: parseInt(r.total),
        passed: parseInt(r.pass_count),
        failed: parseInt(r.fail_count),
        avgLatencyMs: Math.round(parseFloat(r.avg_latency_ms) || 0),
        lastRunAt: r.last_run_at,
      })),
      runs: runs.rows.map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        checkName: r.check_name,
        status: r.status,
        latencyMs: r.latency_ms,
        details: r.details,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
