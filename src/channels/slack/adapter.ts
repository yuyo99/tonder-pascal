import { App } from "@slack/bolt";
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "../types";
import { formatResponse, formatError, formatThinking } from "./formatter";
import { logger } from "../../utils/logger";

interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
}

export class SlackChannelAdapter implements ChannelAdapter {
  platform = "slack" as const;
  private app: App;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;

  constructor(slackConfig: SlackConfig) {
    this.app = new App({
      token: slackConfig.botToken,
      signingSecret: slackConfig.signingSecret,
      appToken: slackConfig.appToken,
      socketMode: true,
    });
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("No message handler registered for Slack adapter");
    }
    const handler = this.messageHandler;

    // Handle @mentions
    this.app.event("app_mention", async ({ event, client }) => {
      const question = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!question) {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: "Hi! I'm Pascal, your payment assistant. Ask me about your transactions, withdrawals, or anything payment-related.",
        });
        return;
      }

      logger.info(
        { user: event.user, channel: event.channel },
        "Received Slack @mention"
      );

      const thinking = await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        blocks: formatThinking(),
        text: "Let me look into that...",
      });

      try {
        const answer = await handler({
          channelId: event.channel,
          platform: "slack",
          userId: event.user || "",
          userName: event.user || "unknown",
          text: question,
          threadId: event.ts,
          rawEvent: event,
        });

        await client.chat.update({
          channel: event.channel,
          ts: thinking.ts!,
          blocks: formatResponse(answer),
          text: answer,
        });
      } catch (err) {
        logger.error({ err }, "Failed to answer Slack @mention");
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        await client.chat.update({
          channel: event.channel,
          ts: thinking.ts!,
          blocks: formatError(errorMsg),
          text: `Error: ${errorMsg}`,
        });
      }
    });

    // Handle DMs
    this.app.event("message", async ({ event, client }) => {
      const msg = event as {
        channel_type?: string; text?: string; user?: string;
        ts?: string; subtype?: string; channel?: string;
      };
      if (msg.channel_type !== "im" || msg.subtype || !msg.text) return;

      const question = msg.text.trim();
      logger.info({ user: msg.user }, "Received Slack DM");

      const thinking = await client.chat.postMessage({
        channel: msg.channel!,
        blocks: formatThinking(),
        text: "Let me look into that...",
      });

      try {
        const answer = await handler({
          channelId: msg.channel!,
          platform: "slack",
          userId: msg.user || "",
          userName: msg.user || "unknown",
          text: question,
          rawEvent: event,
        });

        await client.chat.update({
          channel: msg.channel!,
          ts: thinking.ts!,
          blocks: formatResponse(answer),
          text: answer,
        });
      } catch (err) {
        logger.error({ err }, "Failed to answer Slack DM");
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        await client.chat.update({
          channel: msg.channel!,
          ts: thinking.ts!,
          blocks: formatError(errorMsg),
          text: `Error: ${errorMsg}`,
        });
      }
    });

    await this.app.start();
    logger.info("Slack adapter started (Socket Mode)");
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info("Slack adapter stopped");
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: msg.channelId,
      thread_ts: msg.threadId,
      blocks: formatResponse(msg.text),
      text: msg.text,
    });
    return result.ts || "";
  }

  async updateMessage(msg: OutgoingMessage & { messageId: string }): Promise<void> {
    await this.app.client.chat.update({
      channel: msg.channelId,
      ts: msg.messageId,
      blocks: formatResponse(msg.text),
      text: msg.text,
    });
  }

  /** Expose the Slack client for daily reports */
  get client() {
    return this.app.client;
  }
}
