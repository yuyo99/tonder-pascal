import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`name ILIKE $${idx}`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT * FROM pascal_onboardings ${where} ORDER BY created_at DESC`,
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
    const { name, type, owner, notes } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO pascal_onboardings (name, type, owner, notes, phases, status)
       VALUES ($1, $2, $3, $4, '{}', 'not_started')
       RETURNING *`,
      [name.trim(), type || "merchant", owner || "", notes || ""]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Onboarding POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
