import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/replays?conversation_id=X&limit=20
 *
 * If conversation_id is given, lists replays for that specific original
 * conversation (newest first). Without it, lists ALL recent replays
 * across the system — the index view.
 *
 * Returns: { replays: Replay[] }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const convId = searchParams.get("conversation_id");
    const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 200));

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (convId) {
      conditions.push(`r.original_conversation_id = $${idx++}`);
      params.push(convId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);

    const result = await query(
      `SELECT r.id, r.original_conversation_id, r.started_at, r.finished_at,
              r.status, r.replayed_answer, r.replayed_tool_calls,
              r.replayed_rounds, r.replayed_latency_ms, r.error,
              r.triggered_by,
              c.question         AS original_question,
              c.answer           AS original_answer,
              c.merchant_name    AS original_merchant,
              c.platform         AS original_platform,
              c.created_at       AS original_created_at
         FROM pascal_conversation_replays r
         LEFT JOIN pascal_conversation_log c ON c.id = r.original_conversation_id
         ${where}
         ORDER BY r.started_at DESC
         LIMIT $${idx}`,
      params,
    );

    return NextResponse.json({ replays: result.rows });
  } catch (err) {
    console.error("Replays GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/replays
 *
 * Enqueue a replay job for an existing conversation. The backend's replay
 * poller (every 10s) claims it and runs handleIncomingMessage in-process.
 *
 * Body: { conversation_id: uuid, triggered_by?: string }
 * Returns: { jobId, status }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const conversationId = body.conversation_id;
    const triggeredBy = body.triggered_by ?? "dashboard";

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
    }

    // Verify the conversation exists before queuing — avoids creating jobs
    // that will just fail on the runner side.
    const check = await query(
      `SELECT id FROM pascal_conversation_log WHERE id = $1`,
      [conversationId],
    );
    if (check.rowCount === 0) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    const result = await query(
      `INSERT INTO pascal_replay_jobs (original_conversation_id, triggered_by)
       VALUES ($1, $2)
       RETURNING id, status, triggered_at`,
      [conversationId, triggeredBy],
    );

    return NextResponse.json(
      { jobId: result.rows[0].id, status: result.rows[0].status },
      { status: 201 },
    );
  } catch (err) {
    console.error("Replays POST error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
