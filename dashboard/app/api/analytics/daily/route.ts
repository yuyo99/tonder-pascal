import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/daily?days=30
 *
 * Returns one row per calendar day (Mexico City) for the last N days,
 * including zero-count days so the Overview sparkline stays gap-free.
 *
 * Response: { daily: [{ date: "2026-04-13", count: 12 }, ...] }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days") ?? "30";
  const days = Math.max(1, Math.min(parseInt(daysParam, 10) || 30, 365));

  try {
    // generate_series gives us every date in the window so days with zero
    // conversations still appear in the output (count = 0). LEFT JOIN against
    // the day-bucketed conversation log fills the actual counts.
    const result = await query(
      `
        WITH days AS (
          SELECT (date_trunc('day', now() AT TIME ZONE 'America/Mexico_City')
                  - (g || ' days')::interval)::date AS date
          FROM generate_series(0, $1 - 1) AS g
        ),
        counts AS (
          SELECT
            date_trunc('day', created_at AT TIME ZONE 'America/Mexico_City')::date AS date,
            COUNT(*)::int AS count
          FROM pascal_conversation_log
          WHERE created_at > now() - ($1 || ' days')::interval
          GROUP BY 1
        )
        SELECT d.date::text AS date, COALESCE(c.count, 0)::int AS count
        FROM days d
        LEFT JOIN counts c USING (date)
        ORDER BY d.date ASC;
      `,
      [days],
    );

    return NextResponse.json({
      daily: result.rows.map((r) => ({
        date: r.date,
        count: typeof r.count === "number" ? r.count : parseInt(r.count, 10),
      })),
    });
  } catch (err) {
    console.error("Analytics daily error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
