import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const source = searchParams.get("source");
    const severity = searchParams.get("severity");
    const search = searchParams.get("search");
    const hours = parseInt(searchParams.get("hours") || "24", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 500);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Build dynamic WHERE clauses
    const conditions: string[] = [
      "created_at >= now() - make_interval(hours => $1)",
    ];
    const params: unknown[] = [hours];
    let idx = 2;

    if (source) {
      conditions.push(`source = $${idx}`);
      params.push(source);
      idx++;
    }
    if (severity) {
      conditions.push(`severity = $${idx}`);
      params.push(severity);
      idx++;
    }
    if (search) {
      conditions.push(`message ILIKE $${idx}`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(" AND ");

    // Run stats + list + total in parallel
    const [statsResult, logsResult, totalResult, sourcesResult] =
      await Promise.all([
        query(
          `SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '1 hour') as last_1h,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') as last_24h,
            COUNT(DISTINCT source) as sources_affected,
            COUNT(*) FILTER (WHERE severity = 'fatal') as fatal_count
          FROM pascal_error_logs
          WHERE created_at >= now() - make_interval(hours => $1)`,
          [hours]
        ),
        query(
          `SELECT id, source, severity, message, stack, context, created_at
          FROM pascal_error_logs
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset]
        ),
        query(
          `SELECT COUNT(*) as count FROM pascal_error_logs WHERE ${where}`,
          params
        ),
        query(
          `SELECT source, COUNT(*) as count
          FROM pascal_error_logs
          WHERE created_at >= now() - make_interval(hours => $1)
          GROUP BY source
          ORDER BY count DESC`,
          [hours]
        ),
      ]);

    const stats = statsResult.rows[0];

    return NextResponse.json({
      stats: {
        total: parseInt(stats.total),
        last1h: parseInt(stats.last_1h),
        last24h: parseInt(stats.last_24h),
        sourcesAffected: parseInt(stats.sources_affected),
        fatalCount: parseInt(stats.fatal_count),
      },
      sources: sourcesResult.rows.map((r) => ({
        source: r.source,
        count: parseInt(r.count),
      })),
      errors: logsResult.rows.map((r) => ({
        id: r.id,
        source: r.source,
        severity: r.severity,
        message: r.message,
        stack: r.stack,
        context: r.context,
        createdAt: r.created_at,
      })),
      pagination: {
        total: parseInt(totalResult.rows[0].count),
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error("Monitoring API error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
