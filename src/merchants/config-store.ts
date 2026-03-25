import { pgQuery } from "../postgres/connection";
import { MerchantMapping, PartnerBotConfig } from "./types";
import { DEFAULT_MERCHANT_CONFIGS } from "./mappings";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

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

  logger.info({ rowCount: result.rows.length, channels: result.rows.map((r: any) => `${r.platform}:${r.channel_id}`) }, "Raw rows from pascal_merchant_channels");

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
      // Log partner bot configs for diagnostics
      const botsInfo = [...newIndex.entries()]
        .filter(([, m]) => m.partnerBots && m.partnerBots.length > 0)
        .map(([key, m]) => ({
          key,
          bots: m.partnerBots!.map((b) => b.username),
        }));
      if (botsInfo.length > 0) {
        logger.info({ partnerBots: botsInfo }, "Partner bot configs loaded");
      } else {
        logger.warn("No partner bot configs found in any channel");
      }
    }
  }
}

/**
 * Upsert default hardcoded merchants into Postgres.
 * Always runs — inserts missing channels and partner bots without
 * touching existing rows (ON CONFLICT DO NOTHING).
 */
export async function seedDefaults(): Promise<void> {
  let seeded = 0;

  for (const mapping of DEFAULT_MERCHANT_CONFIGS) {
    // Upsert the merchant channel
    const insertResult = await pgQuery(
      `INSERT INTO pascal_merchant_channels (label, channel_id, platform, business_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, channel_id) DO NOTHING
       RETURNING id`,
      [
        mapping.channelId,
        mapping.channelId,
        mapping.platform,
        mapping.businessIds,
      ]
    );

    if (insertResult.rows.length === 0) {
      // Channel already exists — ensure partner bots are present
      if (mapping.partnerBots?.length) {
        const existing = await pgQuery(
          `SELECT id FROM pascal_merchant_channels WHERE platform = $1 AND channel_id = $2`,
          [mapping.platform, mapping.channelId]
        );
        if (existing.rows.length > 0) {
          const channelDbId = existing.rows[0].id;
          for (const bot of mapping.partnerBots) {
            await pgQuery(
              `INSERT INTO pascal_partner_bots (channel_id, username, label)
               SELECT $1, $2, $3
               WHERE NOT EXISTS (
                 SELECT 1 FROM pascal_partner_bots WHERE channel_id = $1 AND username = $2
               )`,
              [channelDbId, bot.username, bot.label]
            );
          }
        }
      }
      continue;
    }

    seeded++;
    const channelDbId = insertResult.rows[0].id;

    // Insert partner bots if any
    if (mapping.partnerBots) {
      for (const bot of mapping.partnerBots) {
        await pgQuery(
          `INSERT INTO pascal_partner_bots (channel_id, username, label)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [channelDbId, bot.username, bot.label]
        );
      }
    }
  }

  if (seeded > 0) {
    logger.info({ seeded, total: DEFAULT_MERCHANT_CONFIGS.length }, "Default merchant configs seeded");
  } else {
    logger.info({ total: DEFAULT_MERCHANT_CONFIGS.length }, "All default merchant configs already in Postgres");
  }
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
      storeErrorFromCatch("config", err, { action: "polling" });
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
