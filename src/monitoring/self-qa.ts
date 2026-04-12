/**
 * Self-QA — post-response evaluation for every message Pascal handles.
 * Stores structured QA events in PostgreSQL and raises alerts for failures.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import { alertCritical, alertWarning } from "./alert-router";
import { buildFingerprint } from "./fingerprints";
import { detectAndRecordGap } from "../knowledge/gap-detector";
import type { SelfQAEvent, Severity } from "./types";

// ── Thresholds ──────────────────────────────────────────────────

const LATENCY_WARNING_MS = 30_000;   // 30s
const LATENCY_CRITICAL_MS = 60_000;  // 60s
const DEPOSIT_FAILURE_ALERT_THRESHOLD = 3; // 3 failures in window → critical

// ── Store QA event ──────────────────────────────────────────────

export async function recordSelfQA(event: SelfQAEvent, conversationId?: string): Promise<void> {
  try {
    await pgQuery(
      `INSERT INTO pascal_self_qa_events
         (platform, channel_id, merchant_name, business_id, message_type,
          status, latency_ms, parse_confidence, answer_confidence,
          fallback_used, responded, failure_reason, raw_input, details, conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        event.platform,
        event.channelId,
        event.merchantName,
        event.businessId,
        event.messageType,
        event.status,
        event.latencyMs,
        event.parseConfidence,
        event.answerConfidence,
        event.fallbackUsed,
        event.responded,
        event.failureReason,
        event.rawInput?.slice(0, 2000),
        JSON.stringify(event.details),
        conversationId ?? null,
      ],
    );
  } catch (err) {
    logger.error({ err }, "Failed to store self-QA event");
  }
}

// ── Evaluate and record ─────────────────────────────────────────

/**
 * Evaluate a completed message handling and record the QA event.
 * Automatically classifies severity and raises alerts when needed.
 */
export async function evaluateAndRecord(params: {
  platform: string;
  channelId: string;
  merchantName: string | null;
  businessId: string | null;
  messageType: SelfQAEvent["messageType"];
  latencyMs: number;
  responded: boolean;
  fallbackUsed: boolean;
  failureReason: string | null;
  rawInput: string;
  toolsCalled?: string[];
  rounds?: number;
  parseConfidence?: number | null;
  answerConfidence?: number | null;
  details?: Record<string, unknown>;
  conversationId?: string;
}): Promise<void> {
  const status = classifySeverity(params);

  const event: SelfQAEvent = {
    platform: params.platform,
    channelId: params.channelId,
    merchantName: params.merchantName,
    businessId: params.businessId,
    messageType: params.messageType,
    status,
    latencyMs: params.latencyMs,
    parseConfidence: params.parseConfidence ?? null,
    answerConfidence: params.answerConfidence ?? null,
    fallbackUsed: params.fallbackUsed,
    responded: params.responded,
    failureReason: params.failureReason,
    rawInput: params.rawInput,
    details: {
      toolsCalled: params.toolsCalled ?? [],
      rounds: params.rounds ?? 0,
      ...(params.details ?? {}),
    },
  };

  // Store the event (with conversation link if available)
  await recordSelfQA(event, params.conversationId);

  // Log for observability
  if (status !== "ok") {
    logger.warn(
      {
        status,
        platform: params.platform,
        channelId: params.channelId,
        merchantName: params.merchantName,
        messageType: params.messageType,
        failureReason: params.failureReason,
        latencyMs: params.latencyMs,
        responded: params.responded,
      },
      `Self-QA: ${status} — ${params.failureReason || "degraded"}`,
    );
  }

  // Raise alerts for critical failures
  if (status === "critical") {
    const fingerprint = buildFingerprint(
      params.platform,
      params.channelId,
      params.messageType,
      params.failureReason || "unknown_failure",
    );

    await alertCritical(fingerprint, params.failureReason || "Critical failure", {
      merchantName: params.merchantName ?? undefined,
      channelId: params.channelId,
      service: `${params.platform}-adapter`,
      sample: params.rawInput?.slice(0, 300),
      alertThreshold: params.messageType === "deposit_ticket" ? DEPOSIT_FAILURE_ALERT_THRESHOLD : 1,
      suggestedSteps: getSuggestedSteps(params.messageType, params.failureReason),
    });
  } else if (status === "warning") {
    const fingerprint = buildFingerprint(
      params.platform,
      params.channelId,
      params.messageType,
      params.failureReason || "degraded",
    );

    await alertWarning(fingerprint, params.failureReason || "Degraded performance", {
      merchantName: params.merchantName ?? undefined,
      channelId: params.channelId,
      service: `${params.platform}-adapter`,
      sample: params.rawInput?.slice(0, 300),
      alertThreshold: 3,
      suggestedSteps: getSuggestedSteps(params.messageType, params.failureReason),
    });
  }

  // Record knowledge gap for warning/fallback responses (AID-80)
  if (event.fallbackUsed || status === "warning") {
    detectAndRecordGap({
      question: params.rawInput,
      channelId: params.channelId,
      platform: params.platform,
      merchantName: params.merchantName ?? undefined,
      businessId: params.businessId ? parseInt(params.businessId) : undefined,
    }).catch(err => logger.warn({ err }, "Gap detection failed — non-fatal"));
  }
}

// ── Severity classification ─────────────────────────────────────

function classifySeverity(params: {
  messageType: string;
  latencyMs: number;
  responded: boolean;
  fallbackUsed: boolean;
  failureReason: string | null;
}): Severity {
  // Critical: no response sent for deposit ticket
  if (params.messageType === "deposit_ticket" && !params.responded) {
    return "critical";
  }

  // Critical: any error with no response
  if (params.failureReason && !params.responded) {
    return "critical";
  }

  // Critical: timeout on deposit ticket
  if (params.messageType === "deposit_ticket" && params.latencyMs > LATENCY_CRITICAL_MS) {
    return "critical";
  }

  // Warning: general timeout
  if (params.latencyMs > LATENCY_CRITICAL_MS) {
    return "warning";
  }

  // Warning: high latency
  if (params.latencyMs > LATENCY_WARNING_MS) {
    return "warning";
  }

  // Warning: fallback used
  if (params.fallbackUsed) {
    return "warning";
  }

  // Warning: error but still responded
  if (params.failureReason && params.responded) {
    return "warning";
  }

  return "ok";
}

// ── Suggested remediation steps by failure type ─────────────────

function getSuggestedSteps(messageType: string, failureReason: string | null): string[] {
  if (messageType === "deposit_ticket") {
    if (failureReason?.includes("parse")) {
      return [
        "Check parser format drift — deposit ticket structure may have changed",
        "Inspect raw message in self-QA details",
        "Test lookup_by_id(txid) manually",
      ];
    }
    if (failureReason?.includes("timeout")) {
      return [
        "Check Claude API latency",
        "Check MongoDB query performance",
        "Consider increasing orchestrator timeout",
      ];
    }
    if (failureReason?.includes("lookup") || failureReason?.includes("not_found")) {
      return [
        "Verify txid exists in MongoDB",
        "Check if business_id filter is correct",
        "Test lookup_by_id manually",
      ];
    }
    return [
      "Check deposit ticket flow end-to-end",
      "Inspect last 10 similar failures in self-QA",
      "Verify partner bot detection is working",
    ];
  }

  if (failureReason?.includes("timeout")) {
    return ["Check Claude API status", "Check MongoDB connectivity"];
  }

  return ["Check error logs in Sentry", "Inspect conversation log in Postgres"];
}
