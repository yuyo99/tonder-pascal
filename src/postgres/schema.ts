import { pgQuery } from "./connection";
import { logger } from "../utils/logger";

const DDL = `
CREATE TABLE IF NOT EXISTS pascal_merchant_channels (
  id            SERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('slack', 'telegram')),
  business_ids  INTEGER[] NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, channel_id)
);

CREATE TABLE IF NOT EXISTS pascal_partner_bots (
  id          SERIAL PRIMARY KEY,
  channel_id  INTEGER NOT NULL REFERENCES pascal_merchant_channels(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pascal_scheduled_reports (
  id              SERIAL PRIMARY KEY,
  channel_id      INTEGER NOT NULL REFERENCES pascal_merchant_channels(id) ON DELETE CASCADE,
  report_type     TEXT NOT NULL DEFAULT 'daily_report',
  is_enabled      BOOLEAN NOT NULL DEFAULT false,
  cron_expr       TEXT NOT NULL DEFAULT '0 9 * * *',
  timezone        TEXT NOT NULL DEFAULT 'America/Mexico_City',
  slack_user_id   TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, report_type)
);
`;

export async function ensureTables(): Promise<void> {
  await pgQuery(DDL);
  logger.info("PostgreSQL tables ensured (pascal_merchant_channels, pascal_partner_bots, pascal_scheduled_reports)");
}
