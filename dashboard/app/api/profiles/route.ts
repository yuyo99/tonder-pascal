import { NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/profiles
 *
 * Returns all merchant profiles + a "missing" list: business_ids that
 * appear in pascal_merchant_channels but have no corresponding profile
 * row. Lets the dashboard surface a "N merchants missing a profile" KPI.
 *
 * Response: { profiles: MerchantProfile[], missing: MissingMerchant[] }
 */
export async function GET() {
  try {
    const [profiles, missing] = await Promise.all([
      query(
        `SELECT id, business_id, merchant_name, one_liner, integration_model,
                active_products, account_manager, primary_contacts,
                quirks, recurring_issues, tone_preference,
                recent_history_summary, recent_history_updated_at,
                notes, created_by, created_at, updated_at
           FROM pascal_merchant_profiles
          ORDER BY merchant_name`,
      ),
      // Business IDs present in active merchant channels but missing a profile.
      // Synthetic sim:* channels are excluded (they're test fixtures, not real merchants).
      query(
        `WITH biz AS (
           SELECT UNNEST(business_ids) AS business_id, label, channel_id
             FROM pascal_merchant_channels
            WHERE is_active = true
              AND channel_id NOT LIKE 'sim:%'
         )
         SELECT b.business_id,
                MIN(b.label) AS suggested_name,
                COUNT(*)::int AS channel_count
           FROM biz b
           LEFT JOIN pascal_merchant_profiles p USING (business_id)
          WHERE p.id IS NULL
          GROUP BY b.business_id
          ORDER BY channel_count DESC, b.business_id`,
      ),
    ]);

    return NextResponse.json({
      profiles: profiles.rows,
      missing: missing.rows,
    });
  } catch (err) {
    console.error("Profiles GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
