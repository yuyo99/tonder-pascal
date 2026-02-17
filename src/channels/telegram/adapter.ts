import { Telegraf } from "telegraf";
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "../types";
import { createSupportTicket, CommandType } from "../../linear/client";
import { resolveMerchantContext, isPartnerBot, hasPartnerBots } from "../../merchants/context";
import { trackInteraction } from "../../scheduler/daily-report";
import { parseDepositTicket, isValidTxid, buildTicketLookupPrompt } from "./partner-bot";
import { logger } from "../../utils/logger";

interface TelegramConfig {
  botToken: string;
}

/**
 * Shared handler for partner bot deposit ticket messages.
 * Returns true if the message was handled (ticket parsed), false otherwise.
 */
async function tryHandleDepositTicket(
  text: string,
  chatId: string,
  userId: string,
  userName: string,
  handler: (msg: IncomingMessage) => Promise<string>,
  replyFn: (answer: string) => Promise<void>,
  rawEvent: unknown,
  logLabel: string
): Promise<boolean> {
  const ticket = parseDepositTicket(text);
  if (!ticket) return false;

  if (!isValidTxid(ticket.txid)) {
    logger.info(
      { chatId, userName, txid: ticket.txid, orderId: ticket.orderId },
      `${logLabel}: blank/invalid txid — ignoring silently`
    );
    return true;
  }

  const lookupPrompt = buildTicketLookupPrompt(ticket);
  try {
    const answer = await handler({
      channelId: chatId,
      platform: "telegram",
      userId,
      userName,
      text: lookupPrompt,
      rawEvent,
    });
    await replyFn(answer);
  } catch (err) {
    logger.error(
      { err, chatId, userName, orderId: ticket.orderId },
      `${logLabel}: failed to process deposit ticket`
    );
    await replyFn("Sorry, I encountered an error looking up this deposit ticket.");
  }
  return true;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  platform = "telegram" as const;
  private bot: Telegraf;
  private messageHandler?: (msg: IncomingMessage) => Promise<string>;
  private botInfo: { username: string; id: number } | null = null;

  constructor(telegramConfig: TelegramConfig) {
    this.bot = new Telegraf(telegramConfig.botToken);
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  // ── Ticket command helpers ──

  private getReplyContext(message: Record<string, unknown>): string {
    const replyMsg = message.reply_to_message as Record<string, unknown> | undefined;
    if (replyMsg?.text) {
      const from = replyMsg.from as Record<string, unknown> | undefined;
      const name = from
        ? `${from.first_name || ""}${from.last_name ? " " + from.last_name : ""}`
        : "unknown";
      return `[${name}]: ${replyMsg.text}`;
    }
    return "(No thread context available — Telegram limitation)";
  }

  private async handleTicketCommand(
    ctx: { chat: { id: number }; message: Record<string, unknown>; reply: (text: string) => Promise<unknown> },
    description: string,
    commandType: CommandType
  ): Promise<void> {
    const chatId = String(ctx.chat.id);
    const merchantCtx = await resolveMerchantContext(chatId, "telegram");

    if (!merchantCtx) {
      await ctx.reply("This chat is not configured for Pascal. Cannot create a ticket.");
      return;
    }

    const conversationContext = this.getReplyContext(ctx.message);
    const from = ctx.message.from as Record<string, unknown> | undefined;
    const userName = from
      ? `${from.first_name || ""}${from.last_name ? " " + from.last_name : ""}`
      : "unknown";

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
      : "Support request from Telegram";

    try {
      const ticket = await createSupportTicket({
        title: ticketTitle,
        description: ticketDescription,
        commandType,
        merchantCtx,
        createdBy: `${userName} (via Telegram)`,
      });

      await ctx.reply(`✅ Ticket created: ${ticket.identifier}\n${ticket.url}\n> ${ticketTitle}`);

      trackInteraction({
        merchantName: merchantCtx.businessName,
        question: `[${commandType.toUpperCase()}] ${description}`,
        answered: false,
        ticketId: ticket.identifier,
        timestamp: new Date(),
      });

      logger.info(
        { ticket: ticket.identifier, merchant: merchantCtx.businessName, user: userName, commandType },
        "Ticket created via Telegram command"
      );
    } catch (err) {
      logger.error({ err, chatId }, "Failed to create Linear ticket from Telegram");
      await ctx.reply("Sorry, I could not create the ticket. Please try again.");
    }
  }

  // ── Main start ──

  async start(): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("No message handler registered for Telegram adapter");
    }
    const handler = this.messageHandler;

    // Catch-all middleware: logs EVERY raw update for debugging
    this.bot.use(async (ctx, next) => {
      logger.info(
        {
          updateType: ctx.updateType,
          chatId: ctx.chat?.id,
          chatType: ctx.chat?.type,
          hasMessage: "message" in ctx.update,
          hasChannelPost: "channel_post" in ctx.update,
        },
        "RAW Telegram update received"
      );
      return next();
    });

    // Handle text messages
    this.bot.on("text", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const text = ctx.message.text.trim();

      // Extract all possible sender identities (bots may use from, sender_chat, or via_bot)
      const fromUsername = ctx.message.from.username || "";
      const senderChatUsername = (ctx.message as unknown as Record<string, Record<string, string>>).sender_chat?.username || "";
      const viaBotUsername = (ctx.message as unknown as Record<string, Record<string, string>>).via_bot?.username || "";

      logger.info(
        {
          chatId, chatType: ctx.chat.type,
          from: fromUsername, fromIsBot: ctx.message.from.is_bot,
          senderChat: senderChatUsername || undefined,
          viaBot: viaBotUsername || undefined,
          text: text.slice(0, 80),
        },
        "Telegram text event received"
      );

      // ── Partner bot auto-response (before mention check) ──
      if (ctx.chat.type !== "private") {
        // Method 1: Username-based detection
        const partnerUsername = [fromUsername, senderChatUsername, viaBotUsername]
          .find(u => u && isPartnerBot(chatId, "telegram", u)) || "";

        // Method 2: Content-based fallback — if channel has partner bots configured,
        // try matching the deposit ticket format (covers cases where Telegram hides
        // the bot identity behind the channel's sender_chat)
        const isPartnerChannel = !partnerUsername && hasPartnerBots(chatId, "telegram");

        if (partnerUsername || isPartnerChannel) {
          const label = partnerUsername || "content-match";
          logger.info(
            { chatId, detectedBy: partnerUsername ? "username" : "content", label, text: text.slice(0, 80) },
            "Partner bot message candidate — checking deposit ticket format"
          );

          const replyToMsg = async (answer: string) => {
            await ctx.reply(answer, { reply_parameters: { message_id: ctx.message.message_id } });
          };

          const handled = await tryHandleDepositTicket(
            text, chatId, String(ctx.message.from.id), label,
            handler, replyToMsg, ctx.message, "text-handler partner bot"
          );

          if (handled) return;

          // If username matched but content didn't parse, ignore silently
          if (partnerUsername) {
            logger.debug({ chatId, label }, "Partner bot message did not match deposit ticket format — ignoring");
            return;
          }
          // If only content-based, fall through to normal mention check
        }
      }

      // In groups/supergroups, only respond when bot is mentioned or replied to
      if (ctx.chat.type !== "private") {
        if (!this.botInfo) {
          logger.error({ chatId }, "Bot identity not resolved — cannot check mentions");
          return;
        }
        const isMentioned = text.includes(`@${this.botInfo.username}`);
        const isReply = ctx.message.reply_to_message?.from?.id === this.botInfo.id;

        if (!isMentioned && !isReply) {
          logger.debug({ chatId, isMentioned, isReply, botUsername: this.botInfo.username }, "Ignored Telegram group message (not mentioned/replied)");
          return;
        }
      }

      // Strip bot mention from text
      const botUsername = this.botInfo?.username || "";
      const cleanText = botUsername
        ? text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim()
        : text;

      if (!cleanText) {
        await ctx.reply(
          "Hi! I'm Pascal, your payment assistant. Ask me about your transactions, withdrawals, or anything payment-related."
        );
        return;
      }

      // CHECK: Is this a command? (ticket, bug, feature, escalate)
      const commandMatch = cleanText.match(/^(ticket|bug|feature|escalate)\s*(.*)/i);
      if (commandMatch) {
        const cmdType = commandMatch[1].toLowerCase() as CommandType;
        const description = commandMatch[2].trim();
        await this.handleTicketCommand(ctx as unknown as Parameters<typeof this.handleTicketCommand>[0], description, cmdType);
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

    // Handle channel posts (Telegram channels are broadcast-only, different from groups)
    this.bot.on("channel_post", async (ctx) => {
      const post = ctx.channelPost;
      if (!("text" in post) || !post.text) return;

      const chatId = String(ctx.chat.id);
      const text = post.text.trim();

      logger.info(
        { chatId, chatType: ctx.chat.type, text: text.slice(0, 80) },
        "Telegram channel_post event received"
      );

      // ── Partner bot auto-response (channel posts) ──
      const postSenderChat = (post as unknown as Record<string, unknown>).sender_chat as Record<string, unknown> | undefined;
      const postFromField = (post as unknown as Record<string, unknown>).from as Record<string, unknown> | undefined;
      const postFromUsername = (postSenderChat?.username as string) || (postFromField?.username as string) || "";

      // Method 1: Username-based detection
      const isPostPartnerUsername = postFromUsername && isPartnerBot(chatId, "telegram", postFromUsername);
      // Method 2: Content-based fallback for partner bot channels
      const isPostPartnerChannel = !isPostPartnerUsername && hasPartnerBots(chatId, "telegram");

      if (isPostPartnerUsername || isPostPartnerChannel) {
        const label = isPostPartnerUsername ? postFromUsername : "content-match";
        logger.info(
          { chatId, detectedBy: isPostPartnerUsername ? "username" : "content", label, text: text.slice(0, 80) },
          "Partner bot channel_post candidate — checking deposit ticket format"
        );

        const replyFn = async (answer: string) => { await ctx.reply(answer); };

        const handled = await tryHandleDepositTicket(
          text, chatId, "channel", label,
          handler, replyFn, post, "channel_post partner bot"
        );

        if (handled) return;

        // Username matched but content didn't parse — ignore silently
        if (isPostPartnerUsername) {
          logger.debug({ chatId, label }, "Partner bot channel_post did not match deposit ticket format — ignoring");
          return;
        }
        // Content-based fallback didn't match — fall through to normal channel handling
      }

      // In channels, respond to ALL text posts (no mention required — channels are broadcast)
      const botUsername = this.botInfo?.username || "";
      const cleanText = botUsername
        ? text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim()
        : text;

      if (!cleanText) {
        await ctx.reply(
          "Hi! I'm Pascal, your payment assistant. Ask me about your transactions, withdrawals, or anything payment-related."
        );
        return;
      }

      // CHECK: Is this a command? (ticket, bug, feature, escalate)
      const channelCmdMatch = cleanText.match(/^(ticket|bug|feature|escalate)\s*(.*)/i);
      if (channelCmdMatch) {
        const cmdType = channelCmdMatch[1].toLowerCase() as CommandType;
        const description = channelCmdMatch[2].trim();
        await this.handleTicketCommand(
          { chat: ctx.chat, message: post as unknown as Record<string, unknown>, reply: (t: string) => ctx.reply(t) },
          description,
          cmdType
        );
        return;
      }

      logger.info(
        { chatId, platform: "telegram" },
        "Processing Telegram channel post"
      );

      // Send "thinking" message
      const thinkingMsg = await ctx.reply("Let me look into that... ⏳");

      try {
        const answer = await handler({
          channelId: chatId,
          platform: "telegram",
          userId: "channel",
          userName: "Channel Post",
          text: cleanText,
          rawEvent: post,
        });

        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            thinkingMsg.message_id,
            undefined,
            answer,
            { parse_mode: undefined }
          );
        } catch {
          await ctx.reply(answer);
        }
      } catch (err) {
        logger.error({ err }, "Failed to answer Telegram channel post");
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            thinkingMsg.message_id,
            undefined,
            "Sorry, I encountered an error processing your request. Please try again or contact Tonder support."
          );
        } catch {
          await ctx.reply("Sorry, I encountered an error. Please try again.");
        }
      }
    });

    // Error handling — catch errors so they don't crash the process
    this.bot.catch((err) => {
      logger.error({ err }, "Telegram bot error");
    });

    // Resolve bot identity once (cached for mention detection)
    try {
      const me = await this.bot.telegram.getMe();
      this.botInfo = { username: me.username || "", id: me.id };
      logger.info(
        { botUsername: this.botInfo.username, botId: this.botInfo.id },
        "Telegram bot identity resolved"
      );
    } catch (err) {
      logger.error({ err }, "Failed to resolve Telegram bot identity — mentions won't work");
    }

    // Use polling (not webhooks) for simplicity
    // Launch in background — don't await so a polling conflict doesn't crash the app
    this.bot
      .launch({ dropPendingUpdates: true, allowedUpdates: ["message", "channel_post"] })
      .then(() => logger.info("Telegram polling CONFIRMED active"))
      .catch((err) => {
        logger.error({ err }, "Telegram bot launch failed — will continue without Telegram");
      });
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
