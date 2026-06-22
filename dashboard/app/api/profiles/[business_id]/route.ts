import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/profiles/[business_id]
 *
 * Returns the merchant profile for a business_id, or 404 if not yet created.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ business_id: string }> },
) {
  try {
    const { business_id } = await ctx.params;
    const businessId = parseInt(business_id, 10);
    if (!businessId || isNaN(businessId)) {
      return NextResponse.json({ error: "invalid business_id" }, { status: 400 });
    }

    const res = await query(
      `SELECT id, business_id, merchant_name, one_liner, integration_model,
              active_products, account_manager, primary_contacts,
              quirks, recurring_issues, tone_preference,
              recent_history_summary, recent_history_updated_at,
              notes, created_by, created_at, updated_at
         FROM pascal_merchant_profiles
        WHERE business_id = $1`,
      [businessId],
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: "profile not found" }, { status: 404 });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error("Profile GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/profiles/[business_id]
 *
 * Upsert. Creates the profile if missing, updates if present. Bumps
 * updated_at. `business_id` in the body is ignored — the URL is canonical.
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ business_id: string }> },
) {
  try {
    const { business_id } = await ctx.params;
    const businessId = parseInt(business_id, 10);
    if (!businessId || isNaN(businessId)) {
      return NextResponse.json({ error: "invalid business_id" }, { status: 400 });
    }

    const body = await req.json();
    const {
      merchant_name,
      one_liner = null,
      integration_model = null,
      active_products = [],
      account_manager = null,
      primary_contacts = [],
      quirks = null,
      recurring_issues = null,
      tone_preference = null,
      notes = null,
      created_by = null,
    } = body;

    if (!merchant_name || typeof merchant_name !== "string") {
      return NextResponse.json({ error: "merchant_name is required" }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO pascal_merchant_profiles
         (business_id, merchant_name, one_liner, integration_model, active_products,
          account_manager, primary_contacts, quirks, recurring_issues, tone_preference,
          notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (business_id) DO UPDATE SET
         merchant_name      = EXCLUDED.merchant_name,
         one_liner          = EXCLUDED.one_liner,
         integration_model  = EXCLUDED.integration_model,
         active_products    = EXCLUDED.active_products,
         account_manager    = EXCLUDED.account_manager,
         primary_contacts   = EXCLUDED.primary_contacts,
         quirks             = EXCLUDED.quirks,
         recurring_issues   = EXCLUDED.recurring_issues,
         tone_preference    = EXCLUDED.tone_preference,
         notes              = EXCLUDED.notes,
         updated_at         = now()
       RETURNING id, business_id, merchant_name, one_liner, integration_model,
                 active_products, account_manager, primary_contacts,
                 quirks, recurring_issues, tone_preference,
                 recent_history_summary, recent_history_updated_at,
                 notes, created_by, created_at, updated_at`,
      [
        businessId,
        merchant_name,
        one_liner,
        integration_model,
        Array.isArray(active_products) ? active_products : [],
        account_manager,
        JSON.stringify(Array.isArray(primary_contacts) ? primary_contacts : []),
        quirks,
        recurring_issues,
        tone_preference,
        notes,
        created_by,
      ],
    );

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error("Profile PUT error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
