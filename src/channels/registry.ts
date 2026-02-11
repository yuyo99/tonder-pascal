import { config } from "../config";
import { ChannelAdapter, IncomingMessage } from "./types";
import { SlackChannelAdapter } from "./slack/adapter";
import { TelegramChannelAdapter } from "./telegram/adapter";
import { logger } from "../utils/logger";

/**
 * Boot all enabled channel adapters and wire them to the message handler.
 * Returns the list of active adapters.
 */
export async function bootChannels(
  messageHandler: (msg: IncomingMessage) => Promise<string>
): Promise<ChannelAdapter[]> {
  const adapters: ChannelAdapter[] = [];

  if (config.slack.enabled) {
    const slack = new SlackChannelAdapter({
      botToken: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      appToken: config.slack.appToken,
    });
    slack.onMessage(messageHandler);
    await slack.start();
    adapters.push(slack);
  }

  if (config.telegram.enabled) {
    try {
      const telegram = new TelegramChannelAdapter({
        botToken: config.telegram.botToken,
      });
      telegram.onMessage(messageHandler);
      await telegram.start();
      adapters.push(telegram);
    } catch (err) {
      logger.error({ err }, "Telegram adapter failed to start — continuing without Telegram");
    }
  }

  if (adapters.length === 0) {
    logger.warn("No channel adapters enabled! Set SLACK_ENABLED=true or TELEGRAM_ENABLED=true.");
  }

  return adapters;
}

/** Find the Slack adapter (used for daily reports) */
export function findSlackAdapter(adapters: ChannelAdapter[]): SlackChannelAdapter | undefined {
  return adapters.find((a) => a.platform === "slack") as SlackChannelAdapter | undefined;
}
