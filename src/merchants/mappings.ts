import { MerchantMapping } from "./types";

/**
 * Static channel → merchant mapping.
 * Updated via code commits. Each merchant can have multiple entries
 * (one per channel per platform).
 *
 * businessId: number from business_business.id (used for mv_payment_transactions)
 * businessIdStr: string version (used for usrv-withdrawals-withdrawals and usrv-deposits-spei)
 */
export const MERCHANT_CHANNEL_MAP: MerchantMapping[] = [
  // ── Example entries (replace with real channel IDs) ──
  // {
  //   channelId: "C07XXXXXX",       // Slack channel ID
  //   platform: "slack",
  //   businessId: 94,
  //   businessIdStr: "94",
  // },
  // {
  //   channelId: "-1001234567890",  // Telegram group chat ID
  //   platform: "telegram",
  //   businessId: 94,
  //   businessIdStr: "94",
  // },
];
