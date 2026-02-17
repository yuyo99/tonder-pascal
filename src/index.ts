import { config } from "./config";
import { connectMongo, disconnectMongo } from "./mongodb/connection";
import { ensureTables } from "./postgres/schema";
import { disconnectPg } from "./postgres/connection";
import { startConfigPolling, stopConfigPolling } from "./merchants/config-store";
import { initMerchantContext } from "./merchants/context";
import { bootChannels, findSlackAdapter } from "./channels/registry";
import { handleIncomingMessage } from "./core/orchestrator";
import { initScheduler, stopScheduler } from "./scheduler";
import { logger } from "./utils/logger";

async function main() {
  logger.info("Starting Pascal...");

  // 1. Connect to MongoDB
  await connectMongo();
  logger.info("MongoDB connected");

  // 2. Ensure Postgres tables exist
  await ensureTables();

  // 3. Load merchant configs (seed Postgres if empty, then load + build index)
  await initMerchantContext();
  logger.info("Merchant context initialized");

  // 4. Start polling Postgres for config changes every 60s
  startConfigPolling();

  // 5. Boot channel adapters (Slack + Telegram)
  const adapters = await bootChannels(handleIncomingMessage);
  logger.info(
    { channels: adapters.map((a) => a.platform) },
    "Pascal is running! Listening for messages..."
  );

  // 6. Initialize scheduler (daily report)
  const slackAdapter = findSlackAdapter(adapters);
  if (slackAdapter) {
    initScheduler(slackAdapter.client);
  } else {
    logger.warn("No Slack adapter — daily report scheduler not started");
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    stopScheduler();
    stopConfigPolling();
    for (const adapter of adapters) {
      await adapter.stop();
    }
    await disconnectMongo();
    await disconnectPg();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Prevent unhandled rejections from crashing the process
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled rejection — not crashing");
});

main().catch((err) => {
  logger.fatal({ err }, "Failed to start Pascal");
  process.exit(1);
});
