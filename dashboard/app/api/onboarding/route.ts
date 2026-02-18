import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const priority = searchParams.get("priority") || "";
    const owner = searchParams.get("owner") || "";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`o.name ILIKE $${idx}`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) {
      conditions.push(`o.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (priority) {
      conditions.push(`o.priority = $${idx}`);
      params.push(priority);
      idx++;
    }
    if (owner) {
      conditions.push(`o.owner ILIKE $${idx}`);
      params.push(`%${owner}%`);
      idx++;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT o.*, mc.label AS merchant_channel_label
       FROM pascal_onboardings o
       LEFT JOIN pascal_merchant_channels mc ON mc.id = o.merchant_channel_id
       ${where}
       ORDER BY o.created_at DESC`,
      params
    );

    return NextResponse.json({ onboardings: result.rows });
  } catch (err) {
    console.error("Onboarding GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, type, owner, notes, priority, target_date,
            contact_name, contact_email, contact_phone,
            merchant_channel_id, integration_model } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO pascal_onboardings
       (name, type, owner, notes, phases, status, priority, target_date,
        contact_name, contact_email, contact_phone, merchant_channel_id, integration_model)
       VALUES ($1, $2, $3, $4, '{}', 'not_started', $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        name.trim(),
        type || "merchant",
        owner || "",
        notes || "",
        priority || "normal",
        target_date || null,
        contact_name || "",
        contact_email || "",
        contact_phone || "",
        merchant_channel_id || null,
        integration_model || "",
      ]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Onboarding POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
