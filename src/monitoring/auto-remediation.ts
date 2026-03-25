/**
 * Safe auto-remediation — recover automatically from transient issues.
 *
 * ALLOWED:
 * - Reconnect Slack/Telegram adapter
 * - Reload merchant config cache
 * - Retry one transient Claude/API call
 * - Retry one transient DB query
 * - Flush stale in-memory caches
 *
 * NOT ALLOWED:
 * - Editing merchant configs
 * - Changing prompts
 * - Mutating business mappings
 * - Repeated retries (max 1 per fingerprint per 10 min)
 * - Auto-answering merchants
 */

import { loadConfigs } from "../merchants/config-store";
import { refreshBusinessNames } from "../merchants/context";
import { loadKnowledgeBase } from "../knowledge/loader";
import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";

// ── Rate limiter: one remediation per fingerprint per 10 min ────

const recentRemediations = new Map<string, number>();
const REMEDIATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function canRemediate(fingerprint: string): boolean {
  const last = recentRemediations.get(fingerprint) ?? 0;
  if (Date.now() - last < REMEDIATION_COOLDOWN_MS) return false;
  recentRemediations.set(fingerprint, Date.now());
  // Clean old entries
  if (recentRemediations.size > 100) {
    const now = Date.now();
    for (const [k, t] of recentRemediations) {
      if (now - t > REMEDIATION_COOLDOWN_MS * 2) recentRemediations.delete(k);
    }
  }
  return true;
}

// ── Remediation actions ─────────────────────────────────────────

export type RemediationAction =
  | "reload_merchant_config"
  | "reload_knowledge_base"
  | "refresh_business_names"
  | "flush_caches";

export interface RemediationResult {
  action: RemediationAction;
  success: boolean;
  error?: string;
  durationMs: number;
}

async function executeRemediation(action: RemediationAction): Promise<RemediationResult> {
  const start = Date.now();
  try {
    switch (action) {
      case "reload_merchant_config":
        await loadConfigs();
        break;
      case "reload_knowledge_base":
        await loadKnowledgeBase();
        break;
      case "refresh_business_names":
        await refreshBusinessNames();
        break;
      case "flush_caches":
        await loadConfigs();
        await loadKnowledgeBase();
        await refreshBusinessNames();
        break;
    }
    return { action, success: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      action,
      success: false,
      error: err instanceof Error ? err.message : "unknown",
      durationMs: Date.now() - start,
    };
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Attempt safe remediation for a given failure fingerprint.
 * Returns the result, or null if cooldown prevents retry.
 */
export async function attemptRemediation(
  fingerprint: string,
  action: RemediationAction,
): Promise<RemediationResult | null> {
  if (!canRemediate(fingerprint)) {
    logger.debug({ fingerprint, action }, "Remediation skipped — cooldown active");
    return null;
  }

  logger.info({ fingerprint, action }, "Attempting auto-remediation");
  const result = await executeRemediation(action);

  // Log to Postgres
  try {
    await pgQuery(
      `INSERT INTO pascal_error_logs (source, severity, message, context)
       VALUES ('auto-remediation', $1, $2, $3)`,
      [
        result.success ? "info" : "error",
        `Auto-remediation: ${action} — ${result.success ? "success" : "failed"}`,
        JSON.stringify({ fingerprint, ...result }),
      ],
    );
  } catch {
    // Non-fatal
  }

  if (result.success) {
    logger.info({ fingerprint, action, durationMs: result.durationMs }, "Auto-remediation succeeded");
  } else {
    logger.error({ fingerprint, action, error: result.error }, "Auto-remediation failed");
  }

  return result;
}

/**
 * Suggest a remediation action based on the failure fingerprint.
 * Returns null if no safe remediation is available.
 */
export function suggestRemediation(fingerprint: string): RemediationAction | null {
  if (fingerprint.includes("config") || fingerprint.includes("not_configured") || fingerprint.includes("channel_not_found")) {
    return "reload_merchant_config";
  }
  if (fingerprint.includes("knowledge") || fingerprint.includes("prompt")) {
    return "reload_knowledge_base";
  }
  if (fingerprint.includes("business_name") || fingerprint.includes("merchant_name")) {
    return "refresh_business_names";
  }
  if (fingerprint.includes("heartbeat:stale")) {
    return "flush_caches";
  }
  return null;
}
