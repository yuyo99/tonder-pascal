import cron, { ScheduledTask } from "node-cron";
import { WebClient } from "@slack/web-api";
import { pgQuery } from "../postgres/connection";
import { sendDailyReport } from "./daily-report";
import { onConfigChange } from "../merchants/config-store";
import { logger } from "../utils/logger";

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

// Fallback: the global daily report (kept for backwards compat if no per-merchant reports exist)
let globalTask: ScheduledTask | null = null;
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

  // If there are per-merchant reports, stop the global fallback
  if (desiredConfigs.size > 0 && globalTask) {
    globalTask.stop();
    globalTask = null;
    logger.info("Stopped global daily report (per-merchant reports active)");
  }

  // If there are NO per-merchant reports, ensure the global fallback is running
  if (desiredConfigs.size === 0 && !globalTask && slackClientRef) {
    const client = slackClientRef;
    globalTask = cron.schedule(
      "0 9 * * *",
      async () => {
        logger.info("Running global daily report (fallback)...");
        try {
          await sendDailyReport(client);
        } catch (err) {
          logger.error({ err }, "Global daily report failed");
        }
      },
      { timezone: "America/Mexico_City" }
    );
    logger.info("Started global daily report fallback (no per-merchant reports configured)");
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
  });

  // Re-sync whenever merchant configs change (polling detects changes)
  onConfigChange(() => {
    syncScheduledReports().catch((err) => {
      logger.error({ err }, "Scheduler re-sync failed");
    });
  });

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
  if (globalTask) {
    globalTask.stop();
    globalTask = null;
  }
  slackClientRef = null;
  logger.info("Scheduler stopped");
}
