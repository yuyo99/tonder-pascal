import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/simulations
 *
 * Optional filters: active=true|false, procedure_id=N, result=pass|fail|partial,
 * search (matches name, scenario_description, customer_persona).
 * Ordered: failing first, then by last_run_at DESC.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const active = searchParams.get("active");
    const procedureId = searchParams.get("procedure_id");
    const result = searchParams.get("result");
    const search = searchParams.get("search");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (active === "true" || active === "false") {
      conditions.push(`s.active = $${idx++}`);
      params.push(active === "true");
    }
    if (procedureId) {
      conditions.push(`s.procedure_id = $${idx++}`);
      params.push(parseInt(procedureId, 10));
    }
    if (result) {
      conditions.push(`s.last_result = $${idx++}`);
      params.push(result);
    }
    if (search) {
      conditions.push(
        `(s.name ILIKE $${idx} OR s.scenario_description ILIKE $${idx} OR s.customer_persona ILIKE $${idx})`,
      );
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sims = await query(
      `SELECT s.id, s.name, s.procedure_id, s.scenario_description,
              s.customer_persona, s.opening_message, s.max_turns,
              s.expected_outcome, s.success_criteria,
              s.merchant_business_id, s.test_channel_id,
              s.last_run_at, s.last_result, s.last_failure_reason,
              s.consecutive_failures, s.active, s.owner, s.created_at,
              s.updated_at,
              p.name AS procedure_name
         FROM pascal_simulations s
         LEFT JOIN pascal_procedures p ON p.id = s.procedure_id
         ${where}
         ORDER BY
           CASE s.last_result
             WHEN 'fail'    THEN 1
             WHEN 'error'   THEN 2
             WHEN 'partial' THEN 3
             WHEN 'pass'    THEN 4
             ELSE 5
           END,
           s.last_run_at DESC NULLS LAST,
           s.id`,
      params,
    );

    return NextResponse.json({ simulations: sims.rows });
  } catch (err) {
    console.error("Simulations GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
