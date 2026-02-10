import cron from "node-cron";
import { WebClient } from "@slack/web-api";
import { sendDailyReport } from "./daily-report";
import { logger } from "../utils/logger";

/**
 * Initialize scheduled tasks.
 * Daily report sent at 9:00 AM Mexico City to Eugenio Orozco.
 */
export function initScheduler(slackClient: WebClient): void {
  // Daily report at 9:00 AM Mexico City time
  cron.schedule(
    "0 9 * * *",
    async () => {
      logger.info("Running daily report...");
      try {
        await sendDailyReport(slackClient);
      } catch (err) {
        logger.error({ err }, "Daily report failed");
      }
    },
    { timezone: "America/Mexico_City" }
  );

  logger.info("Scheduler initialized — daily report at 9:00 AM Mexico City");
}
