import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/rules/[id]
 *
 * Partial update. Accepts any subset of:
 *   rule_type, scope, scope_value, instruction, predicate, priority,
 *   active, confidence
 *
 * Returns the updated row, or 404 if not found.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const updatable = [
      "rule_type",
      "scope",
      "scope_value",
      "instruction",
      "predicate",
      "priority",
      "active",
      "confidence",
    ];

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of updatable) {
      if (body[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        if (col === "predicate" && body[col] !== null) {
          values.push(JSON.stringify(body[col]));
        } else {
          values.push(body[col]);
        }
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    values.push(id);

    const result = await query(
      `UPDATE pascal_business_rules
          SET ${sets.join(", ")}
        WHERE id = $${idx}
        RETURNING id, rule_type, scope, scope_value, instruction, predicate,
                  priority, source, source_ref, confidence, active, created_by,
                  created_at, last_applied_at, apply_count`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "rule not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Rules PATCH error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/rules/[id]
 *
 * Soft delete — sets active=false instead of dropping the row. Preserves the
 * audit trail in pascal_rule_applications. To permanently remove, run SQL
 * directly.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const result = await query(
      `UPDATE pascal_business_rules
          SET active = false
        WHERE id = $1
        RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "rule not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Rules DELETE error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
