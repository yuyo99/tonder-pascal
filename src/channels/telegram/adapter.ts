import { Telegraf } from "telegraf";
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from "../types";
import { createSupportTicket, CommandType } from "../../linear/client";
import { resolveMerchantContext, isPartnerBot, hasPartnerBots } from "../../merchants/context";
import { trackInteraction } from "../../scheduler/daily-report";
import { parseDepositTicket, isValidTxid, buildTicketLookupPrompt } from "./partner-bot";
import { logger } from "../../utils/logger";
import { storeErrorFromCatch, storeError } from "../../utils/error-store";

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
  logger.info({ chatId, ticketParsed: !!ticket, orderId: ticket?.orderId, txid: ticket?.txid },
    `${logLabel}: deposit ticket parse result`);
  if (!ticket) return false;

  if (!isValidTxid(ticket.txid)) {
    logger.info(
      { chatId, userName, txid: ticket.txid, orderId: ticket.orderId },
      `${logLabel}: blank/invalid txid — ignoring silently`
    );
    return true;
  }

  const lookupPrompt = buildTicketLookupPrompt(ticket);
  logger.info({ chatId, orderId: ticket.orderId, txid: ticket.txid },
    `${logLabel}: calling orchestrator for deposit ticket lookup`);
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
    storeErrorFromCatch("telegram", err, { channel: chatId, user: userName, action: "deposit_ticket", orderId: ticket.orderId });
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
      storeErrorFromCatch("telegram", err, { channel: chatId, action: "create_ticket" });
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
      const msg = (ctx.update as unknown as Record<string, unknown>).message as Record<string, unknown> | undefined;
      const from = msg?.from as Record<string, unknown> | undefined;
      logger.info(
        {
          updateType: ctx.updateType,
          chatId: ctx.chat?.id,
          chatType: ctx.chat?.type,
          fromId: from?.id,
          fromUsername: from?.username,
          fromIsBot: from?.is_bot,
          hasText: !!(msg?.text),
          hasPhoto: !!(msg?.photo),
          hasDocument: !!(msg?.document),
          hasCaption: !!(msg?.caption),
        },
        "RAW Telegram update received"
      );
      return next();
    });

    // ── Shared partner bot detection for any message type ──
    const checkPartnerBot = async (
      chatId: string,
      chatType: string,
      text: string,
      fromId: string,
      fromUsername: string,
      senderChatUsername: string,
      viaBotUsername: string,
      messageId: number,
      replyFn: (answer: string) => Promise<void>,
      rawEvent: unknown,
      eventType: string
    ): Promise<boolean> => {
      if (chatType === "private" || !text) return false;

      logger.info({ chatId, chatType, fromUsername, senderChatUsername, viaBotUsername, text: text.slice(0, 60) },
        `checkPartnerBot [${eventType}]: evaluating`);

      // Method 1: Username-based detection
      const partnerUsername = [fromUsername, senderChatUsername, viaBotUsername]
        .find(u => u && isPartnerBot(chatId, "telegram", u)) || "";

      logger.info({ chatId, partnerUsername: partnerUsername || "(none)", fromUsername },
        `checkPartnerBot [${eventType}]: username match result`);

      // Method 2: Content-based fallback
      const isPartnerChannel = !partnerUsername && hasPartnerBots(chatId, "telegram");

      logger.info({ chatId, isPartnerChannel, hasPartnerBots: hasPartnerBots(chatId, "telegram") },
        `checkPartnerBot [${eventType}]: fallback check`);

      if (!partnerUsername && !isPartnerChannel) return false;

      const label = partnerUsername || "content-match";
      logger.info(
        { chatId, detectedBy: partnerUsername ? "username" : "content", label, fromUsername, senderChatUsername, viaBotUsername, text: text.slice(0, 80) },
        `Partner bot ${eventType} candidate — checking deposit ticket format`
      );

      const handled = await tryHandleDepositTicket(
        text, chatId, fromId, label,
        handler, replyFn, rawEvent, `${eventType} partner bot`
      );

      if (handled) return true;

      // Content fallback detected channel but ticket didn't parse — log for diagnostics
      if (isPartnerChannel && !handled) {
        logger.info({ chatId, fromUsername, text: text.slice(0, 100) },
          "Content fallback: partner channel detected but deposit ticket parse failed");
      }

      // Username matched but content didn't parse — ignore silently
      if (partnerUsername) {
        logger.debug({ chatId, label }, `Partner bot ${eventType} did not match deposit ticket format — ignoring`);
        return true;
      }
      // Content-based fallback didn't match — fall through
      return false;
    };

    // ── Extract sender identities from a message ──
    const extractSenderInfo = (message: Record<string, unknown>) => {
      const from = message.from as Record<string, unknown> | undefined;
      const senderChat = message.sender_chat as Record<string, unknown> | undefined;
      const viaBot = message.via_bot as Record<string, unknown> | undefined;
      return {
        fromUsername: (from?.username as string) || "",
        fromId: String((from?.id as number) || ""),
        fromIsBot: (from?.is_bot as boolean) || false,
        senderChatUsername: (senderChat?.username as string) || "",
        viaBotUsername: (viaBot?.username as string) || "",
      };
    };

    // Handle text messages
    this.bot.on("text", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const text = ctx.message.text.trim();
      const sender = extractSenderInfo(ctx.message as unknown as Record<string, unknown>);

      logger.info(
        {
          chatId, chatType: ctx.chat.type,
          from: sender.fromUsername, fromIsBot: sender.fromIsBot,
          senderChat: sender.senderChatUsername || undefined,
          viaBot: sender.viaBotUsername || undefined,
          text: text.slice(0, 80),
        },
        "Telegram text event received"
      );

      // ── Partner bot auto-response (before mention check) ──
      const replyToMsg = async (answer: string) => {
        await ctx.reply(answer, { reply_parameters: { message_id: ctx.message.message_id } });
      };
      const wasPartnerBot = await checkPartnerBot(
        chatId, ctx.chat.type, text,
        sender.fromId, sender.fromUsername, sender.senderChatUsername, sender.viaBotUsername,
        ctx.message.message_id, replyToMsg, ctx.message, "text"
      );
      if (wasPartnerBot) return;

      // In groups/supergroups, only respond when bot is mentioned or replied to
      if (ctx.chat.type !== "private") {
        if (!this.botInfo) {
          logger.error({ chatId }, "Bot identity not resolved — cannot check mentions");
          storeError("telegram", "Bot identity not resolved — cannot check mentions", { channel: chatId });
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
        storeErrorFromCatch("telegram", err, { channel: chatId, action: "text_message" });
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

    // Handle photo messages (partner bot deposit tickets with image attachments)
    this.bot.on("photo", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const caption = (ctx.message.caption || "").trim();
      if (!caption) return;

      const sender = extractSenderInfo(ctx.message as unknown as Record<string, unknown>);

      logger.info(
        { chatId, chatType: ctx.chat.type, from: sender.fromUsername, caption: caption.slice(0, 80) },
        "Telegram photo event received"
      );

      const replyFn = async (answer: string) => {
        await ctx.reply(answer, { reply_parameters: { message_id: ctx.message.message_id } });
      };
      await checkPartnerBot(
        chatId, ctx.chat.type, caption,
        sender.fromId, sender.fromUsername, sender.senderChatUsername, sender.viaBotUsername,
        ctx.message.message_id, replyFn, ctx.message, "photo"
      );
    });

    // Handle document messages (partner bot deposit tickets with PDF attachments)
    this.bot.on("document", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const caption = (ctx.message.caption || "").trim();
      if (!caption) return;

      const sender = extractSenderInfo(ctx.message as unknown as Record<string, unknown>);

      logger.info(
        { chatId, chatType: ctx.chat.type, from: sender.fromUsername, caption: caption.slice(0, 80) },
        "Telegram document event received"
      );

      const replyFn = async (answer: string) => {
        await ctx.reply(answer, { reply_parameters: { message_id: ctx.message.message_id } });
      };
      await checkPartnerBot(
        chatId, ctx.chat.type, caption,
        sender.fromId, sender.fromUsername, sender.senderChatUsername, sender.viaBotUsername,
        ctx.message.message_id, replyFn, ctx.message, "document"
      );
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
      const postSender = extractSenderInfo(post as unknown as Record<string, unknown>);
      const postReplyFn = async (answer: string) => { await ctx.reply(answer); };
      const wasChannelPartnerBot = await checkPartnerBot(
        chatId, ctx.chat.type, text,
        "channel", postSender.fromUsername || postSender.senderChatUsername, postSender.senderChatUsername, postSender.viaBotUsername,
        0, postReplyFn, post, "channel_post"
      );
      if (wasChannelPartnerBot) return;

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
        storeErrorFromCatch("telegram", err, { channel: chatId, action: "channel_post" });
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
      storeErrorFromCatch("telegram", err, { action: "telegraf_catch" });
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
      storeErrorFromCatch("telegram", err, { action: "resolve_identity" });
    }

    // Use polling (not webhooks) for simplicity
    // Launch in background — don't await so a polling conflict doesn't crash the app
    this.bot
      .launch({ dropPendingUpdates: true, allowedUpdates: ["message", "channel_post"] })
      .then(() => logger.info("Telegram polling CONFIRMED active"))
      .catch((err) => {
        logger.error({ err }, "Telegram bot launch failed — will continue without Telegram");
        storeErrorFromCatch("telegram", err, { action: "launch" });
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
