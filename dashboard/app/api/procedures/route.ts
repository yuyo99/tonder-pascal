import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/procedures
 *
 * Optional filters: scope, active (true|false), search (instruction text).
 * Ordered: active first, by scope specificity, then most-recently-dispatched.
 *
 * Returns: { procedures: Procedure[] }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const scope = searchParams.get("scope");
    const active = searchParams.get("active");
    const search = searchParams.get("search");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (scope) {
      conditions.push(`scope = $${idx++}`);
      params.push(scope);
    }
    if (active === "true" || active === "false") {
      conditions.push(`active = $${idx++}`);
      params.push(active === "true");
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR steps_markdown ILIKE $${idx} OR intent_label ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT id, name, trigger_pattern, intent_label, steps_markdown,
              tool_bindings, required_inputs, success_criteria, scope,
              scope_value, active, owner, version, dispatch_count,
              last_dispatched_at, created_at, updated_at
         FROM pascal_procedures
         ${where}
         ORDER BY active DESC,
                  CASE scope
                    WHEN 'channel' THEN 1
                    WHEN 'merchant' THEN 2
                    WHEN 'global' THEN 3
                  END,
                  last_dispatched_at DESC NULLS LAST,
                  created_at DESC`,
      params,
    );

    return NextResponse.json({ procedures: result.rows });
  } catch (err) {
    console.error("Procedures GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
