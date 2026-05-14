import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/rules/[id]/applications?limit=20
 *
 * Returns the last N rule applications for this rule, newest first.
 * Used by the /rules page's "apply history" expand row so you can see
 * which conversations this rule actually fired on.
 *
 * Response: { applications: [{ id, conversation_id, phase, outcome, applied_at }, ...] }
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
      `SELECT id, conversation_id, phase, outcome, applied_at
         FROM pascal_rule_applications
        WHERE rule_id = $1
        ORDER BY applied_at DESC
        LIMIT $2`,
      [id, limit],
    );

    return NextResponse.json({ applications: result.rows });
  } catch (err) {
    console.error("Rule applications GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
