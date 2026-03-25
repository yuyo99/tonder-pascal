/**
 * Heartbeat — Pascal writes "I am alive" every 60s to PostgreSQL.
 * A scheduler job checks every 2 minutes; if heartbeat is stale (>3 min), fires alert.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import { alertCritical } from "./alert-router";
import { resolveIncident } from "./incident-store";
import { HEARTBEAT_STALE } from "./fingerprints";
import type { HeartbeatMeta } from "./types";
import { getChannelIndex } from "../merchants/config-store";

// ── Configuration ────────────────────────────────────────────────

const SERVICE_NAME = "pascal-main";
const HEARTBEAT_INTERVAL = parseInt(process.env.PASCAL_HEARTBEAT_INTERVAL_MS || "60000", 10);
const STALE_THRESHOLD_MS = parseInt(process.env.PASCAL_HEARTBEAT_STALE_MS || "180000", 10);

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const startedAt = Date.now();

// ── Writer: "I am alive" ────────────────────────────────────────

export async function writeHeartbeat(extra?: Partial<HeartbeatMeta>): Promise<void> {
  const meta: HeartbeatMeta = {
    uptime: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    slackConnected: true, // overridden by caller if needed
    telegramConnected: true,
    channelIndexSize: getChannelIndex().size,
    lastConfigPoll: null,
    ...extra,
  };

  try {
    await pgQuery(
      `INSERT INTO pascal_health_heartbeats (service_name, last_seen_at, meta)
       VALUES ($1, now(), $2)
       ON CONFLICT (service_name) DO UPDATE SET last_seen_at = now(), meta = $2`,
      [SERVICE_NAME, JSON.stringify(meta)],
    );
  } catch (err) {
    logger.error({ err }, "Heartbeat write failed");
  }
}

// ── Checker: detect stale heartbeat ─────────────────────────────

export async function checkHeartbeat(): Promise<void> {
  try {
    const result = await pgQuery(
      `SELECT last_seen_at, meta FROM pascal_health_heartbeats WHERE service_name = $1`,
      [SERVICE_NAME],
    );

    if (result.rows.length === 0) {
      await alertCritical(HEARTBEAT_STALE, "No heartbeat found — Pascal may not have started", {
        service: "heartbeat-checker",
        suggestedSteps: [
          "Check Railway deployment status",
          "Check startup logs for crashes",
          "Verify DATABASE_URL is accessible",
        ],
      });
      return;
    }

    const lastSeen = new Date(result.rows[0].last_seen_at).getTime();
    const ageMs = Date.now() - lastSeen;

    if (ageMs > STALE_THRESHOLD_MS) {
      const ageSec = Math.round(ageMs / 1000);
      await alertCritical(HEARTBEAT_STALE, `Heartbeat stale (${ageSec}s old, threshold: ${STALE_THRESHOLD_MS / 1000}s)`, {
        service: "heartbeat-checker",
        suggestedSteps: [
          "Check Railway for crash loops",
          "Check Telegram adapter for SIGTERM issues",
          "Check PostgreSQL connectivity",
        ],
      });
    } else {
      // Heartbeat is healthy — resolve any open incident
      await resolveIncident(HEARTBEAT_STALE);
    }
  } catch (err) {
    logger.error({ err }, "Heartbeat check failed");
  }
}

// ── Lifecycle ───────────────────────────────────────────────────

export function startHeartbeatWriter(): void {
  // Write immediately on start
  writeHeartbeat().catch(() => {});

  heartbeatTimer = setInterval(() => {
    writeHeartbeat().catch(() => {});
  }, HEARTBEAT_INTERVAL);

  logger.info(
    { intervalMs: HEARTBEAT_INTERVAL, staleMs: STALE_THRESHOLD_MS },
    "Heartbeat writer started",
  );
}

export function stopHeartbeatWriter(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info("Heartbeat writer stopped");
  }
}
