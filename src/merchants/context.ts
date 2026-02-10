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
    { count: channelIndex.size },
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
 */
export async function resolveMerchantContext(
  channelId: string,
  platform: "slack" | "telegram" | "whatsapp"
): Promise<MerchantContext | null> {
  const key = `${platform}:${channelId}`;
  const mapping = channelIndex.get(key);
  if (!mapping) return null;

  await ensureFreshCache();

  const businessName =
    businessNameCache.get(mapping.businessId) ||
    `Business ${mapping.businessId}`;

  return {
    businessId: mapping.businessId,
    businessIdStr: mapping.businessIdStr,
    businessName,
    platform,
    channelId,
  };
}

/** Load merchant mappings and business names on startup */
export async function initMerchantContext(): Promise<void> {
  buildChannelIndex();
  await refreshBusinessNames();
}
