import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/replays/[id]
 *
 * Single replay detail joined to its original conversation. Used by the
 * /replays/[id] comparison view.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const result = await query(
      `SELECT r.id, r.original_conversation_id, r.started_at, r.finished_at,
              r.status, r.replayed_answer, r.replayed_tool_calls,
              r.replayed_rounds, r.replayed_latency_ms, r.error,
              r.triggered_by,
              c.question         AS original_question,
              c.answer           AS original_answer,
              c.tool_calls       AS original_tool_calls,
              c.rounds           AS original_rounds,
              c.latency_ms       AS original_latency_ms,
              c.merchant_name    AS original_merchant,
              c.platform         AS original_platform,
              c.channel_id       AS original_channel_id,
              c.user_name        AS original_user_name,
              c.created_at       AS original_created_at
         FROM pascal_conversation_replays r
         LEFT JOIN pascal_conversation_log c ON c.id = r.original_conversation_id
        WHERE r.id = $1`,
      [id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "replay not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Replay GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
