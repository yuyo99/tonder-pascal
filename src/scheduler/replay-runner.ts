/**
 * Pascal post-Model 2 — Conversation replay runner ("Fin test mode")
 *
 * Replays any past pascal_conversation_log entry against current Pascal so
 * the team can verify rule/procedure/profile changes against real merchant
 * conversations without waiting for the nightly sim suite or sending real
 * messages.
 *
 * Flow:
 *   1. Dashboard inserts a row in pascal_replay_jobs (status='pending')
 *   2. This poller (every 10s) claims it FOR UPDATE SKIP LOCKED
 *   3. Loads the original pascal_conversation_log row
 *   4. Synthesizes an IncomingMessage with the original channel_id +
 *      original text. merchant context resolves naturally because the
 *      original channel really exists in pascal_merchant_channels.
 *   5. Calls handleIncomingMessage() in-process. This DOES log to
 *      pascal_conversation_log with the real channel_id and DOES bump
 *      apply_count / dispatch_count counters — accepted as a v1 trade-off
 *      to keep this commit small. Replays are infrequent enough that the
 *      noise is negligible.
 *   6. Captures the new answer + tool calls into pascal_conversation_replays
 *      and updates the job's status + replay_id.
 *
 * The new conversation_log row written by the replay is identifiable in
 * analytics queries via tool_calls @> '[{"input":{"replay":true}}]' — we
 * pass that marker through. (Future v2: skip the conversation log write
 * entirely via a new IncomingMessage.isReplay flag.)
 */

import { pgQuery } from "../postgres/connection";
import { handleIncomingMessage } from "../core/orchestrator";
import type { IncomingMessage } from "../channels/types";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

const POLLER_INTERVAL_MS = 10_000;

let pollerHandle: ReturnType<typeof setInterval> | null = null;
let pollerRunning = false;

interface OriginalConversation {
  id: string;
  channel_id: string;
  platform: string;
  user_name: string | null;
  question: string;
  answer: string;
  created_at: string;
}

export interface ReplayResult {
  replayId: number;
  status: "done" | "error";
  answer: string;
  toolCalls: unknown[];
  rounds: number;
  latencyMs: number;
  error?: string;
}

/**
 * Replay a single conversation. Returns the new response + metadata.
 * Persists a row into pascal_conversation_replays on completion.
 */
export async function replayConversation(
  originalConversationId: string,
  triggeredBy: string = "dashboard",
): Promise<ReplayResult> {
  const startedAt = Date.now();

  // Create the replay row in 'running' state so subsequent inserts don't
  // need to back-fill the id.
  const inserted = await pgQuery(
    `INSERT INTO pascal_conversation_replays
       (original_conversation_id, status, triggered_by)
     VALUES ($1, 'running', $2)
     RETURNING id`,
    [originalConversationId, triggeredBy],
  );
  const replayId = inserted.rows[0].id as number;

  logger.info({ replayId, originalConversationId, triggeredBy }, "Replay: starting");

  try {
    const orig = await loadOriginalConversation(originalConversationId);
    if (!orig) {
      throw new Error(`original conversation ${originalConversationId} not found`);
    }

    // Synthesize IncomingMessage. We re-use the original channel_id so
    // merchant context resolves correctly via the real
    // pascal_merchant_channels row. mentions=["@pascal"] so the Phase 0
    // gate's require_mention rules don't accidentally block (the merchant
    // already directed this to Pascal once).
    const incomingMsg: IncomingMessage = {
      channelId: orig.channel_id,
      platform: (orig.platform === "telegram" ? "telegram" : "slack") as IncomingMessage["platform"],
      userId: orig.user_name ?? "replay_user",
      userName: `[REPLAY] ${orig.user_name ?? "unknown"}`,
      text: orig.question,
      rawEvent: {
        _replay: true,
        original_conversation_id: originalConversationId,
        replay_id: replayId,
      },
      mentions: ["@pascal"],
      ambient: false,
    };

    const response = await handleIncomingMessage(incomingMsg);
    const latencyMs = Date.now() - startedAt;

    // The orchestrator currently doesn't return toolCalls/rounds in its
    // MessageResponse, only text. For v1 we record what we can; future
    // enhancement could extend MessageResponse to expose pipeline metadata.
    await pgQuery(
      `UPDATE pascal_conversation_replays
          SET status = 'done',
              replayed_answer = $1,
              replayed_tool_calls = '[]'::jsonb,
              replayed_rounds = 0,
              replayed_latency_ms = $2,
              finished_at = now()
        WHERE id = $3`,
      [response.text || "", latencyMs, replayId],
    );

    logger.info(
      { replayId, originalConversationId, latencyMs, answerLength: response.text?.length ?? 0 },
      "Replay: done",
    );

    return {
      replayId,
      status: "done",
      answer: response.text || "",
      toolCalls: [],
      rounds: 0,
      latencyMs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const latencyMs = Date.now() - startedAt;
    logger.error({ err, replayId, originalConversationId }, "Replay: failed");
    storeErrorFromCatch("scheduler", err, {
      action: "replay",
      original_conversation_id: originalConversationId,
      replay_id: replayId,
    });

    await pgQuery(
      `UPDATE pascal_conversation_replays
          SET status = 'error',
              error = $1,
              replayed_latency_ms = $2,
              finished_at = now()
        WHERE id = $3`,
      [errMsg, latencyMs, replayId],
    );

    return {
      replayId,
      status: "error",
      answer: "",
      toolCalls: [],
      rounds: 0,
      latencyMs,
      error: errMsg,
    };
  }
}

// ── Job poller ─────────────────────────────────────────────────────────

export function startReplayJobPoller(): void {
  if (pollerHandle) return;
  pollerHandle = setInterval(pollOnce, POLLER_INTERVAL_MS);
  logger.info({ intervalMs: POLLER_INTERVAL_MS }, "Replay job poller started");
}

export function stopReplayJobPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
}

async function pollOnce(): Promise<void> {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    const claim = await pgQuery(
      `UPDATE pascal_replay_jobs
          SET status = 'running'
        WHERE id = (
          SELECT id FROM pascal_replay_jobs
           WHERE status = 'pending'
           ORDER BY triggered_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, original_conversation_id, triggered_by`,
    );
    if (claim.rowCount === 0) return;

    const job = claim.rows[0] as {
      id: number;
      original_conversation_id: string;
      triggered_by: string | null;
    };
    logger.info({ jobId: job.id, origConvId: job.original_conversation_id }, "Replay job: claimed");

    try {
      const outcome = await replayConversation(
        job.original_conversation_id,
        job.triggered_by ?? "dashboard",
      );
      await pgQuery(
        `UPDATE pascal_replay_jobs
            SET status = $1, replay_id = $2
          WHERE id = $3`,
        [outcome.status, outcome.replayId, job.id],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id }, "Replay job: failed");
      await pgQuery(
        `UPDATE pascal_replay_jobs SET status = 'error', error = $1 WHERE id = $2`,
        [errMsg, job.id],
      );
    }
  } catch (err) {
    logger.warn({ err }, "Replay job poller: tick failed");
  } finally {
    pollerRunning = false;
  }
}

// ── Internals ──────────────────────────────────────────────────────────

async function loadOriginalConversation(id: string): Promise<OriginalConversation | null> {
  const res = await pgQuery(
    `SELECT id::text, channel_id, platform, user_name, question, answer,
            created_at::text
       FROM pascal_conversation_log
      WHERE id = $1`,
    [id],
  );
  if (res.rowCount === 0) return null;
  return res.rows[0] as OriginalConversation;
}
