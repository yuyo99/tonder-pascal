import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await query(
      `SELECT mc.id, mc.label, mc.channel_id, mc.platform, mc.business_ids,
              mc.is_active, mc.notes, mc.integration_model, mc.active_products,
              mc.stage_email, mc.production_email, mc.created_at, mc.updated_at,
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
       WHERE mc.id = $1
       GROUP BY mc.id`,
      [id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    return NextResponse.json({ merchant: result.rows[0] });
  } catch (err) {
    console.error(`GET /api/merchants/${id} error:`, err);
    return NextResponse.json({ error: "Failed to fetch merchant" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { label, channel_id, platform, business_ids, is_active, notes, partner_bots, scheduled_reports,
            integration_model, active_products, stage_email, production_email } = body;

    // Update merchant channel
    const updateResult = await query(
      `UPDATE pascal_merchant_channels
       SET label = COALESCE($2, label),
           channel_id = COALESCE($3, channel_id),
           platform = COALESCE($4, platform),
           business_ids = COALESCE($5, business_ids),
           is_active = COALESCE($6, is_active),
           notes = COALESCE($7, notes),
           integration_model = COALESCE($8, integration_model),
           active_products = COALESCE($9, active_products),
           stage_email = COALESCE($10, stage_email),
           production_email = COALESCE($11, production_email),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, label, channel_id, platform, business_ids, is_active, notes,
       integration_model, active_products, stage_email, production_email]
    );
    if (updateResult.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    // Replace partner bots: delete all existing, re-insert
    if (partner_bots !== undefined) {
      await query(`DELETE FROM pascal_partner_bots WHERE channel_id = $1`, [id]);
      if (partner_bots?.length) {
        for (const bot of partner_bots) {
          await query(
            `INSERT INTO pascal_partner_bots (channel_id, username, label) VALUES ($1, $2, $3)`,
            [id, bot.username, bot.label]
          );
        }
      }
    }

    // Upsert scheduled reports
    if (scheduled_reports !== undefined) {
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
          [id, sr.report_type || "daily_report", sr.is_enabled ?? false, sr.cron_expr || "0 9 * * *", sr.timezone || "America/Mexico_City", sr.slack_user_id || ""]
        );
      }
    }

    return NextResponse.json({ merchant: updateResult.rows[0] });
  } catch (err) {
    console.error(`PUT /api/merchants/${id} error:`, err);
    return NextResponse.json({ error: "Failed to update merchant" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await query(
      `DELETE FROM pascal_merchant_channels WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error(`DELETE /api/merchants/${id} error:`, err);
    return NextResponse.json({ error: "Failed to delete merchant" }, { status: 500 });
  }
}
