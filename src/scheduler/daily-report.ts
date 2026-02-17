import { WebClient } from "@slack/web-api";
import { KnownBlock } from "@slack/types";
import { config } from "../config";
import { logger } from "../utils/logger";

// ── Top-Tier Clients ────────────────────────────────────────────────

const TOP_TIER_CLIENTS = ["BC Game", "Afun", "Fun88", "Campobet"];

function isTopTier(merchantName: string): boolean {
  return TOP_TIER_CLIENTS.some(
    (t) => merchantName.toLowerCase().includes(t.toLowerCase())
  );
}

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

// ── Helpers ─────────────────────────────────────────────────────────

interface MerchantStats {
  name: string;
  topTier: boolean;
  answered: number;
  escalated: number;
  tickets: Array<{ id: string; question: string }>;
  questions: string[];
}

function groupByMerchant(interactions: InteractionRecord[]): Map<string, MerchantStats> {
  const map = new Map<string, MerchantStats>();

  for (const i of interactions) {
    let stats = map.get(i.merchantName);
    if (!stats) {
      stats = {
        name: i.merchantName,
        topTier: isTopTier(i.merchantName),
        answered: 0,
        escalated: 0,
        tickets: [],
        questions: [],
      };
      map.set(i.merchantName, stats);
    }

    if (i.answered) {
      stats.answered++;
    } else {
      stats.escalated++;
    }

    if (i.ticketId) {
      stats.tickets.push({ id: i.ticketId, question: i.question });
    }

    // Collect short question previews (strip [TICKET] prefix)
    const q = i.question.replace(/^\[TICKET\]\s*/i, "").slice(0, 50);
    if (stats.questions.length < 5) {
      stats.questions.push(q);
    }
  }

  return map;
}

function buildMerchantBlock(stats: MerchantStats): string {
  const prefix = stats.topTier ? ":star: " : "";
  const tier = stats.topTier ? "  _(Top Tier)_" : "";
  const lines: string[] = [];

  // Header line
  lines.push(`${prefix}*${stats.name}*${tier}`);

  // Stats line
  const parts: string[] = [];
  if (stats.answered > 0) parts.push(`:white_check_mark: ${stats.answered} answered`);
  if (stats.escalated > 0) parts.push(`:warning: ${stats.escalated} escalated`);
  if (stats.tickets.length > 0) {
    const ticketIds = stats.tickets.map((t) => t.id).join(", ");
    parts.push(`:ticket: ${stats.tickets.length} ticket${stats.tickets.length > 1 ? "s" : ""} (${ticketIds})`);
  }
  lines.push(`  ${parts.join("  •  ")}`);

  // Question previews
  if (stats.questions.length > 0) {
    const preview = stats.questions.join(", ");
    lines.push(`  _Questions: ${preview}${stats.questions.length >= 5 ? "..." : ""}_`);
  }

  return lines.join("\n");
}

// ── Per-Merchant Params ─────────────────────────────────────────────

export interface MerchantReportParams {
  merchantLabel: string;
  slackUserId: string;
  businessIds: number[];
}

// ── Daily Report Generation ─────────────────────────────────────────

export async function sendDailyReport(
  slackClient: WebClient,
  merchantParams?: MerchantReportParams
): Promise<void> {
  const allInteractions = getDailyInteractions();

  // If per-merchant, filter to just that merchant's interactions
  const interactions = merchantParams
    ? allInteractions.filter((i) =>
        i.merchantName.toLowerCase().includes(merchantParams.merchantLabel.toLowerCase())
      )
    : allInteractions;

  const recipientUserId = merchantParams?.slackUserId || config.dailyReport.slackUser;

  if (!recipientUserId) {
    logger.warn("No DAILY_REPORT_SLACK_USER configured — skipping daily report");
    return;
  }

  const now = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const totalTickets = interactions.filter((i) => i.ticketId).length;
  const merchantStats = groupByMerchant(interactions);

  // Separate top-tier vs regular merchants (sorted by interaction count desc)
  const topTierStats = [...merchantStats.values()]
    .filter((s) => s.topTier)
    .sort((a, b) => (b.answered + b.escalated) - (a.answered + a.escalated));

  const regularStats = [...merchantStats.values()]
    .filter((s) => !s.topTier)
    .sort((a, b) => (b.answered + b.escalated) - (a.answered + a.escalated));

  // Find top-tier clients with NO activity
  const activeTopTierNames = new Set(topTierStats.map((s) => s.name));
  const inactiveTopTier = TOP_TIER_CLIENTS.filter(
    (name) => ![...activeTopTierNames].some((active) => active.toLowerCase().includes(name.toLowerCase()))
  );

  // ── Build Block Kit blocks ──
  const blocks: KnownBlock[] = [];

  // Header
  const headerText = merchantParams
    ? `:bar_chart: Pascal Daily Report — ${merchantParams.merchantLabel}`
    : ":bar_chart: Pascal Daily Report";
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: headerText },
  });

  // Date + summary
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${now}*\n\nTotal: *${interactions.length}* interactions  •  *${totalTickets}* tickets`,
    },
  });

  // Top-tier merchants section
  if (topTierStats.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: ":star: *TOP TIER CLIENTS*" }],
    });

    for (const stats of topTierStats) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: buildMerchantBlock(stats) },
      });
    }
  }

  // Regular merchants section
  if (regularStats.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: ":office: *OTHER MERCHANTS*" }],
    });

    for (const stats of regularStats) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: buildMerchantBlock(stats) },
      });
    }
  }

  // Inactive top-tier warning
  if (inactiveTopTier.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:zzz: *No activity:* ${inactiveTopTier.join(", ")}`,
        },
      ],
    });
  }

  // Empty day
  if (interactions.length === 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No interactions recorded today._" },
    });
  }

  // Fallback text for notifications
  const reportLabel = merchantParams ? `Pascal Daily Report (${merchantParams.merchantLabel})` : "Pascal Daily Report";
  const fallbackText = `${reportLabel} — ${now}: ${interactions.length} interactions, ${totalTickets} tickets`;

  try {
    const dm = await slackClient.conversations.open({
      users: recipientUserId,
    });

    if (dm.channel?.id) {
      await slackClient.chat.postMessage({
        channel: dm.channel.id,
        blocks,
        text: fallbackText,
      });
      logger.info(
        { recipient: recipientUserId, interactions: interactions.length },
        "Daily report sent"
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to send daily report");
  }

  // Reset daily interactions (only global report resets all; per-merchant doesn't)
  if (!merchantParams) {
    resetDailyInteractions();
  }
}
