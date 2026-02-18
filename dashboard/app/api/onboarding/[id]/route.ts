import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await query(
      `SELECT o.*, mc.label AS merchant_channel_label
       FROM pascal_onboardings o
       LEFT JOIN pascal_merchant_channels mc ON mc.id = o.merchant_channel_id
       WHERE o.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Onboarding GET [id] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Simple text/string fields
    for (const field of [
      "name", "type", "owner", "notes", "status", "priority",
      "contact_name", "contact_email", "contact_phone", "integration_model",
    ]) {
      if (body[field] !== undefined) {
        sets.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }

    // Nullable fields (target_date, merchant_channel_id)
    if (body.target_date !== undefined) {
      sets.push(`target_date = $${idx++}`);
      values.push(body.target_date || null);
    }
    if (body.merchant_channel_id !== undefined) {
      sets.push(`merchant_channel_id = $${idx++}`);
      values.push(body.merchant_channel_id || null);
    }

    // JSONB deep merge for phases
    if (body.phases !== undefined) {
      sets.push(`phases = phases || $${idx++}::jsonb`);
      values.push(JSON.stringify(body.phases));
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
      `UPDATE pascal_onboardings
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
    console.error("Onboarding PUT error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await query(
      `DELETE FROM pascal_onboardings WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Onboarding DELETE error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
