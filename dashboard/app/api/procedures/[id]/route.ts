import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/procedures/[id]
 *
 * Partial update — accepts any subset of: name, trigger_pattern,
 * intent_label, steps_markdown, tool_bindings, required_inputs,
 * success_criteria, scope, scope_value, active, owner.
 * Bumps version on every change. Returns the updated row.
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
      "trigger_pattern",
      "intent_label",
      "steps_markdown",
      "tool_bindings",
      "required_inputs",
      "success_criteria",
      "scope",
      "scope_value",
      "active",
      "owner",
    ];

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of updatable) {
      if (body[col] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        if (
          (col === "tool_bindings" || col === "required_inputs") &&
          body[col] !== null
        ) {
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
    sets.push(`version = version + 1`);
    values.push(id);

    const result = await query(
      `UPDATE pascal_procedures
          SET ${sets.join(", ")}
        WHERE id = $${idx}
        RETURNING id, name, trigger_pattern, intent_label, steps_markdown,
                  tool_bindings, required_inputs, success_criteria, scope,
                  scope_value, active, owner, version, dispatch_count,
                  last_dispatched_at, created_at, updated_at`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "procedure not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Procedures PATCH error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
