import cron, { ScheduledTask } from "node-cron";
import { WebClient } from "@slack/web-api";
import { pgQuery } from "../postgres/connection";
import { sendDailyReport } from "./daily-report";
import { sendAccountCreationAlert } from "./linear-label-alert";
import { onConfigChange } from "../merchants/config-store";
import { checkHeartbeat } from "../monitoring/heartbeat";
import { runAllSyntheticChecks, cleanupOldResults } from "../monitoring/synthetic-checks";
import { runNightlyLearn } from "./nightly-learn";
import { runDirectiveExtract } from "./directive-extract";
import { runSuite as runSimulationSuite, startJobPoller as startSimJobPoller } from "./simulation-runner";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

interface ReportConfig {
  id: number;
  merchantLabel: string;
  channelId: string;
  platform: string;
  businessIds: number[];
  reportType: string;
  cronExpr: string;
  timezone: string;
  slackUserId: string;
}

/**
 * Build a unique key for a scheduled report to track running tasks.
 */
function reportKey(cfg: ReportConfig): string {
  return `${cfg.id}:${cfg.reportType}`;
}

// Running cron tasks keyed by reportKey
const runningTasks = new Map<string, { task: ScheduledTask; config: ReportConfig }>();

// (Global daily report fallback removed — only per-merchant scheduled reports run now)
// Hardcoded system alerts
let accountCreationTask: ScheduledTask | null = null;
let slackClientRef: WebClient | null = null;

/**
 * Load enabled scheduled reports from Postgres and diff against running tasks.
 */
async function syncScheduledReports(): Promise<void> {
  if (!slackClientRef) return;

  const result = await pgQuery(`
    SELECT sr.id, sr.report_type, sr.cron_expr, sr.timezone, sr.slack_user_id,
           mc.label AS merchant_label, mc.channel_id, mc.platform, mc.business_ids
    FROM pascal_scheduled_reports sr
    JOIN pascal_merchant_channels mc ON mc.id = sr.channel_id
    WHERE sr.is_enabled = true AND mc.is_active = true
  `);

  const desiredConfigs = new Map<string, ReportConfig>();
  for (const row of result.rows) {
    const cfg: ReportConfig = {
      id: row.id,
      merchantLabel: row.merchant_label,
      channelId: row.channel_id,
      platform: row.platform,
      businessIds: row.business_ids,
      reportType: row.report_type,
      cronExpr: row.cron_expr,
      timezone: row.timezone,
      slackUserId: row.slack_user_id,
    };
    desiredConfigs.set(reportKey(cfg), cfg);
  }

  // Stop tasks that are no longer desired
  for (const [key, entry] of runningTasks) {
    if (!desiredConfigs.has(key)) {
      entry.task.stop();
      runningTasks.delete(key);
      logger.info({ key, merchant: entry.config.merchantLabel }, "Stopped scheduled report");
    }
  }

  // Start new tasks or update changed ones
  for (const [key, cfg] of desiredConfigs) {
    const existing = runningTasks.get(key);

    // Check if config changed (cron, timezone, or slack user)
    if (existing) {
      const prev = existing.config;
      if (
        prev.cronExpr === cfg.cronExpr &&
        prev.timezone === cfg.timezone &&
        prev.slackUserId === cfg.slackUserId
      ) {
        continue; // No changes
      }
      // Config changed — stop old task
      existing.task.stop();
      runningTasks.delete(key);
      logger.info({ key, merchant: cfg.merchantLabel }, "Restarting scheduled report (config changed)");
    }

    // Validate cron expression
    if (!cron.validate(cfg.cronExpr)) {
      logger.warn({ key, cronExpr: cfg.cronExpr }, "Invalid cron expression — skipping");
      continue;
    }

    // Create new cron task
    const client = slackClientRef;
    const task = cron.schedule(
      cfg.cronExpr,
      async () => {
        logger.info({ merchant: cfg.merchantLabel, reportType: cfg.reportType }, "Running scheduled report...");
        try {
          await sendDailyReport(client, {
            merchantLabel: cfg.merchantLabel,
            slackUserId: cfg.slackUserId,
            businessIds: cfg.businessIds,
          });
        } catch (err) {
          logger.error({ err, merchant: cfg.merchantLabel }, "Scheduled report failed");
          storeErrorFromCatch("scheduler", err, { merchant: cfg.merchantLabel, action: cfg.reportType });
        }
      },
      { timezone: cfg.timezone }
    );

    runningTasks.set(key, { task, config: cfg });
    logger.info(
      { key, merchant: cfg.merchantLabel, cron: cfg.cronExpr, tz: cfg.timezone },
      "Started scheduled report"
    );
  }

}

/**
 * Initialize the scheduler.
 * Syncs scheduled reports from Postgres and re-syncs whenever config changes.
 */
export function initScheduler(slackClient: WebClient): void {
  slackClientRef = slackClient;

  // Sync now
  syncScheduledReports().catch((err) => {
    logger.error({ err }, "Initial scheduler sync failed");
    storeErrorFromCatch("scheduler", err, { action: "initial_sync" });
  });

  // Re-sync whenever merchant configs change (polling detects changes)
  onConfigChange(() => {
    syncScheduledReports().catch((err) => {
      logger.error({ err }, "Scheduler re-sync failed");
      storeErrorFromCatch("scheduler", err, { action: "resync" });
    });
  });

  // ── Hardcoded system alerts ──────────────────────────────────────

  // Account Creation PROD label alert — daily 10am Mon-Fri
  accountCreationTask = cron.schedule(
    "0 10 * * 1-5",
    async () => {
      try {
        await sendAccountCreationAlert(slackClient);
      } catch (err) {
        logger.error({ err }, "Account creation alert failed");
        storeErrorFromCatch("scheduler", err, { action: "account_creation_alert" });
      }
    },
    { timezone: "America/Mexico_City" }
  );
  logger.info("Account Creation PROD alert scheduled (daily 10am Mon-Fri)");

  // Heartbeat health check — every 2 minutes
  cron.schedule("*/2 * * * *", async () => {
    try {
      await checkHeartbeat();
    } catch (err) {
      logger.error({ err }, "Heartbeat check failed");
    }
  });
  logger.info("Heartbeat checker scheduled (every 2 minutes)");

  // Synthetic checks — every 10 minutes
  const syntheticEnabled = process.env.PASCAL_SYNTHETIC_CHECKS_ENABLED !== "false";
  const syntheticInterval = parseInt(process.env.PASCAL_SYNTHETIC_CHECK_INTERVAL_MIN || "10", 10);
  if (syntheticEnabled) {
    cron.schedule(`*/${syntheticInterval} * * * *`, async () => {
      try {
        await runAllSyntheticChecks();
      } catch (err) {
        logger.error({ err }, "Synthetic checks runner failed");
      }
    });
    logger.info({ intervalMin: syntheticInterval }, "Synthetic checks scheduled");

    // Cleanup old results daily at 3 AM
    cron.schedule("0 3 * * *", async () => {
      try { await cleanupOldResults(); } catch { /* non-fatal */ }
    }, { timezone: "America/Mexico_City" });
  }

  // Nightly auto-learn — 2:00 AM Mexico City (AID-79)
  cron.schedule("0 2 * * *", async () => {
    try {
      await runNightlyLearn();
    } catch (err) {
      logger.error({ err }, "Nightly auto-learn failed");
      storeErrorFromCatch("scheduler", err, { action: "nightly_learn" });
    }
  }, { timezone: "America/Mexico_City" });
  logger.info("Nightly auto-learn scheduled (daily 2:00 AM Mexico City)");

  // Directive auto-extraction — 1:30 AM Mexico City (AID-83, Pascal Model 2 M4)
  // Mines pascal_conversation_log for team corrections, classifies via Haiku,
  // queues proposed rules (active=false) in /training for human approval.
  // Runs before nightly-learn so any newly-active rules are in effect by the
  // time auto-learn promotes Q&A pairs.
  cron.schedule("30 1 * * *", async () => {
    try {
      await runDirectiveExtract({ backfillDays: 1 });
    } catch (err) {
      logger.error({ err }, "Directive auto-extraction failed");
      storeErrorFromCatch("scheduler", err, { action: "directive_extract" });
    }
  }, { timezone: "America/Mexico_City" });
  logger.info("Directive auto-extraction scheduled (daily 1:30 AM Mexico City)");

  // Simulation regression suite — 3:00 AM Mexico City (AID-80, Pascal Model 2 M6)
  // Runs all active sims nightly. Failures auto-open Linear tickets on SOS
  // team (on transition into fail only — chronic-fail sims won't spam).
  // Runs after auto-learn (2 AM) and directive-extract (1:30 AM) so any new
  // rules/knowledge are in effect for the tests.
  cron.schedule("0 3 * * *", async () => {
    try {
      await runSimulationSuite({ onlyActive: true });
    } catch (err) {
      logger.error({ err }, "Simulation suite failed to run");
      storeErrorFromCatch("scheduler", err, { action: "simulation_suite" });
    }
  }, { timezone: "America/Mexico_City" });
  logger.info("Simulation suite scheduled (daily 3:00 AM Mexico City)");

  // Simulation job poller — picks up pending pascal_simulation_jobs rows
  // (inserted by the dashboard's "Run now" button) every 10s and executes
  // them. Same process as the cron suite; no extra service.
  startSimJobPoller();

  logger.info("Scheduler initialized — syncing scheduled reports from Postgres");
}

/**
 * Stop all scheduled tasks (for graceful shutdown).
 */
export function stopScheduler(): void {
  for (const [key, entry] of runningTasks) {
    entry.task.stop();
    logger.info({ key }, "Stopped scheduled report");
  }
  runningTasks.clear();
  if (accountCreationTask) {
    accountCreationTask.stop();
    accountCreationTask = null;
  }
  slackClientRef = null;
  logger.info("Scheduler stopped");
}
