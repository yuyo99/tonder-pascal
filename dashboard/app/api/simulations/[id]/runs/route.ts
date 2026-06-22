import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/simulations/[id]/runs?limit=20
 *
 * Returns recent runs for a sim, newest first.
 * Each row includes the full transcript + judge_criteria for the
 * expand-row view on /simulations.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const limitParam = req.nextUrl.searchParams.get("limit") ?? "20";
    const limit = Math.max(1, Math.min(parseInt(limitParam, 10) || 20, 200));

    const result = await query(
      `SELECT id, simulation_id, started_at, finished_at, result, judge_summary,
              judge_criteria, transcript, turns, latency_ms, error,
              linear_ticket, triggered_by
         FROM pascal_simulation_runs
        WHERE simulation_id = $1
        ORDER BY started_at DESC
        LIMIT $2`,
      [id, limit],
    );

    return NextResponse.json({ runs: result.rows });
  } catch (err) {
    console.error("Simulation runs GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
