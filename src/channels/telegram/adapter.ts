import { Telegraf } from "telegraf";
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "../types";
import { logger } from "../../utils/logger";

interface TelegramConfig {
  botToken: string;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  platform = "telegram" as const;
  private bot: Telegraf;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;

  constructor(telegramConfig: TelegramConfig) {
    this.bot = new Telegraf(telegramConfig.botToken);
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("No message handler registered for Telegram adapter");
    }
    const handler = this.messageHandler;

    // Handle text messages
    this.bot.on("text", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const text = ctx.message.text.trim();

      // In groups, only respond when bot is mentioned or replied to
      if (ctx.chat.type !== "private") {
        const botInfo = await this.bot.telegram.getMe();
        const botUsername = botInfo.username;
        const isMentioned = text.includes(`@${botUsername}`);
        const isReply = ctx.message.reply_to_message?.from?.id === botInfo.id;

        if (!isMentioned && !isReply) return;
      }

      // Strip bot mention from text
      const botInfo = await this.bot.telegram.getMe();
      const cleanText = text
        .replace(new RegExp(`@${botInfo.username}`, "gi"), "")
        .trim();

      if (!cleanText) {
        await ctx.reply(
          "Hi! I'm Pascal, your payment assistant. Ask me about your transactions, withdrawals, or anything payment-related."
        );
        return;
      }

      const userName =
        ctx.message.from.first_name +
        (ctx.message.from.last_name ? ` ${ctx.message.from.last_name}` : "");

      logger.info(
        { user: userName, chatId, platform: "telegram" },
        "Received Telegram message"
      );

      // Send "thinking" message
      const thinkingMsg = await ctx.reply("Let me look into that... ⏳");

      try {
        const answer = await handler({
          channelId: chatId,
          platform: "telegram",
          userId: String(ctx.message.from.id),
          userName,
          text: cleanText,
          rawEvent: ctx.message,
        });

        // Edit the thinking message with the answer
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            thinkingMsg.message_id,
            undefined,
            answer,
            { parse_mode: undefined }
          );
        } catch {
          // If edit fails (message too long, etc.), send as new message
          await ctx.reply(answer);
        }
      } catch (err) {
        logger.error({ err }, "Failed to answer Telegram message");
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            thinkingMsg.message_id,
            undefined,
            "Sorry, I encountered an error processing your request. Please try again or contact Tonder support."
          );
        } catch {
          await ctx.reply(
            "Sorry, I encountered an error. Please try again."
          );
        }
      }
    });

    // Error handling
    this.bot.catch((err) => {
      logger.error({ err }, "Telegram bot error");
    });

    // Use polling (not webhooks) for simplicity
    this.bot.launch();
    logger.info("Telegram adapter started (polling)");
  }

  async stop(): Promise<void> {
    this.bot.stop("SIGTERM");
    logger.info("Telegram adapter stopped");
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    const result = await this.bot.telegram.sendMessage(
      msg.channelId,
      msg.text
    );
    return String(result.message_id);
  }

  async updateMessage(
    msg: OutgoingMessage & { messageId: string }
  ): Promise<void> {
    await this.bot.telegram.editMessageText(
      msg.channelId,
      parseInt(msg.messageId, 10),
      undefined,
      msg.text
    );
  }
}
