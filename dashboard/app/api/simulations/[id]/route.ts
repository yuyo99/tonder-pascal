import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/simulations/[id]
 *
 * Partial update — accepts any subset of: name, scenario_description,
 * customer_persona, opening_message, max_turns, expected_outcome,
 * success_criteria, active, owner.
 *
 * Bumps updated_at.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const updatable = [
      "name",
      "scenario_description",
      "customer_persona",
      "opening_message",
      "max_turns",
      "expected_outcome",
      "success_criteria",
      "active",
      "owner",
    ];

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of updatable) {
      if (body[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        if (col === "success_criteria" && Array.isArray(body[col])) {
          values.push(JSON.stringify(body[col]));
        } else {
          values.push(body[col]);
        }
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const result = await query(
      `UPDATE pascal_simulations
          SET ${sets.join(", ")}
        WHERE id = $${idx}
        RETURNING id, name, procedure_id, scenario_description, customer_persona,
                  opening_message, max_turns, expected_outcome, success_criteria,
                  merchant_business_id, test_channel_id, last_run_at, last_result,
                  last_failure_reason, consecutive_failures, active, owner,
                  created_at, updated_at`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "simulation not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Simulations PATCH error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
