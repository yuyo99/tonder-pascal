/**
 * Fetch recent thread/channel context for ambient triage.
 */

import { WebClient } from "@slack/web-api";
import { logger } from "../../utils/logger";

const MAX_CONTEXT_MESSAGES = 10;

/**
 * Get last N messages from a Slack channel or thread.
 * Returns formatted strings like "UserName: message text"
 */
export async function fetchSlackContext(
  client: WebClient,
  channelId: string,
  threadTs?: string,
  limit = MAX_CONTEXT_MESSAGES
): Promise<string[]> {
  try {
    let messages: Array<{ user?: string; text?: string; ts?: string }>;

    if (threadTs) {
      // Fetch thread replies
      const result = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: limit + 1, // +1 because parent is included
        inclusive: true,
      });
      messages = (result.messages ?? []).slice(-limit);
    } else {
      // Fetch recent channel messages
      const result = await client.conversations.history({
        channel: channelId,
        limit,
      });
      // history returns newest first, reverse for chronological
      messages = (result.messages ?? []).reverse();
    }

    // Resolve user IDs to display names (best-effort cache)
    const userNames = new Map<string, string>();

    const formatted: string[] = [];
    for (const msg of messages) {
      if (!msg.text || !msg.user) continue;

      let name = userNames.get(msg.user);
      if (!name) {
        try {
          const info = await client.users.info({ user: msg.user });
          name = info.user?.real_name || info.user?.name || msg.user;
          userNames.set(msg.user, name);
        } catch {
          name = msg.user;
        }
      }

      // Truncate long messages for context
      const text = msg.text.length > 300 ? msg.text.slice(0, 300) + "..." : msg.text;
      formatted.push(`${name}: ${text}`);
    }

    return formatted;
  } catch (err) {
    logger.warn({ err, channelId }, "Failed to fetch Slack context — continuing without");
    return [];
  }
}
