import { MERCHANT_CHANNEL_MAP } from "./mappings";
import { MerchantContext, MerchantMapping } from "./types";
import { getCollection } from "../mongodb/connection";
import { logger } from "../utils/logger";

const BIZ_COLLECTION = "business_business";

// In-memory cache of business names from business_business collection
let businessNameCache: Map<number, string> = new Map();
let lastCacheRefresh = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Pre-built index for fast channel lookup
const channelIndex = new Map<string, MerchantMapping>();

export function buildChannelIndex(): void {
  channelIndex.clear();
  for (const mapping of MERCHANT_CHANNEL_MAP) {
    const key = `${mapping.platform}:${mapping.channelId}`;
    channelIndex.set(key, mapping);
  }
  logger.info(
    { count: channelIndex.size, keys: Array.from(channelIndex.keys()) },
    "Merchant channel index built"
  );
}

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
  platform: "slack" | "telegram" | "whatsapp"
): Promise<MerchantContext | null> {
  const key = `${platform}:${channelId}`;
  const mapping = channelIndex.get(key);
  if (!mapping) return null;

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
  platform: "slack" | "telegram" | "whatsapp",
  username: string
): boolean {
  const key = `${platform}:${channelId}`;
  const mapping = channelIndex.get(key);
  if (!mapping?.partnerBots) return false;
  return mapping.partnerBots.some(
    (pb) => pb.username.toLowerCase() === username.toLowerCase()
  );
}

/** Load merchant mappings and business names on startup */
export async function initMerchantContext(): Promise<void> {
  buildChannelIndex();
  await refreshBusinessNames();
}
