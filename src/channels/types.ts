export interface IncomingMessage {
  channelId: string;
  platform: "slack" | "telegram" | "whatsapp";
  userId: string;
  userName: string;
  text: string;
  threadId?: string;
  rawEvent: unknown;
}

export interface OutgoingMessage {
  channelId: string;
  threadId?: string;
  text: string;
  richText?: unknown;
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
    handler: (msg: IncomingMessage) => Promise<string>
  ): void;
}
