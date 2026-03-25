/**
 * Synthetic check runner — executes all test cases on a schedule,
 * persists results, and alerts on consecutive failures.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import { alertCritical } from "./alert-router";
import { ALL_SYNTHETIC_CHECKS } from "./test-cases";
import type { SyntheticCheckResult } from "./types";

const CONSECUTIVE_FAILURE_THRESHOLD = 2;

// ── Run all checks ──────────────────────────────────────────────

export async function runAllSyntheticChecks(): Promise<SyntheticCheckResult[]> {
  const results: SyntheticCheckResult[] = [];

  for (const check of ALL_SYNTHETIC_CHECKS) {
    try {
      const result = await check();
      results.push(result);
      await persistResult(result);

      if (result.status === "fail") {
        logger.warn({ checkName: result.checkName, details: result.details }, "Synthetic check FAILED");
        await checkConsecutiveFailures(result);
      } else {
        logger.debug({ checkName: result.checkName, latencyMs: result.latencyMs }, "Synthetic check passed");
      }
    } catch (err) {
      const failResult: SyntheticCheckResult = {
        checkName: (check as any).name || "unknown",
        status: "fail",
        latencyMs: 0,
        details: { error: err instanceof Error ? err.message : "unknown", uncaught: true },
      };
      results.push(failResult);
      await persistResult(failResult);
      logger.error({ err, checkName: failResult.checkName }, "Synthetic check threw uncaught error");
    }
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  logger.info({ passed, failed, total: results.length }, "Synthetic check run complete");

  return results;
}

// ── Persist result to Postgres ──────────────────────────────────

async function persistResult(result: SyntheticCheckResult): Promise<void> {
  try {
    await pgQuery(
      `INSERT INTO pascal_synthetic_check_runs (check_name, status, latency_ms, details)
       VALUES ($1, $2, $3, $4)`,
      [result.checkName, result.status, result.latencyMs, JSON.stringify(result.details)],
    );
  } catch (err) {
    logger.error({ err, checkName: result.checkName }, "Failed to persist synthetic check result");
  }
}

// ── Consecutive failure detection ───────────────────────────────

async function checkConsecutiveFailures(result: SyntheticCheckResult): Promise<void> {
  try {
    const recent = await pgQuery(
      `SELECT status FROM pascal_synthetic_check_runs
       WHERE check_name = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [result.checkName, CONSECUTIVE_FAILURE_THRESHOLD],
    );

    const allFailed = recent.rows.length >= CONSECUTIVE_FAILURE_THRESHOLD &&
      recent.rows.every((r: any) => r.status === "fail");

    if (allFailed) {
      await alertCritical(
        `synthetic:${result.checkName}:consecutive_failures`,
        `Synthetic check "${result.checkName}" failed ${CONSECUTIVE_FAILURE_THRESHOLD} times consecutively`,
        {
          service: "synthetic-checks",
          suggestedSteps: getSuggestedSteps(result.checkName),
          details: result.details,
        } as any,
      );
    }
  } catch (err) {
    logger.error({ err, checkName: result.checkName }, "Failed to check consecutive failures");
  }
}

// ── Suggested steps per check ───────────────────────────────────

function getSuggestedSteps(checkName: string): string[] {
  switch (checkName) {
    case "deposit_ticket_parser":
      return ["Check if deposit ticket format changed", "Inspect partner-bot.ts parseDepositTicket regex"];
    case "lookup_connectivity":
      return ["Check MongoDB connection", "Verify MONGODB_URI env var", "Check Atlas cluster status"];
    case "analytics_query":
      return ["Check MongoDB aggregation pipeline", "Verify collection exists", "Check read permissions"];
    case "withdrawal_lookup":
      return ["Check withdrawals collection", "Verify MongoDB connectivity"];
    case "provider_masking":
      return ["Check provider-mask.ts sanitization rules", "Verify no new provider names leaked"];
    case "config_index":
      return ["Check Postgres connectivity", "Verify pascal_merchant_channels table", "Run seedDefaults manually"];
    default:
      return ["Check recent logs", "Inspect error details"];
  }
}

// ── Cleanup old results (keep 7 days) ───────────────────────────

export async function cleanupOldResults(): Promise<void> {
  try {
    await pgQuery(`DELETE FROM pascal_synthetic_check_runs WHERE created_at < now() - interval '7 days'`);
  } catch (err) {
    logger.error({ err }, "Failed to cleanup old synthetic check results");
  }
}
