import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/replays/jobs?id=N
 *
 * Poll for completion of a replay job. Returns:
 *   { id, status, replay_id, error, replay: { ... result fields ... } }
 *
 * `replay` is populated once the job completes successfully — contains
 * the new answer and metadata.
 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const result = await query(
      `SELECT j.id, j.original_conversation_id, j.triggered_by, j.triggered_at,
              j.status AS job_status, j.replay_id, j.error AS job_error,
              r.status            AS replay_status,
              r.replayed_answer,
              r.replayed_tool_calls,
              r.replayed_rounds,
              r.replayed_latency_ms,
              r.error             AS replay_error,
              r.finished_at
         FROM pascal_replay_jobs j
         LEFT JOIN pascal_conversation_replays r ON r.id = j.replay_id
        WHERE j.id = $1`,
      [id],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Replay jobs GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
