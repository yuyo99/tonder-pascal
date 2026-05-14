/**
 * Pascal Model 2 / AID-73 — Merchant profiles (Memory Layer 2).
 *
 * Keyed by `business_id`. Loaded at orchestrator Phase 0 and injected
 * into the system prompt under `## Merchant Profile` so Pascal has
 * descriptive context (account manager, quirks, recurring issues, tone
 * preference, account-level history summary) on every response.
 *
 * Fails open: any load error returns null and the orchestrator simply
 * omits the section. Profiles are a quality boost, not a hard dependency.
 *
 * Spec: PASCAL_MODEL_2.md §4 Memory Layer 2.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";

export interface MerchantProfileContact {
  name: string;
  role?: string;
  email?: string;
  slack?: string;
}

export interface MerchantProfile {
  id: number;
  business_id: number;
  merchant_name: string;
  one_liner: string | null;
  integration_model: string | null;
  active_products: string[];
  account_manager: string | null;
  primary_contacts: MerchantProfileContact[];
  quirks: string | null;
  recurring_issues: string | null;
  tone_preference: string | null;
  recent_history_summary: string | null;
  recent_history_updated_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Load the profile for a given business_id. Returns null when no profile
 * exists OR on any DB error (failing open).
 */
export async function loadMerchantProfile(businessId: number): Promise<MerchantProfile | null> {
  if (!businessId) return null;
  try {
    const res = await pgQuery(
      `SELECT id, business_id, merchant_name, one_liner, integration_model,
              active_products, account_manager, primary_contacts,
              quirks, recurring_issues, tone_preference,
              recent_history_summary, recent_history_updated_at,
              notes, created_by, created_at, updated_at
         FROM pascal_merchant_profiles
        WHERE business_id = $1
        LIMIT 1`,
      [businessId],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      ...row,
      active_products: Array.isArray(row.active_products) ? row.active_products : [],
      primary_contacts: Array.isArray(row.primary_contacts)
        ? row.primary_contacts
        : typeof row.primary_contacts === "string"
          ? JSON.parse(row.primary_contacts || "[]")
          : [],
    };
  } catch (err) {
    logger.warn({ err, businessId }, "loadMerchantProfile: query failed, returning null");
    return null;
  }
}

/**
 * Render a profile as a system-prompt section. Returns an empty string if
 * the profile has no meaningful content (so the orchestrator can safely
 * concat without producing an empty header). Sonnet sees this under
 * `## Merchant Profile` after the Merchant Context block.
 */
export function renderMerchantProfileSection(profile: MerchantProfile | null): string {
  if (!profile) return "";

  const parts: string[] = [];

  if (profile.one_liner) {
    parts.push(profile.one_liner);
  }

  const integrationBits: string[] = [];
  if (profile.integration_model) integrationBits.push(profile.integration_model);
  if (profile.active_products.length > 0) integrationBits.push(`products: ${profile.active_products.join(", ")}`);
  if (integrationBits.length > 0) {
    parts.push(`**Integration**: ${integrationBits.join(" · ")}`);
  }

  if (profile.account_manager) {
    parts.push(`**Account manager (Tonder)**: ${profile.account_manager}`);
  }

  if (profile.primary_contacts.length > 0) {
    const lines = profile.primary_contacts.map((c) => {
      const meta: string[] = [];
      if (c.role) meta.push(c.role);
      if (c.email) meta.push(c.email);
      if (c.slack) meta.push(c.slack);
      return `- ${c.name}${meta.length ? ` (${meta.join(", ")})` : ""}`;
    });
    parts.push(`**Primary contacts**:\n${lines.join("\n")}`);
  }

  if (profile.quirks) {
    parts.push(`**Quirks**: ${profile.quirks}`);
  }
  if (profile.recurring_issues) {
    parts.push(`**Recurring issues**: ${profile.recurring_issues}`);
  }
  if (profile.tone_preference) {
    parts.push(`**Tone preference**: ${profile.tone_preference}`);
  }
  if (profile.recent_history_summary) {
    parts.push(`**Recent activity** (auto-generated): ${profile.recent_history_summary}`);
  }

  if (parts.length === 0) return "";

  return `\n\n## Merchant Profile

${parts.join("\n\n")}

Use this context to personalize Pascal's response. When this conflicts with the Active Rules above, the rules win.\n`;
}
