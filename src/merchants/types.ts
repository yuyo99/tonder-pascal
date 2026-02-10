export interface MerchantMapping {
  channelId: string;
  platform: "slack" | "telegram" | "whatsapp";
  businessId: number;
  businessIdStr: string;
}

export interface MerchantContext {
  businessId: number;
  businessIdStr: string;
  businessName: string;
  platform: "slack" | "telegram" | "whatsapp";
  channelId: string;
}
