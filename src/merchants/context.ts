import { MerchantContext } from "./types";
import { getChannelIndex, loadConfigs, seedDefaults } from "./config-store";
import { getCollection } from "../mongodb/connection";
import { logger } from "../utils/logger";

const BIZ_COLLECTION = "business_business";

// In-memory cache of business names from business_business collection
let businessNameCache: Map<number, string> = new Map();
let lastCacheRefresh = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function refreshBusinessNames(): Promise<void> {
  const col = getCollection(BIZ_COLLECTION);
  const businesses = await col
    .find({}, { projection: { id: 1, name: 1, _id: 0 } })
    .toArray();

  businessNameCache = new Map();
  for (const biz of businesses) {
    businessNameCache.set(biz.id as number, biz.name as string);
  }
  lastCacheRefresh = Date.now();
  logger.info(
    { count: businessNameCache.size },
    "Business name cache refreshed"
  );
}

async function ensureFreshCache(): Promise<void> {
  if (Date.now() - lastCacheRefresh > CACHE_TTL_MS) {
    await refreshBusinessNames();
  }
}

/**
 * Resolve a channel message to a MerchantContext.
 * Returns null if the channel is not mapped to any merchant.
 * Supports multi-business-ID channels (e.g. Stadiobet + Stadiobet VIP).
 */
export async function resolveMerchantContext(
  channelId: string,
  platform: "slack" | "telegram" | "whatsapp" | "web"
): Promise<MerchantContext | null> {
  const key = `${platform}:${channelId}`;
  const index = getChannelIndex();
  const mapping = index.get(key);
  if (!mapping) {
    logger.warn(
      { key, indexSize: index.size, knownKeys: Array.from(index.keys()).slice(0, 20) },
      "Channel not found in index"
    );
    return null;
  }

  await ensureFreshCache();

  // Build combined business name from all IDs
  const names = mapping.businessIds.map(
    (id) => businessNameCache.get(id) || `Business ${id}`
  );
  // Deduplicate names (in case both IDs map to same root name)
  const uniqueNames = [...new Set(names)];
  const businessName = uniqueNames.join(" + ");

  return {
    businessId: mapping.businessId,
    businessIdStr: mapping.businessIdStr,
    businessIds: mapping.businessIds,
    businessIdStrs: mapping.businessIdStrs,
    businessName,
    platform,
    channelId,
  };
}

/**
 * Check if a given username is a configured partner bot for this channel.
 * Used by the Telegram adapter to auto-respond without @mention.
 */
export function isPartnerBot(
  channelId: string,
  platform: "slack" | "telegram" | "whatsapp" | "web",
  username: string
): boolean {
  const key = `${platform}:${channelId}`;
  const mapping = getChannelIndex().get(key);
  if (!mapping?.partnerBots) return false;
  return mapping.partnerBots.some(
    (pb) => pb.username.toLowerCase() === username.toLowerCase()
  );
}

/**
 * Check if a channel has any partner bots configured.
 * Used for content-based fallback detection when username matching fails.
 */
export function hasPartnerBots(
  channelId: string,
  platform: "slack" | "telegram" | "whatsapp" | "web"
): boolean {
  const key = `${platform}:${channelId}`;
  const mapping = getChannelIndex().get(key);
  return !!(mapping?.partnerBots && mapping.partnerBots.length > 0);
}

/**
 * Build a MerchantContext for the web Concierge surface from a verified
 * business_id (extracted from the merchant's signed session token).
 *
 * Unlike Slack/Telegram which key off (platform, channelId), the web
 * surface keys directly off business_id — the Concierge belongs to one
 * merchant. Multi-business merchants get a single primary id here;
 * future versions can let the merchant pick from their available IDs.
 *
 * Throws if the business_id isn't known. Callers must catch and return
 * 401/404 to the client.
 */
export async function buildWebMerchantContext(
  businessId: number,
): Promise<MerchantContext> {
  await ensureFreshCache();
  const name = businessNameCache.get(businessId);
  if (!name) {
    throw new Error(`Unknown business_id: ${businessId}`);
  }
  return {
    businessId,
    businessIdStr: String(businessId),
    businessIds: [businessId],
    businessIdStrs: [String(businessId)],
    businessName: name,
    platform: "web",
    channelId: `web:${businessId}`,
  };
}

/** Load merchant configs from Postgres and business names from MongoDB */
export async function initMerchantContext(): Promise<void> {
  await seedDefaults();
  await loadConfigs();
  await refreshBusinessNames();
}
