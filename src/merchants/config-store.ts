import { pgQuery } from "../postgres/connection";
import { MerchantMapping, PartnerBotConfig } from "./types";
import { DEFAULT_MERCHANT_CONFIGS } from "./mappings";
import { logger } from "../utils/logger";

// ── In-memory state ─────────────────────────────────────────────────

let channelIndex = new Map<string, MerchantMapping>();
let lastHash = "";
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Callbacks invoked when configs change (used to sync scheduler, etc.)
const onChangeCallbacks: Array<() => void> = [];

// ── Public API ──────────────────────────────────────────────────────

export function getChannelIndex(): Map<string, MerchantMapping> {
  return channelIndex;
}

export function onConfigChange(cb: () => void): void {
  onChangeCallbacks.push(cb);
}

/**
 * Load active merchant configs from Postgres into the in-memory index.
 */
export async function loadConfigs(): Promise<void> {
  const result = await pgQuery(`
    SELECT mc.id, mc.label, mc.channel_id, mc.platform, mc.business_ids, mc.is_active,
           COALESCE(
             json_agg(json_build_object('username', pb.username, 'label', pb.label))
             FILTER (WHERE pb.id IS NOT NULL),
             '[]'
           ) AS partner_bots
    FROM pascal_merchant_channels mc
    LEFT JOIN pascal_partner_bots pb ON pb.channel_id = mc.id
    WHERE mc.is_active = true
    GROUP BY mc.id
  `);

  const newIndex = new Map<string, MerchantMapping>();

  for (const row of result.rows) {
    const businessIds: number[] = row.business_ids;
    const partnerBots: PartnerBotConfig[] = row.partner_bots || [];

    const mapping: MerchantMapping = {
      channelId: row.channel_id,
      platform: row.platform,
      businessId: businessIds[0],
      businessIdStr: String(businessIds[0]),
      businessIds,
      businessIdStrs: businessIds.map(String),
      ...(partnerBots.length > 0 ? { partnerBots } : {}),
    };

    const key = `${mapping.platform}:${mapping.channelId}`;
    newIndex.set(key, mapping);
  }

  // Only swap + log if something changed
  const newHash = buildHash(newIndex);
  if (newHash !== lastHash) {
    const wasEmpty = lastHash === "";
    channelIndex = newIndex;
    lastHash = newHash;
    if (!wasEmpty) {
      logger.info(
        { count: newIndex.size },
        "Merchant configs refreshed from Postgres"
      );
      for (const cb of onChangeCallbacks) cb();
    } else {
      logger.info(
        { count: newIndex.size, keys: Array.from(newIndex.keys()) },
        "Merchant channel index built from Postgres"
      );
    }
  }
}

/**
 * Seed the Postgres tables with the default hardcoded merchants
 * if the tables are currently empty.
 */
export async function seedDefaults(): Promise<void> {
  const { rows } = await pgQuery(
    "SELECT COUNT(*)::int AS cnt FROM pascal_merchant_channels"
  );
  if (rows[0].cnt > 0) {
    logger.info(
      { existing: rows[0].cnt },
      "Postgres already has merchant configs — skipping seed"
    );
    return;
  }

  logger.info("Seeding default merchant configs into Postgres...");

  for (const mapping of DEFAULT_MERCHANT_CONFIGS) {
    // Insert the merchant channel
    const insertResult = await pgQuery(
      `INSERT INTO pascal_merchant_channels (label, channel_id, platform, business_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, channel_id) DO NOTHING
       RETURNING id`,
      [
        mapping.channelId, // label will be replaced by business name after boot
        mapping.channelId,
        mapping.platform,
        mapping.businessIds,
      ]
    );

    if (insertResult.rows.length === 0) continue;
    const channelDbId = insertResult.rows[0].id;

    // Insert partner bots if any
    if (mapping.partnerBots) {
      for (const bot of mapping.partnerBots) {
        await pgQuery(
          `INSERT INTO pascal_partner_bots (channel_id, username, label)
           VALUES ($1, $2, $3)`,
          [channelDbId, bot.username, bot.label]
        );
      }
    }
  }

  logger.info(
    { count: DEFAULT_MERCHANT_CONFIGS.length },
    "Default merchant configs seeded"
  );
}

/**
 * Start polling Postgres every `intervalMs` for config changes.
 */
export function startConfigPolling(intervalMs = 60_000): void {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    try {
      await loadConfigs();
    } catch (err) {
      logger.error({ err }, "Config polling failed");
    }
  }, intervalMs);
  logger.info({ intervalMs }, "Config polling started");
}

/**
 * Stop the polling interval (for graceful shutdown).
 */
export function stopConfigPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info("Config polling stopped");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildHash(index: Map<string, MerchantMapping>): string {
  const entries = [...index.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, m]) => {
      const bots = m.partnerBots?.map((b) => b.username).join(",") || "";
      return `${key}:${m.businessIds.join(",")}:${bots}`;
    });
  return entries.join("|");
}
