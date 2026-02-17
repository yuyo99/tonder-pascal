import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await query(
      `SELECT * FROM pascal_conversation_log WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const r = result.rows[0];
    return NextResponse.json({
      id: r.id,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      platform: r.platform,
      channelId: r.channel_id,
      userName: r.user_name,
      question: r.question,
      answer: r.answer,
      toolCalls: r.tool_calls,
      rounds: r.rounds,
      latencyMs: r.latency_ms,
      ticketId: r.ticket_id,
      error: r.error,
      createdAt: r.created_at,
    });
  } catch (err) {
    console.error("Conversation detail error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
