import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/rules
 *
 * Query params (all optional):
 *   rule_type      'behavioral' | 'parsing' | 'escalation' | 'tone'
 *   scope          'global' | 'merchant' | 'channel' | 'bot'
 *   scope_value    free text — exact match
 *   priority       'hard' | 'soft'
 *   active         'true' | 'false' (omit for all)
 *   source         'manual' | 'auto:correction' | 'auto:pattern'
 *   search         ILIKE across instruction
 *
 * Default ordering: active first, hard before soft, newest first.
 * Returns: { rules: BusinessRule[] }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const filters: Record<string, string | null> = {
      rule_type: searchParams.get("rule_type"),
      scope: searchParams.get("scope"),
      scope_value: searchParams.get("scope_value"),
      priority: searchParams.get("priority"),
      source: searchParams.get("source"),
    };
    const active = searchParams.get("active");
    const search = searchParams.get("search");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [col, val] of Object.entries(filters)) {
      if (val) {
        conditions.push(`${col} = $${idx++}`);
        params.push(val);
      }
    }
    if (active === "true" || active === "false") {
      conditions.push(`active = $${idx++}`);
      params.push(active === "true");
    }
    if (search) {
      conditions.push(`instruction ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT id, rule_type, scope, scope_value, instruction, predicate,
              priority, source, source_ref, confidence, active, created_by,
              created_at, last_applied_at, apply_count
         FROM pascal_business_rules
         ${where}
         ORDER BY active DESC,
                  CASE priority WHEN 'hard' THEN 1 WHEN 'soft' THEN 2 END,
                  created_at DESC`,
      params,
    );

    return NextResponse.json({ rules: result.rows });
  } catch (err) {
    console.error("Rules GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/rules
 *
 * Body:
 *   { rule_type, scope, scope_value?, instruction, predicate?,
 *     priority, source?, created_by? }
 *
 * source defaults to 'manual', active defaults to true.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      rule_type,
      scope,
      scope_value = null,
      instruction,
      predicate = null,
      priority = "soft",
      source = "manual",
      source_ref = null,
      created_by = null,
      active = true,
    } = body;

    if (!rule_type || !scope || !instruction) {
      return NextResponse.json(
        { error: "rule_type, scope, and instruction are required" },
        { status: 400 },
      );
    }
    if (scope !== "global" && !scope_value) {
      return NextResponse.json(
        { error: "scope_value is required when scope is not 'global'" },
        { status: 400 },
      );
    }

    const result = await query(
      `INSERT INTO pascal_business_rules
        (rule_type, scope, scope_value, instruction, predicate,
         priority, source, source_ref, created_by, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, rule_type, scope, scope_value, instruction, predicate,
                 priority, source, source_ref, confidence, active, created_by,
                 created_at, last_applied_at, apply_count`,
      [
        rule_type,
        scope,
        scope === "global" ? null : scope_value,
        instruction,
        predicate ? JSON.stringify(predicate) : null,
        priority,
        source,
        source_ref,
        created_by,
        active,
      ],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Rules POST error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
