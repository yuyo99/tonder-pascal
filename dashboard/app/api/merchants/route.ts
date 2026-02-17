import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export async function GET() {
  try {
    const result = await query(`
      SELECT mc.id, mc.label, mc.channel_id, mc.platform, mc.business_ids,
             mc.is_active, mc.notes, mc.created_at, mc.updated_at,
             COALESCE(
               json_agg(json_build_object('id', pb.id, 'username', pb.username, 'label', pb.label))
               FILTER (WHERE pb.id IS NOT NULL),
               '[]'
             ) AS partner_bots,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object(
                 'id', sr.id, 'report_type', sr.report_type, 'is_enabled', sr.is_enabled,
                 'cron_expr', sr.cron_expr, 'timezone', sr.timezone, 'slack_user_id', sr.slack_user_id
               )) FILTER (WHERE sr.id IS NOT NULL),
               '[]'
             ) AS scheduled_reports
      FROM pascal_merchant_channels mc
      LEFT JOIN pascal_partner_bots pb ON pb.channel_id = mc.id
      LEFT JOIN pascal_scheduled_reports sr ON sr.channel_id = mc.id
      GROUP BY mc.id
      ORDER BY mc.label
    `);
    return NextResponse.json({ merchants: result.rows });
  } catch (err) {
    console.error("GET /api/merchants error:", err);
    return NextResponse.json({ error: "Failed to fetch merchants" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { label, channel_id, platform, business_ids, is_active, notes, partner_bots, scheduled_reports } = body;

    if (!label || !channel_id || !platform || !business_ids?.length) {
      return NextResponse.json(
        { error: "Missing required fields: label, channel_id, platform, business_ids" },
        { status: 400 }
      );
    }

    // Insert merchant channel
    const insertResult = await query(
      `INSERT INTO pascal_merchant_channels (label, channel_id, platform, business_ids, is_active, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [label, channel_id, platform, business_ids, is_active ?? true, notes || ""]
    );
    const merchant = insertResult.rows[0];

    // Insert partner bots if any
    if (partner_bots?.length) {
      for (const bot of partner_bots) {
        await query(
          `INSERT INTO pascal_partner_bots (channel_id, username, label) VALUES ($1, $2, $3)`,
          [merchant.id, bot.username, bot.label]
        );
      }
    }

    // Insert scheduled reports if any
    if (scheduled_reports?.length) {
      for (const sr of scheduled_reports) {
        await query(
          `INSERT INTO pascal_scheduled_reports (channel_id, report_type, is_enabled, cron_expr, timezone, slack_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (channel_id, report_type) DO UPDATE SET
             is_enabled = EXCLUDED.is_enabled,
             cron_expr = EXCLUDED.cron_expr,
             timezone = EXCLUDED.timezone,
             slack_user_id = EXCLUDED.slack_user_id,
             updated_at = now()`,
          [merchant.id, sr.report_type || "daily_report", sr.is_enabled ?? false, sr.cron_expr || "0 9 * * *", sr.timezone || "America/Mexico_City", sr.slack_user_id || ""]
        );
      }
    }

    return NextResponse.json({ merchant }, { status: 201 });
  } catch (err: unknown) {
    console.error("POST /api/merchants error:", err);
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      return NextResponse.json({ error: "A merchant with this platform + channel already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create merchant" }, { status: 500 });
  }
}
