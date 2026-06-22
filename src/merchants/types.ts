export interface PartnerBotConfig {
  /** Telegram username of the partner bot (without @) */
  username: string;
  /** Human-readable label for logging */
  label: string;
  /** Telegram numeric user ID (fallback when username isn't in message) */
  botId?: string;
}

export interface MerchantMapping {
  channelId: string;
  platform: "slack" | "telegram" | "whatsapp" | "web";
  /** Primary business ID (first in the list) */
  businessId: number;
  businessIdStr: string;
  /** All business IDs for this channel (for merchants with multiple accounts) */
  businessIds: number[];
  businessIdStrs: string[];
  /** Optional: partner bots whose messages Pascal auto-processes (no @mention required) */
  partnerBots?: PartnerBotConfig[];
}

export interface MerchantContext {
  /** Primary business ID (first in the list) */
  businessId: number;
  businessIdStr: string;
  /** All business IDs for this channel */
  businessIds: number[];
  businessIdStrs: string[];
  businessName: string;
  platform: "slack" | "telegram" | "whatsapp" | "web";
  channelId: string;
}
