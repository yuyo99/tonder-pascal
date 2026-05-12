/**
 * Ticket shortcut: an internal-operator triage gesture.
 *
 * When a Tonder team member replies to a message with the exact body
 * "1" or "2", that's a request to file a Linear ticket about the
 * message they replied to:
 *   1 → Support team (SOS)
 *   2 → Integrations team (INT)
 *
 * The wiring (event handler + reply lookup + permalink) lives in
 * each channel adapter. This module is platform-agnostic — it just
 * defines what the shortcut means and how to format the ticket body.
 */

import type { MerchantContext } from "../merchants/types";
import { createTeamTicket, type TicketResult } from "../linear/client";

export type TicketShortcutTeam = "sos" | "int";

const TEAM_LABELS: Record<TicketShortcutTeam, string> = {
  sos: "Support",
  int: "Integrations",
};

const TITLE_MAX_CHARS = 80;

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
  /** Optional resolved merchant for this channel. */
  merchantCtx?: MerchantContext;
  /** Optional deep-link back to the parent message (Slack permalink or t.me URL). */
  permalink?: string;
  /** Who triggered the shortcut (the operator who typed "1" / "2"). */
  triggeredByName: string;
}

/**
 * Build a Linear ticket from a shortcut trigger and file it.
 * Title = first 80 chars of the parent message; description carries
 * full context (merchant, platform, channel, author, permalink, body).
 */
export async function fileTicketFromShortcut(
  input: TicketShortcutInput
): Promise<TicketResult> {
  const title = buildTitle(input.parentMessageText, input.team);
  const description = buildDescription(input);

  return createTeamTicket({
    team: input.team,
    title,
    description,
    merchantCtx: input.merchantCtx,
    priority: 3, // Normal — matches the "ticket" command default
  });
}

/**
 * Confirmation line to post back in the originating channel.
 * Format: "📋 Created [Support] ticket TND-123 → https://linear.app/..."
 */
export function formatShortcutConfirmation(
  team: TicketShortcutTeam,
  ticket: TicketResult
): string {
  const teamLabel = TEAM_LABELS[team];
  return `📋 Created ${teamLabel} ticket ${ticket.identifier} → ${ticket.url}`;
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
  lines.push(`**Channel:** ${input.channelId}`);
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
