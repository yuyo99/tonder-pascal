import { WebClient } from "@slack/web-api";
import { config } from "../config";
import { logger } from "../utils/logger";

// ── Interaction Tracking ────────────────────────────────────────────

export interface InteractionRecord {
  merchantName: string;
  question: string;
  answered: boolean;
  ticketId?: string;
  timestamp: Date;
}

let dailyInteractions: InteractionRecord[] = [];

export function trackInteraction(record: InteractionRecord): void {
  dailyInteractions.push(record);
}

export function getDailyInteractions(): InteractionRecord[] {
  return [...dailyInteractions];
}

export function resetDailyInteractions(): void {
  dailyInteractions = [];
}

// ── Daily Report Generation ─────────────────────────────────────────

export async function sendDailyReport(slackClient: WebClient): Promise<void> {
  const interactions = getDailyInteractions();
  const recipientUserId = config.dailyReport.slackUser;

  if (!recipientUserId) {
    logger.warn("No DAILY_REPORT_SLACK_USER configured — skipping daily report");
    return;
  }

  // Compute stats
  const answered = interactions.filter((i) => i.answered);
  const notAnswered = interactions.filter((i) => !i.answered);
  const ticketsCreated = interactions.filter((i) => i.ticketId);

  // Group answered by merchant
  const answeredByMerchant = new Map<string, number>();
  for (const i of answered) {
    answeredByMerchant.set(
      i.merchantName,
      (answeredByMerchant.get(i.merchantName) || 0) + 1
    );
  }

  // Group not answered by merchant
  const notAnsweredByMerchant = new Map<string, number>();
  for (const i of notAnswered) {
    notAnsweredByMerchant.set(
      i.merchantName,
      (notAnsweredByMerchant.get(i.merchantName) || 0) + 1
    );
  }

  // Build message
  const now = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [
    `*Pascal Daily Report — ${now}*`,
    "",
    `*Total interactions:* ${interactions.length}`,
    "",
  ];

  // Answered
  lines.push(`*Answered:* ${answered.length}`);
  if (answeredByMerchant.size > 0) {
    for (const [merchant, count] of answeredByMerchant) {
      lines.push(`  • ${merchant}: ${count}`);
    }
  }
  lines.push("");

  // Not answered / escalated
  lines.push(`*Escalated / Not answered:* ${notAnswered.length}`);
  if (notAnsweredByMerchant.size > 0) {
    for (const [merchant, count] of notAnsweredByMerchant) {
      lines.push(`  • ${merchant}: ${count}`);
    }
  }
  lines.push("");

  // Linear tickets
  lines.push(`*Linear tickets created:* ${ticketsCreated.length}`);
  if (ticketsCreated.length > 0) {
    for (const t of ticketsCreated) {
      lines.push(`  • ${t.ticketId} — ${t.merchantName}: "${t.question.slice(0, 60)}${t.question.length > 60 ? "..." : ""}"`);
    }
  }

  const message = lines.join("\n");

  try {
    // Open DM channel with Eugenio
    const dm = await slackClient.conversations.open({
      users: recipientUserId,
    });

    if (dm.channel?.id) {
      await slackClient.chat.postMessage({
        channel: dm.channel.id,
        text: message,
        mrkdwn: true,
      });
      logger.info(
        { recipient: recipientUserId, interactions: interactions.length },
        "Daily report sent"
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to send daily report");
  }

  // Reset daily interactions
  resetDailyInteractions();
}
