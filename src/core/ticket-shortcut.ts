/**
 * Ticket shortcut: an internal-operator triage gesture.
 *
 * When a Tonder team member replies to a message with the exact body
 * "1" or "2", that's a request to file a Linear ticket about the
 * message they replied to:
 *   1 → Support team (SOS)
 *   2 → Integrations team (INT)
 *
 * Behavior:
 *   • The shortcut is SILENT in the originating channel — no reply
 *     visible to the merchant. The operator's "1"/"2" is the only
 *     trace.
 *   • A short, plain-language notice is posted to a single internal
 *     Slack channel (CUSTOMER_INTEGRATIONS_SLACK_CHANNEL_ID) so the
 *     team sees what was filed and where it came from.
 *
 * The wiring (event handler + reply lookup) lives in each channel
 * adapter. This module is platform-agnostic — it just defines what
 * the shortcut means, files the Linear ticket, and posts the
 * internal notice.
 */

import type { WebClient } from "@slack/web-api";
import type { MerchantContext } from "../merchants/types";
import { createTeamTicket, type TicketResult } from "../linear/client";
import { logger } from "../utils/logger";

export type TicketShortcutTeam = "sos" | "int";

const TEAM_LABELS: Record<TicketShortcutTeam, string> = {
  sos: "Support",
  int: "Integrations",
};

const TITLE_MAX_CHARS = 80;
const INTERNAL_QUOTE_MAX_CHARS = 240;

// Internal Slack channel for shortcut notifications.
// Set CUSTOMER_INTEGRATIONS_SLACK_CHANNEL_ID on Railway.
const INTERNAL_CHANNEL_ID = process.env.CUSTOMER_INTEGRATIONS_SLACK_CHANNEL_ID || "";

// Set at boot by src/index.ts so this module can post to Slack
// without being tied to the Slack adapter's event loop.
let internalSlackClient: WebClient | null = null;

export function setShortcutSlackClient(client: WebClient): void {
  internalSlackClient = client;
}

/**
 * Returns the target team if `text` (trimmed) is an exact "1" or "2".
 * Returns null otherwise — caller should fall through to normal handling.
 */
export function parseTicketShortcut(text: string | undefined | null): TicketShortcutTeam | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed === "1") return "sos";
  if (trimmed === "2") return "int";
  return null;
}

export interface TicketShortcutInput {
  team: TicketShortcutTeam;
  /** The message that was replied to — the actual subject of the ticket. */
  parentMessageText: string;
  /** Display name of the person who wrote the parent message (best-effort). */
  parentAuthorName?: string;
  /** Platform the message lives on. */
  platform: "slack" | "telegram";
  /** Channel / chat ID for context. */
  channelId: string;
  /** Human-readable channel name for the internal notice, e.g. "#bcgame-tonder" or "BC Game Tonder". */
  channelDisplayName?: string;
  /** Optional resolved merchant for this channel. */
  merchantCtx?: MerchantContext;
  /** Optional deep-link back to the parent message (Slack permalink or t.me URL). */
  permalink?: string;
  /** Who triggered the shortcut (the operator who typed "1" / "2"). */
  triggeredByName: string;
}

/**
 * File a Linear ticket from a shortcut trigger and post an internal
 * notice. The Linear ticket creation is the source of truth — if the
 * internal Slack post fails (missing env var, API hiccup), the ticket
 * is still created and the operator's action isn't lost.
 */
export async function fileTicketFromShortcut(
  input: TicketShortcutInput
): Promise<TicketResult> {
  const title = buildTitle(input.parentMessageText, input.team);
  const description = buildDescription(input);

  const ticket = await createTeamTicket({
    team: input.team,
    title,
    description,
    merchantCtx: input.merchantCtx,
    priority: 3,
  });

  // Internal notice — best-effort, never fail the operator's action on this
  try {
    await postInternalNotice(input, ticket);
  } catch (err) {
    logger.error(
      { err, identifier: ticket.identifier },
      "ticket-shortcut: failed to post internal notice (ticket was filed)"
    );
  }

  return ticket;
}

// ── internals ─────────────────────────────────────────────────────────────

function buildTitle(parentText: string, team: TicketShortcutTeam): string {
  const cleaned = parentText.replace(/\s+/g, " ").trim();
  const prefix = team === "sos" ? "[Support] " : "[Integrations] ";
  const body = cleaned.length > TITLE_MAX_CHARS
    ? cleaned.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + "…"
    : cleaned || "(empty message)";
  return `${prefix}${body}`;
}

function buildDescription(input: TicketShortcutInput): string {
  const lines: string[] = [];
  lines.push(`**Filed by:** ${input.triggeredByName} (replied "${input.team === "sos" ? "1" : "2"}")`);
  if (input.parentAuthorName) {
    lines.push(`**Original message from:** ${input.parentAuthorName}`);
  }
  lines.push(`**Platform:** ${input.platform}`);
  lines.push(`**Channel:** ${input.channelDisplayName || input.channelId}`);
  if (input.permalink) {
    lines.push(`**Link:** ${input.permalink}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**Original message:**");
  lines.push("");
  lines.push(input.parentMessageText || "_(empty)_");
  return lines.join("\n");
}

/**
 * Post a short, conversational note to the internal channel. Aims to
 * read like a teammate dropping a heads-up, not a corporate template.
 *
 * Example:
 *   Roberto flagged a message in BC Game Tonder for Support — filed
 *   as SOS-418.
 *   "OrderId: 1862665271344979487 TxId: 4471421 Currency: MXN Amount: 50"
 *   https://linear.app/tonderio/issue/SOS-418
 */
async function postInternalNotice(
  input: TicketShortcutInput,
  ticket: TicketResult
): Promise<void> {
  if (!internalSlackClient) {
    logger.warn(
      { identifier: ticket.identifier },
      "ticket-shortcut: no internal Slack client configured — skipping notice"
    );
    return;
  }
  if (!INTERNAL_CHANNEL_ID) {
    logger.warn(
      { identifier: ticket.identifier },
      "ticket-shortcut: CUSTOMER_INTEGRATIONS_SLACK_CHANNEL_ID env not set — skipping notice"
    );
    return;
  }

  const teamLabel = TEAM_LABELS[input.team];
  const where = input.channelDisplayName
    ? input.channelDisplayName
    : input.platform === "slack"
      ? `a Slack channel (${input.channelId})`
      : `a Telegram chat (${input.channelId})`;
  const merchantSuffix = input.merchantCtx?.businessName
    ? ` (${input.merchantCtx.businessName})`
    : "";

  // Quoted snippet of the original message — Slack mrkdwn block quote.
  const snippet = (input.parentMessageText || "(no text)")
    .replace(/\s+/g, " ")
    .trim();
  const trimmedSnippet = snippet.length > INTERNAL_QUOTE_MAX_CHARS
    ? snippet.slice(0, INTERNAL_QUOTE_MAX_CHARS - 1).trimEnd() + "…"
    : snippet;

  // First line — who, where, what got filed
  const summary = `${input.triggeredByName} flagged a message in ${where}${merchantSuffix} for ${teamLabel} — filed as ${ticket.identifier}.`;

  // Slack block-quote prefix (">") so the original question is visually separate
  const quoted = trimmedSnippet
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  const text = [summary, quoted, ticket.url].join("\n");

  await internalSlackClient.chat.postMessage({
    channel: INTERNAL_CHANNEL_ID,
    text,
    unfurl_links: false, // keep the Linear card from auto-expanding inline
    unfurl_media: false,
  });
}
