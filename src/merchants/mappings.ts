import { MerchantMapping, PartnerBotConfig } from "./types";

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
 * Helper: create a single-business-ID mapping with partner bots.
 */
function singleWithBots(
  channelId: string,
  platform: MerchantMapping["platform"],
  businessId: number,
  partnerBots: PartnerBotConfig[]
): MerchantMapping {
  return { ...single(channelId, platform, businessId), partnerBots };
}

/**
 * Default merchant configs used ONLY for seeding Postgres on first boot.
 * After seed, all config is read from the pascal_merchant_channels table.
 */
export const DEFAULT_MERCHANT_CONFIGS: MerchantMapping[] = [
  // ── Tonder Production ──
  single("C0AF237ATKJ", "slack", 86),

  // ── Stadiobet (2 accounts: Stadiobet + Stadiobet VIP) ──
  multi("C0A1WABSC4V", "slack", [530, 533]),

  // ── Campobet ──
  single("C0A1Z7V3S1E", "slack", 120),

  // ── BCGAME (Telegram) ──
  singleWithBots("-1002589749469", "telegram", 121, [
    { username: "bcgame_ticket_bot", label: "BcgameTicketBot" },
  ]),

  // ── Tonder Production 2 (Telegram) — includes bcgame_ticket_bot + tonder_operator for testing ──
  singleWithBots("-1003575792934", "telegram", 91, [
    { username: "bcgame_ticket_bot", label: "BcgameTicketBot" },
    { username: "tonder_operator", label: "Tonder Operator (test)" },
  ]),
];
