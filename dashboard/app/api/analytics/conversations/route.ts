import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const merchant = searchParams.get("merchant") || "";
    const search = searchParams.get("search") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "30"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (merchant) {
      conditions.push(`merchant_name = $${idx++}`);
      params.push(merchant);
    }

    if (search) {
      conditions.push(`question ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows, countResult] = await Promise.all([
      query(
        `SELECT id, merchant_name, platform, channel_id, user_name, question,
                LEFT(answer, 200) as answer_preview, tool_calls, rounds,
                latency_ms, error, created_at
         FROM pascal_conversation_log
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) FROM pascal_conversation_log ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      conversations: rows.rows.map((r) => ({
        id: r.id,
        merchantName: r.merchant_name,
        platform: r.platform,
        channelId: r.channel_id,
        userName: r.user_name,
        question: r.question,
        answerPreview: r.answer_preview,
        toolCalls: r.tool_calls,
        rounds: r.rounds,
        latencyMs: r.latency_ms,
        error: r.error,
        createdAt: r.created_at,
      })),
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error("Conversations list error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
