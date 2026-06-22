import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/auth";
import { Pool } from "pg";

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("Missing DATABASE_URL/POSTGRES_URL");
    pool = new Pool({ connectionString: url, max: 4 });
  }
  return pool;
}

export async function GET(req: NextRequest) {
  const session = await readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const channelId = `web:${session.business_id}`;
    const result = await getPool().query(
      `SELECT id, question, answer, latency_ms, rounds, tool_calls, created_at
       FROM pascal_conversation_log
       WHERE platform = 'web' AND channel_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [channelId],
    );
    return NextResponse.json({ conversations: result.rows });
  } catch (err) {
    console.error("activity fetch error:", err);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}
