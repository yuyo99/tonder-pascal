import * as Sentry from "@sentry/node";
import { App } from "@slack/bolt";
import { ChannelAdapter, IncomingMessage, OutgoingMessage, MessageResponse } from "../types";
import { formatResponse, formatError, formatThinking } from "./formatter";
import { createSupportTicket, createTriageTicket, createTeamTicket, CommandType } from "../../linear/client";
import { resolveMerchantContext } from "../../merchants/context";
import { trackInteraction } from "../../scheduler/daily-report";
import { handleFeedbackMessage } from "../../knowledge/feedback";
import { triageMessage, TriageResult } from "../../core/triage";
import { isTonderTeamMember, getTeamMemberName } from "../../core/tonder-team";
import { parseTicketShortcut, fileTicketFromShortcut, formatShortcutConfirmation } from "../../core/ticket-shortcut";
import { fetchSlackContext } from "./context";
import { uploadFileToSlack } from "./upload-file";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { storeErrorFromCatch } from "../../utils/error-store";

const FEEDBACK_TRIGGERS = /\b(feedback|feedback\s+alert|learn|new\s+knowledge|add\s+this)\b/i;

interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
}

export class SlackChannelAdapter implements ChannelAdapter {
  platform = "slack" as const;
  private app: App;
  private messageHandler?: (msg: IncomingMessage) => Promise<MessageResponse>;
  private processedEvents = new Set<string>();

  constructor(slackConfig: SlackConfig) {
    this.app = new App({
      token: slackConfig.botToken,
      signingSecret: slackConfig.signingSecret,
      appToken: slackConfig.appToken,
      socketMode: true,
    });
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<MessageResponse>): void {
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
    commandType: CommandType,
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
        commandType,
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
        question: `[${commandType.toUpperCase()}] ${description}`,
        answered: false,
        ticketId: ticket.identifier,
        timestamp: new Date(),
      });

      logger.info(
        { ticket: ticket.identifier, merchant: merchantCtx.businessName, user: userId, commandType },
        "Ticket created via @Pascal command"
      );
    } catch (err) {
      logger.error({ err, channelId }, "Failed to create Linear ticket");
      storeErrorFromCatch("slack", err, { channel: channelId, action: "create_ticket" });
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

      // CHECK: Is this feedback/training? (feedback, learn, add this, etc.)
      if (FEEDBACK_TRIGGERS.test(question)) {
        await handleFeedbackMessage({
          text: question,
          channelId: event.channel,
          threadTs: event.ts,
          userId: event.user || "",
          slackClient: client,
        });
        return;
      }

      // CHECK: Is this a command? (ticket, bug, feature, escalate)
      const commandMatch = question.match(/^(ticket|bug|feature|escalate)\s*(.*)/i);
      if (commandMatch) {
        const cmdType = commandMatch[1].toLowerCase() as CommandType;
        const description = commandMatch[2].trim();
        await this.handleTicketCommand(
          event.channel,
          event.ts,
          event.user || "",
          description,
          cmdType,
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
        const response = await handler({
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
          blocks: formatResponse(response.text),
          text: response.text,
        });

        // Upload file attachments (e.g. PDF receipts)
        if (response.attachments?.length) {
          for (const att of response.attachments) {
            try {
              await uploadFileToSlack(config.slack.botToken, event.channel, att.buffer, att.filename, {
                threadTs: event.ts,
                title: att.filename.replace(/_/g, " ").replace(".pdf", ""),
              });
            } catch (uploadErr) {
              const errMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
              logger.error({ err: uploadErr, filename: att.filename }, "Failed to upload PDF to Slack");
              await client.chat.postMessage({
                channel: event.channel,
                thread_ts: event.ts,
                text: `⚠️ PDF generated but upload failed: ${errMsg}`,
              });
            }
          }
        } else {
          // Debug: surface when no attachments returned
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.ts,
            text: `🔍 Debug: orchestrator returned ${response.attachments?.length ?? 0} attachments`,
          });
        }
      } catch (err) {
        Sentry.captureException(err);
        logger.error({ err }, "Failed to answer Slack @mention");
        storeErrorFromCatch("slack", err, { channel: event.channel, user: event.user, action: "app_mention" });
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
        const response = await handler({
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
          blocks: formatResponse(response.text),
          text: response.text,
        });

        if (response.attachments?.length) {
          for (const att of response.attachments) {
            try {
              await uploadFileToSlack(config.slack.botToken, msg.channel!, att.buffer, att.filename, {
                title: att.filename.replace(/_/g, " ").replace(".pdf", ""),
              });
            } catch (uploadErr) {
              logger.error({ err: uploadErr, filename: att.filename }, "Failed to upload PDF to Slack DM");
            }
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        logger.error({ err }, "Failed to answer Slack DM");
        storeErrorFromCatch("slack", err, { channel: msg.channel!, user: msg.user, action: "dm" });
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        await client.chat.update({
          channel: msg.channel!,
          ts: thinking.ts!,
          blocks: formatError(errorMsg),
          text: `Error: ${errorMsg}`,
        });
      }
    });

    // ── Ambient mode: listen to channel messages without being tagged ──
    const ambientRateLimit = new Map<string, number>(); // channelId → last response timestamp
    const AMBIENT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per channel

    this.app.event("message", async ({ event, client }) => {
      const msg = event as {
        channel_type?: string; text?: string; user?: string;
        ts?: string; subtype?: string; channel?: string;
        thread_ts?: string; bot_id?: string;
      };

      // Only handle channel/group messages (not DMs — those are handled above)
      if (msg.channel_type === "im") return;

      logger.info(
        { channel: msg.channel, channelType: msg.channel_type, ambientEnabled: config.ambient.enabled, text: msg.text?.slice(0, 60) },
        "Ambient listener: channel message received"
      );

      // Skip bot messages, subtypes (joins, leaves, etc.), empty text
      if (msg.subtype || msg.bot_id || !msg.text || !msg.channel || !msg.user) return;

      // ── Ticket shortcut: thread reply with exact "1" / "2" by Tonder team ──
      // "1" → Support (SOS), "2" → Integrations (INT). Files a Linear ticket
      // whose subject is the message being replied to. Must be processed before
      // ambient mode (independent of rate limits / allowed-channel gating).
      const shortcutTeam = parseTicketShortcut(msg.text);
      if (shortcutTeam && msg.thread_ts && msg.thread_ts !== msg.ts) {
        if (await isTonderTeamMember(msg.user)) {
          try {
            // Fetch the thread root message (the subject of the ticket)
            const repliesRes = await client.conversations.replies({
              channel: msg.channel,
              ts: msg.thread_ts,
              limit: 1,
              inclusive: true,
            });
            const parent = repliesRes.messages?.[0];
            const parentText = (parent?.text as string) || "";
            const parentUserId = (parent?.user as string) || (parent?.bot_id as string) || "";
            const parentAuthorName = parentUserId
              ? ((await getTeamMemberName(parentUserId)) || parentUserId)
              : undefined;

            // Permalink back to the original message
            let permalink: string | undefined;
            try {
              const permaRes = await client.chat.getPermalink({
                channel: msg.channel,
                message_ts: msg.thread_ts,
              });
              permalink = (permaRes.permalink as string) || undefined;
            } catch (permaErr) {
              logger.warn({ err: permaErr }, "ticket-shortcut: getPermalink failed (non-fatal)");
            }

            // Best-effort merchant context (may be null for non-merchant channels)
            const merchantCtx = (await resolveMerchantContext(msg.channel, "slack")) || undefined;
            const triggeredByName = (await getTeamMemberName(msg.user)) || msg.user;

            const ticket = await fileTicketFromShortcut({
              team: shortcutTeam,
              parentMessageText: parentText,
              parentAuthorName,
              platform: "slack",
              channelId: msg.channel,
              merchantCtx,
              permalink,
              triggeredByName,
            });

            await client.chat.postMessage({
              channel: msg.channel,
              thread_ts: msg.thread_ts,
              text: formatShortcutConfirmation(shortcutTeam, ticket),
            });

            logger.info(
              { team: shortcutTeam, identifier: ticket.identifier, channel: msg.channel, user: msg.user },
              "Ticket shortcut: Linear ticket created"
            );
          } catch (err) {
            Sentry.captureException(err);
            logger.error({ err, team: shortcutTeam }, "ticket-shortcut: failed to create Linear ticket");
            storeErrorFromCatch("slack", err, { channel: msg.channel, user: msg.user, action: "ticket-shortcut" });
            const errMsg = err instanceof Error ? err.message : "unknown error";
            await client.chat.postMessage({
              channel: msg.channel,
              thread_ts: msg.thread_ts,
              text: `⚠️ Couldn't create the ticket: ${errMsg}`,
            });
          }
          return; // Always return — operator's "1"/"2" reply is fully handled
        }
        // Not a Tonder team member — silently ignore the shortcut and fall through
      }

      if (!config.ambient.enabled) return;
      // Skip if this is an @mention (already handled by app_mention)
      if (msg.text.includes(`<@`) && msg.text.match(/<@[A-Z0-9]+>/)) return;
      // Skip if already processed as a different event
      if (this.processedEvents.has(msg.ts!)) return;

      // Check if this channel is allowed for ambient mode
      if (config.ambient.allowedChannels.length > 0 && !config.ambient.allowedChannels.includes(msg.channel)) return;

      // Rate limit: max 1 ambient response per channel per 5 minutes
      const lastResponse = ambientRateLimit.get(msg.channel) ?? 0;
      if (Date.now() - lastResponse < AMBIENT_COOLDOWN_MS) return;

      // Resolve merchant context — allow unmapped channels that are in AMBIENT_CHANNELS (e.g. training)
      let merchantCtx = await resolveMerchantContext(msg.channel, "slack");
      if (!merchantCtx) {
        // Training/internal channels: no merchant restriction
        if (config.ambient.allowedChannels.includes(msg.channel)) {
          merchantCtx = {
            businessId: 0,
            businessIdStr: "",
            businessIds: [],
            businessIdStrs: [],
            businessName: "Training (all merchants)",
            platform: "slack",
            channelId: msg.channel,
          };
        } else {
          return;
        }
      }

      // Fast-path: deposit ticket / transaction inquiry — always respond, skip triage
      const isDepositTicket = /(?:txid|orderId|payment_id|transaction.?id)\s*[:=]?\s*\w+/i.test(msg.text)
        && /(?:status|check|deposit|ticket|amount|currency)/i.test(msg.text);
      // Fast-path: bare Tonder ID (ord_, pay_, UUID, or long alphanumeric) — always look it up
      const isBareId = /^\s*(ord_[a-zA-Z0-9]+|pay_[a-zA-Z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-zA-Z0-9_-]{15,})\s*$/i.test(msg.text.trim());

      // Fetch thread/channel context for triage
      const threadContext = await fetchSlackContext(client, msg.channel, msg.thread_ts);

      // Run triage
      const senderName = (await getTeamMemberName(msg.user)) || msg.user;
      const isTonder = await isTonderTeamMember(msg.user);
      let triage: TriageResult;

      if (isDepositTicket || isBareId) {
        logger.info({ channel: msg.channel, user: senderName, isBareId }, "Ambient fast-path: transaction ID detected");
        triage = { shouldRespond: true, confidence: 0.99, reason: "deposit ticket / transaction inquiry", action: "answer", ticketTeam: null };
      } else {
        try {
          triage = await triageMessage({
            message: msg.text,
            senderName,
            isTonderTeam: merchantCtx.businessId === 0 ? false : isTonder, // Training channels: don't skip Tonder team
            threadContext,
            merchantName: merchantCtx.businessName,
            platform: "slack",
          });
        } catch (err) {
          logger.error({ err }, "Ambient triage failed");
          return;
        }
      }

      if (triage.action === "silent") return;

      // Mark rate limit
      ambientRateLimit.set(msg.channel, Date.now());
      // Clean old entries
      if (ambientRateLimit.size > 200) {
        const now = Date.now();
        for (const [ch, ts] of ambientRateLimit) {
          if (now - ts > AMBIENT_COOLDOWN_MS * 2) ambientRateLimit.delete(ch);
        }
      }

      if (triage.action === "create_ticket" && triage.ticketTeam) {
        // Create a ticket instead of answering
        try {
          const title = msg.text.length > 80 ? msg.text.slice(0, 77) + "..." : msg.text;
          const ticket = await createTeamTicket({
            team: triage.ticketTeam,
            title: `[Ambient] ${title}`,
            description: [
              `**Detected in:** ${merchantCtx.businessName} Slack channel`,
              `**Reported by:** ${senderName}`,
              `**Triage reason:** ${triage.reason}`,
              "",
              "---",
              "",
              msg.text,
            ].join("\n"),
            priority: 2,
            merchantCtx,
          });

          await client.chat.postMessage({
            channel: msg.channel,
            thread_ts: msg.thread_ts || msg.ts,
            text: `I've notified the team — they'll respond shortly.`,
          });

          logger.info(
            { ticket: ticket.identifier, team: triage.ticketTeam, merchant: merchantCtx.businessName },
            "Ambient ticket created"
          );
        } catch (err) {
          logger.error({ err }, "Failed to create ambient ticket");
          storeErrorFromCatch("slack", err, { channel: msg.channel, action: "ambient_ticket" });
        }
        return;
      }

      // action === "answer" — run full orchestrator
      const queryText = isBareId
        ? `Look up this ID and respond with its full status and details: ${msg.text.trim()}`
        : msg.text;
      try {
        const response = await handler({
          channelId: msg.channel,
          platform: "slack",
          userId: msg.user,
          userName: senderName,
          text: queryText,
          threadId: msg.thread_ts || msg.ts,
          rawEvent: event,
          ambient: true,
          threadContext,
        });

        // Post as a natural reply (no "thinking" indicator)
        await client.chat.postMessage({
          channel: msg.channel,
          thread_ts: msg.thread_ts || msg.ts,
          text: response.text,
        });

        if (response.attachments?.length) {
          for (const att of response.attachments) {
            try {
              await uploadFileToSlack(config.slack.botToken, msg.channel!, att.buffer, att.filename, {
                threadTs: msg.thread_ts || msg.ts,
                title: att.filename.replace(/_/g, " ").replace(".pdf", ""),
              });
            } catch (uploadErr) {
              logger.error({ err: uploadErr, filename: att.filename }, "Failed to upload PDF to Slack (ambient)");
            }
          }
        }

        logger.info(
          { merchant: merchantCtx.businessName, user: senderName },
          "Ambient response sent"
        );
      } catch (err) {
        Sentry.captureException(err);
        logger.error({ err }, "Ambient response failed");
        storeErrorFromCatch("slack", err, { channel: msg.channel, action: "ambient_answer" });
        // Silently fail — don't post error messages in ambient mode
      }
    });

    // Handle 🎫 emoji reaction → triage ticket
    const ticketReactionProcessed = new Set<string>();

    this.app.event("reaction_added", async ({ event, client }) => {
      logger.info({ reaction: event.reaction, user: event.user, itemType: event.item.type }, "reaction_added received");
      if (event.reaction !== "ticket") return;
      if (event.item.type !== "message") return;

      const { channel, ts: messageTs } = event.item as { channel: string; ts: string };
      const dedupKey = `${channel}:${messageTs}`;

      // Prevent duplicate tickets for the same message
      if (ticketReactionProcessed.has(dedupKey)) return;
      ticketReactionProcessed.add(dedupKey);
      if (ticketReactionProcessed.size > 200) {
        const entries = [...ticketReactionProcessed];
        ticketReactionProcessed.clear();
        for (const e of entries.slice(-100)) ticketReactionProcessed.add(e);
      }

      try {
        // Fetch the original message text
        const historyResult = await client.conversations.history({
          channel,
          latest: messageTs,
          inclusive: true,
          limit: 1,
        });
        const originalMessage = historyResult.messages?.[0];
        const messageText = originalMessage?.text || "(no message text)";

        // Reply in thread
        await client.chat.postMessage({
          channel,
          thread_ts: messageTs,
          text: "🎫 Support Team is reviewing your request.",
        });

        // Get channel name for context
        let channelName = channel;
        try {
          const info = await client.conversations.info({ channel });
          channelName = `#${(info.channel as any)?.name || channel}`;
        } catch { /* keep channel ID */ }

        // Get permalink
        let permalink = "";
        try {
          const link = await client.chat.getPermalink({ channel, message_ts: messageTs });
          permalink = link.permalink || "";
        } catch { /* skip */ }

        // Create Linear triage ticket
        const title = messageText.length > 80
          ? messageText.slice(0, 77) + "..."
          : messageText;

        const description = [
          `**Channel:** ${channelName}`,
          `**Flagged by:** <@${event.user}>`,
          permalink ? `**Message:** [View in Slack](${permalink})` : "",
          "",
          "---",
          "",
          "**Original message:**",
          "```",
          messageText,
          "```",
        ].filter(Boolean).join("\n");

        const ticket = await createTriageTicket({
          title: `[Support] ${title}`,
          description,
          assigneeEmail: "davidc@tonder.io",
        });

        // Post ticket link in the same thread
        await client.chat.postMessage({
          channel,
          thread_ts: messageTs,
          text: `✅ Ticket created: <${ticket.url}|${ticket.identifier}>`,
        });

        logger.info(
          { ticket: ticket.identifier, channel: channelName, user: event.user },
          "Triage ticket created via 🎫 emoji reaction"
        );
      } catch (err) {
        logger.error({ err, channel, messageTs }, "Failed to handle ticket emoji reaction");
        storeErrorFromCatch("slack", err, { channel, action: "ticket_reaction" });
        await client.chat.postMessage({
          channel,
          thread_ts: messageTs,
          text: "⚠️ Could not create the support ticket. Please try again or create it manually in Linear.",
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
