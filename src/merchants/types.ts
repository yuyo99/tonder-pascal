export interface MerchantMapping {
  channelId: string;
  platform: "slack" | "telegram" | "whatsapp";
  /** Primary business ID (first in the list) */
  businessId: number;
  businessIdStr: string;
  /** All business IDs for this channel (for merchants with multiple accounts) */
  businessIds: number[];
  businessIdStrs: string[];
}

export interface MerchantContext {
  /** Primary business ID (first in the list) */
  businessId: number;
  businessIdStr: string;
  /** All business IDs for this channel */
  businessIds: number[];
  businessIdStrs: string[];
  businessName: string;
  platform: "slack" | "telegram" | "whatsapp";
  channelId: string;
}
