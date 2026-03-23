import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get("type") || "";
    const search = searchParams.get("search") || "";
    const domain = searchParams.get("domain") || "";
    const merchantChannelId = searchParams.get("merchant_channel_id") || "";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (type) {
      conditions.push(`p.type = $${idx++}`);
      params.push(type);
    }
    if (domain) {
      conditions.push(`p.domain = $${idx++}`);
      params.push(domain);
    }
    if (merchantChannelId) {
      conditions.push(`p.merchant_channel_id = $${idx++}`);
      params.push(Number(merchantChannelId));
    }
    if (search) {
      conditions.push(
        `(p.name ILIKE $${idx} OR p.company ILIKE $${idx} OR p.role ILIKE $${idx} OR p.email ILIKE $${idx})`
      );
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT p.*,
              am.name AS account_manager_name,
              mc.label AS merchant_label
       FROM pascal_people p
       LEFT JOIN pascal_people am ON am.id = p.account_manager_id
       LEFT JOIN pascal_merchant_channels mc ON mc.id = p.merchant_channel_id
       ${where}
       ORDER BY p.is_active DESC, p.type ASC, p.name ASC`,
      params
    );

    return NextResponse.json({ people: result.rows });
  } catch (err) {
    console.error("People GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, name } = body;

    if (!type || !name) {
      return NextResponse.json(
        { error: "type and name are required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO pascal_people
        (type, name, role, company, slack_user_id, telegram_user_id, email,
         domain, topics, escalation_notes, merchant_channel_id, account_manager_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        type,
        name,
        body.role || "",
        body.company || "",
        body.slack_user_id || null,
        body.telegram_user_id || null,
        body.email || "",
        body.domain || "",
        body.topics || [],
        body.escalation_notes || "",
        body.merchant_channel_id || null,
        body.account_manager_id || null,
        body.notes || "",
      ]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("People POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
