import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || "",
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    appToken: process.env.SLACK_APP_TOKEN || "",
    enabled: process.env.SLACK_ENABLED === "true",
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    enabled: process.env.TELEGRAM_ENABLED === "true",
  },
  claude: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929",
  },
  mongodb: {
    uri: required("MONGODB_URI"),
    dbName: process.env.DB_NAME || "pdn",
  },
  linear: {
    apiKey: process.env.LINEAR_API_KEY || "",
    defaultAssignee: process.env.LINEAR_DEFAULT_ASSIGNEE || "guillermo@tonder.io",
  },
  postgres: {
    url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || "",
  },
  logLevel: process.env.LOG_LEVEL || "info",
};
