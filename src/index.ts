import { config } from "./config";
import { connectMongo, disconnectMongo } from "./mongodb/connection";
import { initMerchantContext } from "./merchants/context";
import { bootChannels, findSlackAdapter } from "./channels/registry";
import { handleIncomingMessage } from "./core/orchestrator";
import { initScheduler } from "./scheduler";
import { logger } from "./utils/logger";

async function main() {
  logger.info("Starting Pascal...");

  // 1. Connect to MongoDB
  await connectMongo();
  logger.info("MongoDB connected");

  // 2. Load merchant mappings + business name cache
  await initMerchantContext();
  logger.info("Merchant context initialized");

  // 3. Boot channel adapters (Slack + Telegram)
  const adapters = await bootChannels(handleIncomingMessage);
  logger.info(
    { channels: adapters.map((a) => a.platform) },
    "Pascal is running! Listening for messages..."
  );

  // 4. Initialize scheduler (daily report to Eugenio)
  const slackAdapter = findSlackAdapter(adapters);
  if (slackAdapter) {
    initScheduler(slackAdapter.client);
  } else {
    logger.warn("No Slack adapter — daily report scheduler not started");
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    for (const adapter of adapters) {
      await adapter.stop();
    }
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start Pascal");
  process.exit(1);
});
