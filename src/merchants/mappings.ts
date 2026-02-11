import { MerchantMapping } from "./types";

/**
 * Helper: create a single-business-ID mapping (most common case).
 */
function single(
  channelId: string,
  platform: MerchantMapping["platform"],
  businessId: number
): MerchantMapping {
  return {
    channelId,
    platform,
    businessId,
    businessIdStr: String(businessId),
    businessIds: [businessId],
    businessIdStrs: [String(businessId)],
  };
}

/**
 * Helper: create a multi-business-ID mapping (one channel, multiple accounts).
 */
function multi(
  channelId: string,
  platform: MerchantMapping["platform"],
  businessIds: number[]
): MerchantMapping {
  return {
    channelId,
    platform,
    businessId: businessIds[0],
    businessIdStr: String(businessIds[0]),
    businessIds,
    businessIdStrs: businessIds.map(String),
  };
}

/**
 * Static channel → merchant mapping.
 * Updated via code commits. Each merchant can have multiple entries
 * (one per channel per platform).
 *
 * businessId: number from business_business.id (used for mv_payment_transactions)
 * businessIdStr: string version (used for usrv-withdrawals-withdrawals and usrv-deposits-spei)
 */
export const MERCHANT_CHANNEL_MAP: MerchantMapping[] = [
  // ── Tonder Production ──
  single("C0AF237ATKJ", "slack", 86),

  // ── Stadiobet (2 accounts: Stadiobet + Stadiobet VIP) ──
  multi("C0A1WABSC4V", "slack", [530, 533]),

  // ── Campobet ──
  single("C0A1Z7V3S1E", "slack", 120),

  // ── Tonder Production 2 (Telegram) ──
  single("-1003575792934", "telegram", 91),
];
