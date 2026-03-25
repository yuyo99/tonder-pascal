/**
 * Alert router — sends Pascal monitoring alerts to Slack.
 * Deduplicates via incident store; only fires alert when:
 * - New critical incident
 * - Repeated failure crosses threshold (e.g., 3 in 15 min)
 */

import { WebClient } from "@slack/web-api";
import { logger } from "../utils/logger";
import { recordIncident } from "./incident-store";
import type { AlertPayload, Incident, Severity } from "./types";

// ── Configuration ────────────────────────────────────────────────

const ALERT_CHANNEL = process.env.PASCAL_ALERTS_SLACK_CHANNEL_ID || "C0AF237ATKJ"; // default: training-pascal
let slackClient: WebClient | null = null;

export function setAlertSlackClient(client: WebClient): void {
  slackClient = client;
}

// ── Main alert function ─────────────────────────────────────────

/**
 * Record an incident and optionally fire a Slack alert.
 * Alert fires when: new critical, or occurrences >= alertThreshold.
 */
export async function raiseAlert(
  incident: Incident,
  opts: {
    alertThreshold?: number;
    sample?: string;
    suggestedSteps?: string[];
    service?: string;
  } = {},
): Promise<void> {
  const { alertThreshold = 1, sample = null, suggestedSteps = [], service = "pascal" } = opts;

  const { isNew, occurrences } = await recordIncident(incident);

  const shouldAlert =
    (incident.severity === "critical" && isNew) ||
    (occurrences >= alertThreshold && occurrences % alertThreshold === 0);

  if (!shouldAlert) {
    logger.debug(
      { fingerprint: incident.fingerprint, occurrences, severity: incident.severity },
      "Incident recorded but alert suppressed (dedup)",
    );
    return;
  }

  const payload: AlertPayload = {
    severity: incident.severity,
    service,
    merchantName: incident.merchantName,
    channelId: incident.channelId,
    failure: incident.details.failure as string || incident.fingerprint,
    occurrences,
    lastSeen: new Date().toISOString(),
    sample,
    suggestedSteps,
  };

  await sendSlackAlert(payload);
}

// ── Slack message formatting ────────────────────────────────────

async function sendSlackAlert(payload: AlertPayload): Promise<void> {
  if (!slackClient) {
    logger.warn({ payload }, "Alert skipped — no Slack client configured");
    return;
  }

  const emoji = payload.severity === "critical" ? "🚨" : "⚠️";
  const color = payload.severity === "critical" ? "#dc2626" : "#f59e0b";

  const fields: string[] = [
    `*Severity:* ${payload.severity}`,
    `*Service:* ${payload.service}`,
  ];
  if (payload.merchantName) fields.push(`*Merchant:* ${payload.merchantName}`);
  if (payload.channelId) fields.push(`*Channel:* ${payload.channelId}`);
  fields.push(`*Failure:* ${payload.failure}`);
  fields.push(`*Occurrences:* ${payload.occurrences}`);
  fields.push(`*Last seen:* ${payload.lastSeen}`);

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} Pascal Alert`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: fields.join("\n") },
    },
  ];

  if (payload.sample) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Sample:*\n\`\`\`${payload.sample.slice(0, 500)}\`\`\`` },
      },
    );
  }

  if (payload.suggestedSteps.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Suggested next steps:*\n${payload.suggestedSteps.map((s) => `• ${s}`).join("\n")}`,
      },
    });
  }

  try {
    await slackClient.chat.postMessage({
      channel: ALERT_CHANNEL,
      blocks,
      text: `${emoji} Pascal Alert: ${payload.failure}`,
    });
    logger.info(
      { severity: payload.severity, fingerprint: payload.failure, channel: ALERT_CHANNEL },
      "Monitoring alert sent to Slack",
    );
  } catch (err) {
    logger.error({ err }, "Failed to send monitoring alert to Slack");
  }
}

// ── Convenience helpers ─────────────────────────────────────────

export async function alertCritical(
  fingerprint: string,
  failure: string,
  opts: Partial<Incident> & { sample?: string; suggestedSteps?: string[]; service?: string; alertThreshold?: number } = {},
): Promise<void> {
  await raiseAlert(
    {
      severity: "critical",
      fingerprint,
      merchantName: opts.merchantName ?? null,
      channelId: opts.channelId ?? null,
      details: { failure, ...opts },
    },
    {
      sample: opts.sample,
      suggestedSteps: opts.suggestedSteps ?? [],
      service: opts.service ?? "pascal",
      alertThreshold: opts.alertThreshold,
    },
  );
}

export async function alertWarning(
  fingerprint: string,
  failure: string,
  opts: Partial<Incident> & { sample?: string; suggestedSteps?: string[]; service?: string; alertThreshold?: number } = {},
): Promise<void> {
  await raiseAlert(
    {
      severity: "warning",
      fingerprint,
      merchantName: opts.merchantName ?? null,
      channelId: opts.channelId ?? null,
      details: { failure, ...opts },
    },
    {
      sample: opts.sample,
      suggestedSteps: opts.suggestedSteps ?? [],
      service: opts.service ?? "pascal",
      alertThreshold: opts.alertThreshold ?? 3,
    },
  );
}
