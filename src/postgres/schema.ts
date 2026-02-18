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

CREATE TABLE IF NOT EXISTS pascal_conversation_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    INTEGER REFERENCES pascal_merchant_channels(id) ON DELETE SET NULL,
  merchant_name  TEXT NOT NULL,
  platform       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  user_name      TEXT,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  tool_calls     JSONB NOT NULL DEFAULT '[]',
  rounds         INTEGER NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  ticket_id      TEXT,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_conv_log_created
  ON pascal_conversation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pascal_conv_log_merchant
  ON pascal_conversation_log (merchant_name);

CREATE TABLE IF NOT EXISTS pascal_knowledge_base (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL,
  match_pattern TEXT NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  action        TEXT,
  priority      INTEGER DEFAULT 5,
  is_active     BOOLEAN DEFAULT true,
  hit_count     INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_kb_category
  ON pascal_knowledge_base (category) WHERE is_active = true;

DO $$ BEGIN
  ALTER TABLE pascal_conversation_log
    ADD COLUMN IF NOT EXISTS knowledge_used JSONB DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE pascal_merchant_channels ADD COLUMN IF NOT EXISTS integration_model TEXT DEFAULT '';
  ALTER TABLE pascal_merchant_channels ADD COLUMN IF NOT EXISTS active_products TEXT[] DEFAULT '{}';
  ALTER TABLE pascal_merchant_channels ADD COLUMN IF NOT EXISTS stage_email TEXT DEFAULT '';
  ALTER TABLE pascal_merchant_channels ADD COLUMN IF NOT EXISTS production_email TEXT DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS pascal_onboardings (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'merchant' CHECK (type IN ('merchant', 'partner')),
  owner       TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  phases      JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_onboardings_status
  ON pascal_onboardings (status);
`;

export async function ensureTables(): Promise<void> {
  await pgQuery(DDL);
  logger.info("PostgreSQL tables ensured");
}
