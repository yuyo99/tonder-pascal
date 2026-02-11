import { App } from "@slack/bolt";
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "../types";
import { formatResponse, formatError, formatThinking } from "./formatter";
import { createSupportTicket } from "../../linear/client";
import { resolveMerchantContext } from "../../merchants/context";
import { trackInteraction } from "../../scheduler/daily-report";
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
  private processedEvents = new Set<string>();

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

  // ── Ticket command helpers ──

  private async getConversationContext(
    channelId: string,
    threadTs?: string
  ): Promise<string> {
    try {
      let messages: Array<{ user?: string; text?: string; ts?: string }>;

      if (threadTs) {
        const result = await this.app.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          limit: 20,
        });
        messages = (result.messages || []) as Array<{ user?: string; text?: string; ts?: string }>;
      } else {
        const result = await this.app.client.conversations.history({
          channel: channelId,
          limit: 15,
        });
        messages = ((result.messages || []) as Array<{ user?: string; text?: string; ts?: string }>).reverse();
      }

      return messages
        .filter((m) => m.text)
        .map((m) => `[${m.user || "unknown"}]: ${m.text}`)
        .join("\n");
    } catch (err) {
      logger.warn({ err, channelId }, "Failed to fetch conversation context");
      return "(Could not retrieve conversation context)";
    }
  }

  private async handleTicketCommand(
    channelId: string,
    eventTs: string,
    userId: string,
    description: string,
    threadTs?: string
  ): Promise<void> {
    const merchantCtx = await resolveMerchantContext(channelId, "slack");
    if (!merchantCtx) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs || eventTs,
        text: "This channel is not configured for Pascal. Cannot create a ticket.",
      });
      return;
    }

    const conversationContext = await this.getConversationContext(
      channelId,
      threadTs
    );

    const ticketDescription = [
      `**Conversation context:**`,
      "```",
      conversationContext,
      "```",
      "",
      `**Operator note:** ${description || "(no additional description)"}`,
    ].join("\n");

    const ticketTitle = description
      ? description.slice(0, 80)
      : "Support request from Slack";

    try {
      const ticket = await createSupportTicket({
        title: ticketTitle,
        description: ticketDescription,
        priority: "medium",
        merchantCtx,
        createdBy: `Slack operator <@${userId}>`,
      });

      await this.app.client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs || eventTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *Ticket created:* <${ticket.url}|${ticket.identifier}>\n>${ticketTitle}`,
            },
          },
        ],
        text: `Ticket created: ${ticket.identifier} — ${ticket.url}`,
      });

      trackInteraction({
        merchantName: merchantCtx.businessName,
        question: `[TICKET] ${description}`,
        answered: false,
        ticketId: ticket.identifier,
        timestamp: new Date(),
      });

      logger.info(
        { ticket: ticket.identifier, merchant: merchantCtx.businessName, user: userId },
        "Ticket created via @Pascal ticket command"
      );
    } catch (err) {
      logger.error({ err, channelId }, "Failed to create Linear ticket");
      await this.app.client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs || eventTs,
        text: "Sorry, I could not create the ticket. Please try again or create it manually in Linear.",
      });
    }
  }

  // ── Main start ──

  async start(): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("No message handler registered for Slack adapter");
    }
    const handler = this.messageHandler;

    // Handle @mentions
    this.app.event("app_mention", async ({ event, client }) => {
      logger.info({ channel: event.channel, user: event.user, text: event.text }, "app_mention received");

      // Dedup: prevent double-processing if both app_mention and message fire
      if (this.processedEvents.has(event.ts)) return;
      this.processedEvents.add(event.ts);
      if (this.processedEvents.size > 100) {
        const entries = [...this.processedEvents];
        this.processedEvents = new Set(entries.slice(-50));
      }

      const question = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!question) {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: "Hi! I'm Pascal, your payment assistant. Ask me about your transactions, withdrawals, or anything payment-related.",
        });
        return;
      }

      // CHECK: Is this a ticket command?
      if (question.toLowerCase().startsWith("ticket")) {
        const description = question.replace(/^ticket\s*/i, "").trim();
        await this.handleTicketCommand(
          event.channel,
          event.ts,
          event.user || "",
          description,
          event.thread_ts
        );
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
      logger.info({ channel: msg.channel, channelType: msg.channel_type, subtype: msg.subtype }, "message event received");
      if (msg.channel_type !== "im" || msg.subtype || !msg.text) return;

      // Strip any @mentions (user may DM with @Pascal prefix)
      const question = msg.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!question) return;
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
