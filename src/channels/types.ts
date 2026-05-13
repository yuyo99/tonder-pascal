export interface IncomingMessage {
  channelId: string;
  platform: "slack" | "telegram" | "whatsapp";
  userId: string;
  userName: string;
  text: string;
  threadId?: string;
  rawEvent: unknown;
  /** True when message was picked up by ambient mode (not tagged) */
  ambient?: boolean;
  /** Thread context for ambient mode (recent messages for context) */
  threadContext?: string[];
  /**
   * Mention tokens extracted by the adapter (e.g. ["@pascal"] on Telegram,
   * or ["<@U07TONDER>"] on Slack). Used by the Phase 0 Gate's
   * require_mention predicate.
   */
  mentions?: string[];
  /** True when this message is a reply to one of Pascal's prior messages. */
  isReplyToPascal?: boolean;
  /**
   * When the message originates from a known partner bot (e.g.
   * "bcgame_ticket_bot"), this identifies which one. Used by parsing rules
   * and bot-scoped rules at Phase 0.
   */
  botId?: string;
}

export interface OutgoingMessage {
  channelId: string;
  threadId?: string;
  text: string;
  richText?: unknown;
}

export interface MessageResponse {
  text: string;
  attachments?: { buffer: Buffer; filename: string }[];
}

export interface ChannelAdapter {
  platform: "slack" | "telegram" | "whatsapp";
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<string>;
  updateMessage(
    msg: OutgoingMessage & { messageId: string }
  ): Promise<void>;
  onMessage(
    handler: (msg: IncomingMessage) => Promise<MessageResponse>
  ): void;
}
