import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const allowedFields = [
      "category",
      "match_pattern",
      "title",
      "content",
      "action",
      "priority",
      "is_active",
    ];

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        sets.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }

    if (sets.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const result = await query(
      `UPDATE pascal_knowledge_base
       SET ${sets.join(", ")}
       WHERE id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Memory PUT error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Soft delete — set is_active = false
    const result = await query(
      `UPDATE pascal_knowledge_base
       SET is_active = false, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Memory DELETE error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
