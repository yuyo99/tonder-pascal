/**
 * Monitoring domain types for Pascal's self-monitoring system.
 */

// ── Severity levels ─────────────────────────────────────────────

export type Severity = "ok" | "warning" | "critical";

// ── Self-QA event (post-response evaluation) ────────────────────

export interface SelfQAEvent {
  platform: string;
  channelId: string;
  merchantName: string | null;
  businessId: string | null;
  messageType: "deposit_ticket" | "mention" | "dm" | "ambient" | "command" | "unknown";
  status: Severity;
  latencyMs: number;
  parseConfidence: number | null;
  answerConfidence: number | null;
  fallbackUsed: boolean;
  responded: boolean;
  failureReason: string | null;
  rawInput: string;
  details: Record<string, unknown>;
}

// ── Incident (deduplicated by fingerprint) ──────────────────────

export interface Incident {
  severity: Severity;
  fingerprint: string;
  merchantName: string | null;
  channelId: string | null;
  details: Record<string, unknown>;
}

// ── Alert payload for Slack ─────────────────────────────────────

export interface AlertPayload {
  severity: Severity;
  service: string;
  merchantName: string | null;
  channelId: string | null;
  failure: string;
  occurrences: number;
  lastSeen: string;
  sample: string | null;
  suggestedSteps: string[];
}

// ── Heartbeat meta ──────────────────────────────────────────────

export interface HeartbeatMeta {
  uptime: number;
  memoryMb: number;
  slackConnected: boolean;
  telegramConnected: boolean;
  channelIndexSize: number;
  lastConfigPoll: string | null;
}

// ── Synthetic check result ──────────────────────────────────────

export interface SyntheticCheckResult {
  checkName: string;
  status: "pass" | "fail";
  latencyMs: number;
  details: Record<string, unknown>;
}
