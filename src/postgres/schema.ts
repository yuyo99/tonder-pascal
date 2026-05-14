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

DO $$ BEGIN
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS target_date DATE;
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS contact_name TEXT DEFAULT '';
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS contact_email TEXT DEFAULT '';
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS contact_phone TEXT DEFAULT '';
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS merchant_channel_id INTEGER REFERENCES pascal_merchant_channels(id) ON DELETE SET NULL;
  ALTER TABLE pascal_onboardings ADD COLUMN IF NOT EXISTS integration_model TEXT DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS pascal_error_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'error',
  message     TEXT NOT NULL,
  stack       TEXT,
  context     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_error_logs_created
  ON pascal_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pascal_error_logs_source
  ON pascal_error_logs (source);

-- Fix bcgameticketbot username: ensure DB has the correct @username (with underscores)
UPDATE pascal_partner_bots
SET username = 'bcgame_ticket_bot'
WHERE LOWER(username) = 'bcgameticketbot';

-- ═══ Ensure Telegram channels & partner bots exist ═══
-- (seedDefaults only runs if table is empty; these migrations ensure entries exist regardless)

INSERT INTO pascal_merchant_channels (label, channel_id, platform, business_ids)
VALUES ('BCGAME', '-1002589749469', 'telegram', ARRAY[121])
ON CONFLICT (platform, channel_id) DO NOTHING;

INSERT INTO pascal_merchant_channels (label, channel_id, platform, business_ids)
VALUES ('Tonder Production 2', '-1003575792934', 'telegram', ARRAY[91])
ON CONFLICT (platform, channel_id) DO NOTHING;

INSERT INTO pascal_partner_bots (channel_id, username, label)
SELECT mc.id, 'bcgame_ticket_bot', 'BcgameTicketBot'
FROM pascal_merchant_channels mc
WHERE mc.channel_id = '-1002589749469' AND mc.platform = 'telegram'
AND NOT EXISTS (
  SELECT 1 FROM pascal_partner_bots pb
  WHERE pb.channel_id = mc.id AND pb.username = 'bcgame_ticket_bot'
);

INSERT INTO pascal_partner_bots (channel_id, username, label)
SELECT mc.id, 'bcgame_ticket_bot', 'BcgameTicketBot'
FROM pascal_merchant_channels mc
WHERE mc.channel_id = '-1003575792934' AND mc.platform = 'telegram'
AND NOT EXISTS (
  SELECT 1 FROM pascal_partner_bots pb
  WHERE pb.channel_id = mc.id AND pb.username = 'bcgame_ticket_bot'
);

INSERT INTO pascal_partner_bots (channel_id, username, label)
SELECT mc.id, 'tonder_operator', 'Tonder Operator (test)'
FROM pascal_merchant_channels mc
WHERE mc.channel_id = '-1003575792934' AND mc.platform = 'telegram'
AND NOT EXISTS (
  SELECT 1 FROM pascal_partner_bots pb
  WHERE pb.channel_id = mc.id AND pb.username = 'tonder_operator'
);

-- ═══ People Knowledge Base ═══
CREATE TABLE IF NOT EXISTS pascal_people (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                TEXT NOT NULL CHECK (type IN ('tonder_team', 'merchant_contact')),
  name                TEXT NOT NULL,
  role                TEXT DEFAULT '',
  company             TEXT DEFAULT '',
  slack_user_id       TEXT,
  telegram_user_id    TEXT,
  email               TEXT DEFAULT '',
  domain              TEXT DEFAULT '',
  topics              TEXT[] DEFAULT '{}',
  escalation_notes    TEXT DEFAULT '',
  merchant_channel_id INTEGER REFERENCES pascal_merchant_channels(id) ON DELETE SET NULL,
  account_manager_id  UUID REFERENCES pascal_people(id) ON DELETE SET NULL,
  notes               TEXT DEFAULT '',
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_people_type ON pascal_people(type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pascal_people_slack ON pascal_people(slack_user_id) WHERE slack_user_id IS NOT NULL AND slack_user_id != '';
CREATE INDEX IF NOT EXISTS idx_pascal_people_telegram ON pascal_people(telegram_user_id) WHERE telegram_user_id IS NOT NULL AND telegram_user_id != '';

-- ═══ Business Rules (Pascal Model 2 — Milestone 4 / AID-82) ═══
-- Persistent directives that survive across sessions. Loaded at Phase 0
-- (Gate) and Phase 4 (system prompt). See PASCAL_MODEL_2.md §4 (Layer 3).
CREATE TABLE IF NOT EXISTS pascal_business_rules (
  id              SERIAL PRIMARY KEY,
  rule_type       TEXT NOT NULL CHECK (rule_type IN ('behavioral','parsing','escalation','tone')),
  scope           TEXT NOT NULL CHECK (scope IN ('global','merchant','channel','bot')),
  scope_value     TEXT,
  instruction     TEXT NOT NULL,
  predicate       JSONB,
  priority        TEXT NOT NULL DEFAULT 'soft' CHECK (priority IN ('hard','soft')),
  source          TEXT NOT NULL CHECK (source IN ('manual','auto:correction','auto:pattern')),
  source_ref      TEXT,
  confidence      REAL NOT NULL DEFAULT 1.0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_applied_at TIMESTAMPTZ,
  apply_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pascal_rules_scope ON pascal_business_rules (scope, scope_value) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pascal_rules_type  ON pascal_business_rules (rule_type) WHERE active = true;

CREATE TABLE IF NOT EXISTS pascal_rule_applications (
  id              SERIAL PRIMARY KEY,
  rule_id         INTEGER NOT NULL REFERENCES pascal_business_rules(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  phase           TEXT NOT NULL CHECK (phase IN ('gate','refine','generate','validate')),
  outcome         TEXT NOT NULL CHECK (outcome IN ('applied','blocked','triggered_regen','no_effect')),
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_rule_app_rule ON pascal_rule_applications (rule_id);
CREATE INDEX IF NOT EXISTS idx_pascal_rule_app_conv ON pascal_rule_applications (conversation_id);

-- ═══ Procedures (Pascal Model 2 — Milestone 6 / AID-79) ═══
-- Multi-step playbooks Pascal injects into the system prompt when intent
-- matches. See PASCAL_MODEL_2.md §6 Milestone 6 AID-79.
CREATE TABLE IF NOT EXISTS pascal_procedures (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  trigger_pattern  TEXT NOT NULL,
  intent_label     TEXT,
  steps_markdown   TEXT NOT NULL,
  tool_bindings    JSONB NOT NULL DEFAULT '[]',
  required_inputs  JSONB NOT NULL DEFAULT '[]',
  success_criteria TEXT,
  scope            TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','merchant','channel')),
  scope_value      TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  owner            TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  dispatch_count   INTEGER NOT NULL DEFAULT 0,
  last_dispatched_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_procedures_active ON pascal_procedures (active, intent_label) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pascal_procedures_scope  ON pascal_procedures (scope, scope_value) WHERE active = true;

-- ═══ Simulations (Pascal Model 2 — Milestone 6 / AID-80) ═══
-- Regression harness: scenarios that exercise Pascal's full pipeline + a
-- judge that checks the response. See PASCAL_MODEL_2.md §6 Milestone 6.
CREATE TABLE IF NOT EXISTS pascal_simulations (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  procedure_id          INTEGER REFERENCES pascal_procedures(id) ON DELETE SET NULL,
  scenario_description  TEXT NOT NULL,
  customer_persona      TEXT NOT NULL,
  opening_message       TEXT NOT NULL,
  max_turns             INTEGER NOT NULL DEFAULT 4,
  expected_outcome      TEXT NOT NULL,
  success_criteria      JSONB NOT NULL,
  merchant_business_id  INTEGER NOT NULL,
  test_channel_id       TEXT NOT NULL,
  last_run_at           TIMESTAMPTZ,
  last_result           TEXT CHECK (last_result IN ('pass','fail','partial','error')),
  last_failure_reason   TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT true,
  owner                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_sims_active ON pascal_simulations (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pascal_sims_procedure ON pascal_simulations (procedure_id) WHERE procedure_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pascal_simulation_runs (
  id              SERIAL PRIMARY KEY,
  simulation_id   INTEGER NOT NULL REFERENCES pascal_simulations(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  result          TEXT CHECK (result IN ('pass','fail','partial','error')),
  judge_summary   TEXT,
  judge_criteria  JSONB,
  transcript      JSONB NOT NULL,
  turns           INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER,
  error           TEXT,
  linear_ticket   TEXT,
  triggered_by    TEXT NOT NULL DEFAULT 'cron'
);
CREATE INDEX IF NOT EXISTS idx_pascal_sim_runs_sim ON pascal_simulation_runs (simulation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pascal_sim_runs_result ON pascal_simulation_runs (result, started_at DESC);

CREATE TABLE IF NOT EXISTS pascal_simulation_jobs (
  id              SERIAL PRIMARY KEY,
  simulation_id   INTEGER NOT NULL REFERENCES pascal_simulations(id) ON DELETE CASCADE,
  triggered_by    TEXT,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  run_id          INTEGER REFERENCES pascal_simulation_runs(id) ON DELETE SET NULL,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_pascal_sim_jobs_pending ON pascal_simulation_jobs (status, triggered_at) WHERE status = 'pending';

-- ═══ Merchant Profiles (Pascal Model 2 — Milestone 4 / AID-73) ═══
-- Per-business_id descriptive context Pascal injects into every system
-- prompt. Closes the Memory layer alongside knowledge / rules / history.
-- See PASCAL_MODEL_2.md §4 Memory Layer 2.
CREATE TABLE IF NOT EXISTS pascal_merchant_profiles (
  id                        SERIAL PRIMARY KEY,
  business_id               INTEGER NOT NULL UNIQUE,
  merchant_name             TEXT NOT NULL,
  one_liner                 TEXT,
  integration_model         TEXT,
  active_products           TEXT[] DEFAULT ARRAY[]::TEXT[],
  account_manager           TEXT,
  primary_contacts          JSONB DEFAULT '[]'::jsonb,
  quirks                    TEXT,
  recurring_issues          TEXT,
  tone_preference           TEXT,
  recent_history_summary    TEXT,
  recent_history_updated_at TIMESTAMPTZ,
  notes                     TEXT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pascal_merchant_profiles_biz ON pascal_merchant_profiles (business_id);

-- ═══ Conversation Replays (Pascal Model 2 — post-M6 Fin "test mode") ═══
-- Replay any past pascal_conversation_log entry against current Pascal so
-- the team can verify rule/procedure/profile changes against real history
-- without waiting for nightly sims. Output captured in a parallel table so
-- analytics can be diffed side-by-side with the original conversation.
CREATE TABLE IF NOT EXISTS pascal_conversation_replays (
  id                       SERIAL PRIMARY KEY,
  original_conversation_id UUID NOT NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at              TIMESTAMPTZ,
  status                   TEXT NOT NULL CHECK (status IN ('pending','running','done','error')) DEFAULT 'pending',
  replayed_answer          TEXT,
  replayed_tool_calls      JSONB NOT NULL DEFAULT '[]'::jsonb,
  replayed_rounds          INTEGER NOT NULL DEFAULT 0,
  replayed_latency_ms      INTEGER,
  error                    TEXT,
  triggered_by             TEXT NOT NULL DEFAULT 'dashboard'
);
CREATE INDEX IF NOT EXISTS idx_pascal_replays_orig ON pascal_conversation_replays (original_conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pascal_replays_status ON pascal_conversation_replays (status, started_at DESC);

CREATE TABLE IF NOT EXISTS pascal_replay_jobs (
  id                       SERIAL PRIMARY KEY,
  original_conversation_id UUID NOT NULL,
  triggered_by             TEXT,
  triggered_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  replay_id                INTEGER REFERENCES pascal_conversation_replays(id) ON DELETE SET NULL,
  error                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pascal_replay_jobs_pending ON pascal_replay_jobs (status, triggered_at) WHERE status = 'pending';

-- ═══ Seed: Integration Knowledge Base Entries ═══
` +
`
INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'spei, bank transfer, transferencia bancaria, clabe, transferencia spei',
       'SPEI Bank Transfer Integration',
       '## SPEI Bank Transfers' || chr(10) || chr(10) ||
       'To create a SPEI payment, send a POST to /api/v1/process/ with:' || chr(10) || chr(10) ||
       '  { "operation_type": "payment", "amount": 500.00, "currency": "MXN",' || chr(10) ||
       '    "customer": { "name": "Name", "email": "email@example.com" },' || chr(10) ||
       '    "payment_method": { "type": "SPEI" }, "client_reference": "invoice-456" }' || chr(10) || chr(10) ||
       'The response includes payment_instructions with a CLABE (18-digit bank account) and a reference number. The customer must make a SPEI transfer to that CLABE using that reference.' || chr(10) || chr(10) ||
       'Status flow: pending -> processing -> success.' || chr(10) ||
       'SPEI operates 24/7 and most transfers process instantly. Minimum amount is $1 MXN.' || chr(10) || chr(10) ||
       'Full docs: https://docs.tonder.io/direct-integration/payment-methods/spei-bank-transfers',
       'Share the endpoint, request body structure, and link to full docs.',
       3, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'SPEI Bank Transfer Integration');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'frictionless, frictionless spei, spei frictionless, automatic deposit, deposito automatico, spei automatico',
       'Frictionless SPEI Deposits — Overview',
       '## Frictionless SPEI Deposits' || chr(10) || chr(10) ||
       'Frictionless SPEI automatically processes bank transfers even when they don''t match an existing pending transaction. It handles two use cases:' || chr(10) || chr(10) ||
       'Use Case 1 — Mismatched Amount: Customer initiates checkout for $500 but transfers $600. Frictionless SPEI accepts the deposit and flags it with mismatched_deposit: "True" and original_expected_amount in the webhook.' || chr(10) || chr(10) ||
       'Use Case 2 — Direct Transfer (no checkout): Customer sends money directly to their assigned CLABE without any prior checkout. Frictionless SPEI auto-creates the transaction and notifies via webhook.' || chr(10) || chr(10) ||
       'The CLABE (18-digit account) is uniquely assigned per merchant-customer pair and serves as the primary deposit identifier.' || chr(10) || chr(10) ||
       'Prerequisite: Standard SPEI integration must be set up first.' || chr(10) || chr(10) ||
       'Full docs: https://docs.tonder.io/direct-integration/payment-methods/frictionless-spei-deposits',
       'Explain the two use cases clearly and link to full docs. Ask which use case the merchant needs help with.',
       3, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Frictionless SPEI Deposits — Overview');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'external_id, additional_external_id, spei identifier, spei metadata, reconciliation, reconciliacion',
       'Frictionless SPEI — Identifier Strategy',
       '## Frictionless SPEI Identifier Strategy' || chr(10) || chr(10) ||
       'Merchants pass identifiers in the metadata object of the payment request to enable reconciliation.' || chr(10) || chr(10) ||
       'Single Identifier (Recommended): Use external_id for both use cases.' || chr(10) ||
       '  { "metadata": { "external_id": "PLAYER-12345" } }' || chr(10) ||
       'Both UC1 and UC2 webhooks return this same identifier. Simplest approach.' || chr(10) || chr(10) ||
       'Dual Identifier (Advanced): Use external_id for checkout orders + additional_external_id for direct transfers.' || chr(10) ||
       '  { "metadata": { "external_id": "ORDER-12345", "additional_external_id": "PLAYER-98765" } }' || chr(10) ||
       'UC1 webhooks return the order identifier (external_id). UC2 webhooks return the customer identifier (additional_external_id).' || chr(10) || chr(10) ||
       'Recommendation: Start with Single Identifier unless you have a specific reconciliation need for separating order IDs from customer IDs.',
       'Recommend Single Identifier approach unless the merchant explicitly needs dual identifiers.',
       4, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Frictionless SPEI — Identifier Strategy');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'spei webhook, frictionless webhook, mismatched deposit, spei notification, webhook spei, spei payload',
       'Frictionless SPEI — Webhook Payloads',
       '## Frictionless SPEI Webhook Payloads' || chr(10) || chr(10) ||
       'Use Case 1 — Mismatched Amount webhook:' || chr(10) ||
       '  { "data": { "amount": 600.0, "clabe": "123456789012345678", "transaction_status": "Success",' || chr(10) ||
       '    "metadata": { "external_id": "ORDER-12345", "additional_external_id": "PLAYER-98765",' || chr(10) ||
       '    "mismatched_deposit": "True", "original_expected_amount": "500" } } }' || chr(10) || chr(10) ||
       'Use Case 2 — Direct Transfer (no checkout) webhook:' || chr(10) ||
       '  { "data": { "amount": 700.0, "clabe": "123456789012345678", "transaction_status": "Success",' || chr(10) ||
       '    "metadata": { "additional_external_id": "PLAYER-98765",' || chr(10) ||
       '    "concept": "Frictionless deposit - auto-created" } } }' || chr(10) || chr(10) ||
       'Key fields: clabe (18-digit account), amount (actual deposited), transaction_status, external_id, additional_external_id, mismatched_deposit (UC1 only), original_expected_amount (UC1 only), concept (UC2 only).' || chr(10) || chr(10) ||
       'Webhook docs: https://docs.tonder.io/direct-integration/webhooks/how-webhooks-works',
       'Show the relevant webhook payload example based on which use case the merchant asks about.',
       4, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Frictionless SPEI — Webhook Payloads');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'field alias, spei alias, custom field, order_id alias, player_id, field mapping',
       'Frictionless SPEI — Field Aliases',
       '## Frictionless SPEI Field Aliases' || chr(10) || chr(10) ||
       'Merchants can configure domain-specific naming for identifier fields through field aliases. This maps generic Tonder fields to industry-standard labels.' || chr(10) || chr(10) ||
       'Example: { "field_aliases": { "order_id": "external_id", "player_id": "additional_external_id" } }' || chr(10) || chr(10) ||
       'With aliases configured, webhook payloads will use the custom names instead of the generic ones. Useful for iGaming (player_id), e-commerce (order_id), and other verticals.' || chr(10) || chr(10) ||
       'Note: This is configured at the account level. Contact Tonder support to set up field aliases.',
       'Explain the alias concept and tell the merchant to contact Tonder support to configure aliases.',
       5, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Frictionless SPEI — Field Aliases');

-- ═══ Seed: General Integration Knowledge ═══

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'status, statuses, final status, estado, sent_to_provider, on_hold, paid_full, in_transit, unknown status, pending status, estados finales',
       'Tonder Payment Statuses',
       '## Tonder Payment Statuses' || chr(10) || chr(10) ||
       'Final statuses (no further changes):' || chr(10) ||
       '- Success / paid_full — Payment completed successfully' || chr(10) ||
       '- Failed — Payment failed during processing' || chr(10) ||
       '- Declined — Payment was rejected by the acquirer or issuing bank' || chr(10) ||
       '- Expired — Payment timed out before completion' || chr(10) || chr(10) ||
       'Intermediate statuses (may still change):' || chr(10) ||
       '- Pending — Awaiting customer action or processing' || chr(10) ||
       '- sent_to_provider — Transaction sent to the payment processor, awaiting response' || chr(10) ||
       '- on_hold — Transaction is being reviewed (e.g., anti-fraud check by Guardian)' || chr(10) ||
       '- in_transit — Funds are being transferred (common in SPEI/bank transfers)' || chr(10) ||
       '- Unknown — Communication error with the provider; requires manual verification' || chr(10) || chr(10) ||
       'For reconciliation, treat Success and paid_full as successful. Treat Failed, Declined, and Expired as final unsuccessful.',
       'List the statuses clearly and explain which are final vs intermediate.',
       2, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Tonder Payment Statuses');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       '3ds, 3d secure, 3dv2, 3d, authentication, autenticacion, 3d secure 2, emv 3ds',
       '3D Secure (3DS) Support',
       '## 3D Secure Support' || chr(10) || chr(10) ||
       'Yes, Tonder fully supports 3D Secure v2 (EMV 3DS / 3DSv2).' || chr(10) || chr(10) ||
       'Key details:' || chr(10) ||
       '- 3DSv2 is handled automatically by Tonder''s Guardian anti-fraud system' || chr(10) ||
       '- No extra merchant configuration is required — Guardian decides when to trigger 3DS based on risk analysis' || chr(10) ||
       '- Supports both frictionless and challenge flows' || chr(10) ||
       '- Works with Visa, Mastercard, and American Express' || chr(10) ||
       '- The 3DS authentication is transparent to the integration — the merchant receives the final transaction status via webhook' || chr(10) || chr(10) ||
       'If you need to force 3DS for specific transactions or configure custom rules, contact your Tonder integration manager.',
       'Confirm 3DS support clearly. Mention Guardian handles it automatically.',
       2, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = '3D Secure (3DS) Support');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'card types, card brands, visa, mastercard, amex, american express, tarjeta, tarjetas soportadas, supported cards',
       'Supported Card Types',
       '## Supported Card Types' || chr(10) || chr(10) ||
       'Tonder supports the following card brands:' || chr(10) ||
       '- Visa (credit and debit)' || chr(10) ||
       '- Mastercard (credit and debit)' || chr(10) ||
       '- American Express (credit)' || chr(10) || chr(10) ||
       'Both domestic (Mexican) and international cards are supported.' || chr(10) ||
       'Card-not-present (CNP) transactions are the primary use case.' || chr(10) || chr(10) ||
       'For specific card type availability per acquirer or to enable additional card brands, contact your Tonder integration manager.',
       'List the supported card brands clearly.',
       3, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Supported Card Types');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'server ip, ip address, whitelist, notification ip, webhook ip, ips, ip whitelist, firewall, direccion ip',
       'Webhook Notification IPs',
       '## Webhook & Server IPs' || chr(10) || chr(10) ||
       'Tonder sends webhook notifications from specific IP addresses that you may need to whitelist in your firewall.' || chr(10) || chr(10) ||
       'To get the current list of Tonder notification IPs for whitelisting, contact your Tonder integration manager or reach out to support.' || chr(10) || chr(10) ||
       'Webhook configuration:' || chr(10) ||
       '- Webhooks are sent via HTTPS POST' || chr(10) ||
       '- Content-Type: application/json' || chr(10) ||
       '- Your endpoint must return HTTP 200 to acknowledge receipt' || chr(10) ||
       '- Failed deliveries are retried automatically' || chr(10) || chr(10) ||
       'Docs: https://docs.tonder.io/direct-integration/webhooks/how-webhooks-works',
       'Tell the merchant to contact their Tonder integration manager for the IP list. Share webhook docs link.',
       3, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Webhook Notification IPs');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'authorization, capture, auth capture, pre-auth, preauthorization, preautorizacion, auth-capture, two-step',
       'Authorization-Capture Flow',
       '## Authorization-Capture Flow' || chr(10) || chr(10) ||
       'Tonder supports the Authorization-Capture (two-step) payment flow:' || chr(10) || chr(10) ||
       '1. Authorization — Reserves the amount on the cardholder''s card without capturing funds' || chr(10) ||
       '2. Capture — Settles the previously authorized amount (can be partial or full)' || chr(10) || chr(10) ||
       'This is useful for merchants who need to verify inventory, shipping, or service availability before charging the customer.' || chr(10) || chr(10) ||
       'To enable auth-capture flow or configure it for your integration, contact your Tonder integration manager for the specific API parameters.',
       'Confirm support and explain the two-step flow.',
       4, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Authorization-Capture Flow');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'expiration, expire, timeout, pending timeout, abandoned, expiración, tiempo de expiración, cuanto tiempo, how long pending',
       'Transaction Expiration Times',
       '## Transaction Expiration' || chr(10) || chr(10) ||
       'Pending and abandoned transactions have expiration policies:' || chr(10) || chr(10) ||
       '- Card payments (pending): Typically expire after the session timeout (usually 15-30 minutes depending on configuration)' || chr(10) ||
       '- SPEI transfers (pending): Expire after 72 hours if no transfer is received' || chr(10) ||
       '- Cash vouchers (Oxxo, etc.): Expire after the configured validity period (typically 24-72 hours)' || chr(10) ||
       '- Abandoned checkouts: Sessions expire based on the configured timeout' || chr(10) || chr(10) ||
       'Expired transactions move to "Expired" status which is final — no further changes.' || chr(10) ||
       'For custom expiration times, contact your Tonder integration manager.',
       'Explain expiration times by payment method. Clarify that Expired is a final status.',
       4, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Transaction Expiration Times');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'integration, integrate, how to integrate, setup, configurar, implementar, getting started, como integrar, sdk, api integration',
       'Integration Options Overview',
       '## Tonder Integration Options' || chr(10) || chr(10) ||
       'Tonder offers multiple ways to integrate:' || chr(10) || chr(10) ||
       '1. Direct API — Full control, server-to-server REST API' || chr(10) ||
       '   Docs: https://docs.tonder.io/direct-integration/api-reference/process-transaction' || chr(10) ||
       '2. SDK — JavaScript, iOS, and Android SDKs for client-side integration' || chr(10) ||
       '   Docs: https://docs.tonder.io/sdks' || chr(10) ||
       '3. Hosted Checkout — Tonder-hosted payment page, minimal integration effort' || chr(10) ||
       '4. Payment Links — No-code payment collection via shareable links' || chr(10) ||
       '5. Plugins — Pre-built integrations for platforms like WooCommerce, Shopify, etc.' || chr(10) || chr(10) ||
       'All integrations support cards (Visa, Mastercard, Amex), SPEI, and alternative payment methods.' || chr(10) ||
       'Start here: https://docs.tonder.io',
       'Overview the integration options and share relevant docs links. Ask which approach the merchant prefers.',
       3, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Integration Options Overview');

INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
SELECT 'integration',
       'decline, declined, reject, rejected, error code, decline code, rechazado, codigo de rechazo, soft decline, hard decline',
       'Decline Codes & Meanings',
       '## Common Decline Codes' || chr(10) || chr(10) ||
       'Soft declines (temporary — retry may succeed):' || chr(10) ||
       '- Insufficient funds — Cardholder doesn''t have enough balance' || chr(10) ||
       '- Try again later — Temporary issue with the issuing bank' || chr(10) ||
       '- Card limit exceeded — Daily or monthly limit reached' || chr(10) ||
       '- Network error — Communication timeout with processor' || chr(10) || chr(10) ||
       'Hard declines (permanent — do NOT retry):' || chr(10) ||
       '- Card declined / Do not honor — Issuing bank rejected the transaction' || chr(10) ||
       '- Invalid card number — Card number is wrong or doesn''t exist' || chr(10) ||
       '- Expired card — Card has passed its expiry date' || chr(10) ||
       '- Stolen/lost card — Card has been reported stolen or lost' || chr(10) ||
       '- Fraud suspected — Flagged by bank''s fraud system' || chr(10) || chr(10) ||
       'For soft declines, implementing smart retry logic can recover 10-20% of failed payments. Contact your integration manager for retry best practices.',
       'Explain the decline type and suggest next steps. For soft declines, mention retry possibility.',
       3, true
WHERE NOT EXISTS (SELECT 1 FROM pascal_knowledge_base WHERE title = 'Decline Codes & Meanings');

-- ═══ Monitoring: Heartbeat ═══
CREATE TABLE IF NOT EXISTS pascal_health_heartbeats (
  service_name   TEXT PRIMARY KEY,
  last_seen_at   TIMESTAMPTZ NOT NULL,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ═══ Monitoring: Self-QA Events ═══
CREATE TABLE IF NOT EXISTS pascal_self_qa_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform          TEXT NOT NULL,
  channel_id        TEXT NOT NULL,
  merchant_name     TEXT,
  business_id       TEXT,
  message_type      TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'critical')),
  latency_ms        INT,
  parse_confidence  NUMERIC,
  answer_confidence NUMERIC,
  fallback_used     BOOLEAN NOT NULL DEFAULT false,
  responded         BOOLEAN NOT NULL DEFAULT false,
  failure_reason    TEXT,
  raw_input         TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_pascal_self_qa_created ON pascal_self_qa_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pascal_self_qa_status ON pascal_self_qa_events (status) WHERE status != 'ok';
CREATE INDEX IF NOT EXISTS idx_pascal_self_qa_channel ON pascal_self_qa_events (channel_id);

-- ═══ Monitoring: Incidents (deduped by fingerprint) ═══
CREATE TABLE IF NOT EXISTS pascal_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  severity        TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  fingerprint     TEXT NOT NULL UNIQUE,
  merchant_name   TEXT,
  channel_id      TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL,
  occurrences     INT NOT NULL DEFAULT 1,
  latest_details  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_pascal_incidents_status ON pascal_incidents (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_pascal_incidents_fingerprint ON pascal_incidents (fingerprint);

-- ═══ Monitoring: Synthetic Check Runs ═══
CREATE TABLE IF NOT EXISTS pascal_synthetic_check_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_name   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pass', 'fail')),
  latency_ms   INT,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_pascal_synthetic_created ON pascal_synthetic_check_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pascal_synthetic_check ON pascal_synthetic_check_runs (check_name, created_at DESC);
`;

export async function ensureTables(): Promise<void> {
  // Enable pgvector extension (separate query — non-fatal if not available)
  try {
    await pgQuery("CREATE EXTENSION IF NOT EXISTS vector");
    logger.info("pgvector extension enabled");
  } catch (err) {
    logger.warn({ err }, "pgvector extension not available — semantic search will use keyword fallback");
  }

  await pgQuery(DDL);
  logger.info("PostgreSQL tables ensured");

  // Add non-vector columns first (these always succeed regardless of pgvector)
  try {
    await pgQuery(`ALTER TABLE pascal_knowledge_base ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
    await pgQuery(`ALTER TABLE pascal_knowledge_base ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 1.0`);
    await pgQuery(`ALTER TABLE pascal_knowledge_base ADD COLUMN IF NOT EXISTS business_id INT`);
    logger.info("Knowledge base metadata columns ready (source, confidence, business_id)");
  } catch (err) {
    logger.warn({ err }, "Failed to add metadata columns");
  }

  // Add embedding column SEPARATELY (requires pgvector — failure does NOT block the metadata columns above)
  try {
    await pgQuery(`ALTER TABLE pascal_knowledge_base ADD COLUMN IF NOT EXISTS embedding vector(1536)`);
    await pgQuery(`
      CREATE INDEX IF NOT EXISTS pascal_kb_embedding_idx
        ON pascal_knowledge_base USING hnsw (embedding vector_cosine_ops)
    `);
    logger.info("pgvector column and index ready on pascal_knowledge_base");
  } catch (err) {
    logger.warn({ err }, "pgvector unavailable — semantic search disabled, keyword fallback active");
  }

  // Add conversation_id to self-QA events (for nightly auto-learn join, AID-79)
  try {
    await pgQuery(`
      ALTER TABLE pascal_self_qa_events
        ADD COLUMN IF NOT EXISTS conversation_id UUID;
    `);
    await pgQuery(`
      CREATE INDEX IF NOT EXISTS idx_pascal_self_qa_conversation_id
        ON pascal_self_qa_events (conversation_id) WHERE conversation_id IS NOT NULL;
    `);
  } catch (err) {
    logger.warn({ err }, "Failed to add conversation_id to self-QA events");
  }

  // Knowledge gaps table (AID-80) — requires pgvector for embedding column
  try {
    await pgQuery(`
      CREATE TABLE IF NOT EXISTS pascal_knowledge_gaps (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question          TEXT NOT NULL,
        channel_id        TEXT,
        platform          TEXT,
        merchant_name     TEXT,
        business_id       INT,
        frequency         INT DEFAULT 1,
        status            TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'dismissed')),
        suggested_category TEXT,
        embedding         vector(1536),
        detected_at       TIMESTAMPTZ DEFAULT now(),
        updated_at        TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_gaps_status ON pascal_knowledge_gaps(status);
      CREATE INDEX IF NOT EXISTS idx_gaps_embedding
        ON pascal_knowledge_gaps USING hnsw (embedding vector_cosine_ops);
    `);
    logger.info("pascal_knowledge_gaps table ready");
  } catch (err) {
    logger.warn({ err }, "Failed to create pascal_knowledge_gaps table (pgvector may not be available)");
  }

  // ═══ Pascal Model 2 / AID-82 — Seed day-one business rules ═══
  // Idempotent inserts (WHERE NOT EXISTS on a stable key).
  // These capture the corrections the team has already given Pascal,
  // so the rules system is useful the moment AID-82 ships.
  try {
    await pgQuery(`
      -- Don't respond unless explicitly tagged — BC Game Telegram channels
      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, predicate, priority, source, created_by)
      SELECT 'behavioral', 'channel', '-1002589749469',
        'Do not respond to messages in this channel unless the message explicitly tags @Pascal or replies to a Pascal message.',
        '{"type": "require_mention", "tags": ["@pascal", "@Pascal"]}'::jsonb,
        'hard', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'channel' AND scope_value = '-1002589749469' AND rule_type = 'behavioral'
      );

      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, predicate, priority, source, created_by)
      SELECT 'behavioral', 'channel', '-1003575792934',
        'Do not respond to messages in this channel unless the message explicitly tags @Pascal or replies to a Pascal message.',
        '{"type": "require_mention", "tags": ["@pascal", "@Pascal"]}'::jsonb,
        'hard', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'channel' AND scope_value = '-1003575792934' AND rule_type = 'behavioral'
      );

      -- BC Game ticket bot parsing — payment_customer_order_reference, not txid.
      -- (Field name corrected: the MongoDB column is payment_customer_order_reference
      -- in mv_payment_transactions. customer_order_id does not exist.)
      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, predicate, priority, source, created_by)
      SELECT 'parsing', 'bot', 'bcgame_ticket_bot',
        'When parsing deposit tickets from this bot, the customer order reference ID is stored in the payment_customer_order_reference field on mv_payment_transactions (NOT customer_order_id, which does not exist, and NOT txid, which holds the blockchain transaction hash). Always look up BC Game order IDs against payment_customer_order_reference first.',
        '{"extract_field": "payment_customer_order_reference", "as": "ref_id", "fallback_field": "txid"}'::jsonb,
        'hard', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'bot' AND scope_value = 'bcgame_ticket_bot' AND rule_type = 'parsing'
      );

      -- Fix any previously-seeded version of the BC Game parsing rule that
      -- used the wrong field name. Idempotent — only updates rows that still
      -- reference the wrong field. Safe to run every boot.
      UPDATE pascal_business_rules
         SET instruction = 'When parsing deposit tickets from this bot, the customer order reference ID is stored in the payment_customer_order_reference field on mv_payment_transactions (NOT customer_order_id, which does not exist, and NOT txid, which holds the blockchain transaction hash). Always look up BC Game order IDs against payment_customer_order_reference first.',
             predicate = '{"extract_field": "payment_customer_order_reference", "as": "ref_id", "fallback_field": "txid"}'::jsonb
       WHERE scope = 'bot'
         AND scope_value = 'bcgame_ticket_bot'
         AND rule_type = 'parsing'
         AND (instruction LIKE '%customer_order_id%' OR predicate->>'extract_field' = 'customer_order_id');

      -- Tonder Prod internal channel — skip provider masking
      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, priority, source, created_by)
      SELECT 'behavioral', 'channel', 'C0AF237ATKJ',
        'This is the internal Tonder team channel. Skip provider masking — internal acquirer names (kushki, bitso, stp, unlimit, safetypay, guardian) are allowed and expected here.',
        'hard', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'channel' AND scope_value = 'C0AF237ATKJ' AND rule_type = 'behavioral'
      );

      -- Stadiobet tone — formal Spanish, no emojis
      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, priority, source, created_by)
      SELECT 'tone', 'merchant', '530',
        'Stadiobet contacts prefer formal Spanish (usted, not tú). No emojis.',
        'soft', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'merchant' AND scope_value = '530' AND rule_type = 'tone'
      );

      -- Campobet account creation always escalates to Geraldine
      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, priority, source, created_by)
      SELECT 'escalation', 'merchant', '120',
        'Account creation issues always go through Geraldine; do not attempt to diagnose.',
        'hard', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'merchant' AND scope_value = '120' AND rule_type = 'escalation'
      );

      -- Vitau high-value refunds always go through Roberto (FinOps)
      INSERT INTO pascal_business_rules (rule_type, scope, scope_value, instruction, priority, source, created_by)
      SELECT 'escalation', 'merchant', '82',
        'For refund requests over $5,000 USD equivalent, create a Linear ticket assigned to Roberto (FinOps) and mention him in the response. Do not attempt to process the refund directly.',
        'hard', 'manual', 'yuyo'
      WHERE NOT EXISTS (
        SELECT 1 FROM pascal_business_rules
        WHERE scope = 'merchant' AND scope_value = '82' AND rule_type = 'escalation'
      );
    `);
    logger.info("Day-one business rules seeded (idempotent)");
  } catch (err) {
    logger.warn({ err }, "Failed to seed business rules (table may not exist yet — non-fatal)");
  }

  // ═══ Pascal Model 2 / AID-79 — Seed day-one procedures ═══
  // Multi-step playbooks Pascal dispatches when intent_label matches.
  // Each is idempotent on the `name` UNIQUE constraint. To revise a
  // procedure's body in production, run UPDATE directly on the row.
  try {
    await pgQuery(`
      INSERT INTO pascal_procedures
        (name, intent_label, trigger_pattern, steps_markdown, tool_bindings, required_inputs, success_criteria, scope, owner)
      VALUES (
        'refund_eligibility_and_execution',
        'refund',
        '\\m(refund|reembolso|devoluci|chargeback)\\M',
        '## Refund procedure' || chr(10) || chr(10) ||
        'When a merchant asks about a refund, follow this sequence:' || chr(10) || chr(10) ||
        '1. **Use lookup_by_id first** with the transaction ID the merchant provided. Never proceed without confirming the transaction exists.' || chr(10) || chr(10) ||
        '2. **Check the payment method**:' || chr(10) ||
        '   - Cards (Visa/Mastercard/Amex) → refunds allowed' || chr(10) ||
        '   - SPEI / Oxxopay / MercadoPago / Cash Vouchers → **refunds are NOT supported via the platform.** Tell the merchant this clearly. SPEI/voucher refunds must be handled bank-side.' || chr(10) || chr(10) ||
        '3. **Check the transaction status** from the lookup:' || chr(10) ||
        '   - \`success\` → eligible for refund' || chr(10) ||
        '   - \`pending\` / \`processing\` → tell the merchant to wait for it to settle first' || chr(10) ||
        '   - \`failed\` / \`declined\` → no refund needed (no money moved). Explain.' || chr(10) || chr(10) ||
        '4. **Check time window**: most card refunds work within 90 days of the original transaction. Beyond that, the merchant must contact the issuing bank directly.' || chr(10) || chr(10) ||
        '5. **If eligible**: confirm the refund amount with the merchant before acting. Use \`generate_refund_receipt\` to produce the PDF + log.' || chr(10) || chr(10) ||
        '6. **High-value (>$5,000 USD equivalent)**: do NOT process directly. Create a Linear ticket and mention Roberto (FinOps).' || chr(10) || chr(10) ||
        'Always show the merchant what you are about to do BEFORE you do it. Refunds are irreversible.',
        '["lookup_by_id","generate_refund_receipt","create_internal_ticket"]'::jsonb,
        '["transaction_id"]'::jsonb,
        'merchant receives a clear answer about eligibility, and if eligible, a refund receipt PDF is generated or a Linear ticket is opened',
        'global',
        'roberto'
      )
      ON CONFLICT (name) DO NOTHING;

      INSERT INTO pascal_procedures
        (name, intent_label, trigger_pattern, steps_markdown, tool_bindings, required_inputs, success_criteria, scope, owner)
      VALUES (
        'spei_deposit_not_received',
        'deposit_investigation',
        '\\m(spei|deposit|deposito|clabe|clave de rastreo|tracking key|no llega|missing deposit)\\M',
        '## SPEI deposit investigation' || chr(10) || chr(10) ||
        'When a merchant asks "I made a SPEI deposit but it''s not showing":' || chr(10) || chr(10) ||
        '1. **Get the deposit identifier.** Ask for one of: tracking key (clave de rastreo), CLABE, payment_id, or order_id. If none provided, ask before proceeding.' || chr(10) || chr(10) ||
        '2. **Use lookup_by_id** to find the transaction across all systems (deposits, SPEI deposits, withdrawals).' || chr(10) || chr(10) ||
        '3. **Interpret the result**:' || chr(10) ||
        '   - Found with status \`success\` → already processed; ask which channel/dashboard they were checking' || chr(10) ||
        '   - Found with status \`pending\` → tell them the expected window. Most SPEI < 1 hour but can take up to 24h on weekends.' || chr(10) ||
        '   - Found with status \`failed\` / \`expired\` → explain the reason and what to do (re-create the order, or contact their bank)' || chr(10) ||
        '   - **Not found** → check time-of-day:' || chr(10) ||
        '     • During SPEI hours (Mon–Sat 06:00–17:30 MX) → wait 30 minutes, then escalate' || chr(10) ||
        '     • Outside SPEI hours → tell them to wait until next business day' || chr(10) || chr(10) ||
        '4. **If >24h old and still missing**: create an internal ticket and mention Roberto (FinOps). Include the tracking key + CLABE + merchant name in the ticket.' || chr(10) || chr(10) ||
        'Never invent a transaction status. Only report what \`lookup_by_id\` returns. If the lookup is empty, say so explicitly.',
        '["lookup_by_id","create_internal_ticket"]'::jsonb,
        '["tracking_key_or_clabe_or_id"]'::jsonb,
        'merchant gets a clear status or a clear next-step (wait until X, contact bank, or escalation ticket opened with Roberto)',
        'global',
        'roberto'
      )
      ON CONFLICT (name) DO NOTHING;

      INSERT INTO pascal_procedures
        (name, intent_label, trigger_pattern, steps_markdown, tool_bindings, required_inputs, success_criteria, scope, owner)
      VALUES (
        'acceptance_rate_drop_diagnosis',
        'acceptance_diagnosis',
        '\\m(acceptance|aceptaci|approval|rate drop|baja|cayo|tasa de aceptaci|declines? subi)\\M',
        '## Acceptance rate drop diagnosis' || chr(10) || chr(10) ||
        'When a merchant asks why their acceptance rate dropped:' || chr(10) || chr(10) ||
        '1. **Get the comparison window.** Ask: "compared to which period?" (last week, last month, last quarter). Default to last 7 days vs. previous 7 days if unclear.' || chr(10) || chr(10) ||
        '2. **Use \`get_acceptance_rate\`** for both windows. Calculate the delta in percentage points.' || chr(10) || chr(10) ||
        '3. **Break down by payment method** to identify which one dropped:' || chr(10) ||
        '   - Cards (Visa/Mastercard/Amex)' || chr(10) ||
        '   - SPEI' || chr(10) ||
        '   - APMs (Oxxopay / MercadoPago / etc.)' || chr(10) || chr(10) ||
        '4. **For the method that dropped most, use \`get_decline_breakdown\`** to identify which decline reason grew most: insufficient funds, do not honor, fraud rejected, etc.' || chr(10) || chr(10) ||
        '5. **Surface the top 3 hypotheses** based on the breakdown:' || chr(10) ||
        '   - If "do not honor" grew: likely issuing-bank policy change → ask about affected BINs' || chr(10) ||
        '   - If "fraud rejected" grew: likely 3DS friction or volume spike from a new geography → suggest checking \`get_3ds_breakdown\`' || chr(10) ||
        '   - If "insufficient funds" grew: market-level, less actionable; report the trend without diagnosing' || chr(10) || chr(10) ||
        '6. **Always quote the actual numbers** from the tool outputs. Do not estimate or extrapolate.' || chr(10) || chr(10) ||
        'Escalate to the merchant''s integration manager if the drop is >10 percentage points and you cannot identify a clear cause from the breakdown.',
        '["get_acceptance_rate","get_decline_breakdown","get_3ds_breakdown","create_internal_ticket"]'::jsonb,
        '["date_range"]'::jsonb,
        'merchant gets a clear answer: which method dropped, by how much, the top decline reason, and 1-3 hypotheses with confidence',
        'global',
        'sandy'
      )
      ON CONFLICT (name) DO NOTHING;
    `);
    logger.info("Day-one procedures seeded (idempotent)");
  } catch (err) {
    logger.warn({ err }, "Failed to seed procedures (table may not exist yet — non-fatal)");
  }

  // ═══ Pascal Model 2 / AID-80 — Seed day-one simulations ═══
  // Regression scenarios. Each pins to a procedure (or runs free-form) with
  // a customer persona prompt + opening message + success criteria for the
  // judge. Idempotent on UNIQUE name. Synthetic merchant channel row is
  // upserted with platform=sim so resolveMerchantContext() works against
  // it without polluting real merchant queries (which filter on slack/telegram).
  try {
    await pgQuery(`
      -- Synthetic channel registration. platform='slack' so the CHECK constraint
      -- passes; the 'sim:' channel_id prefix is what identifies it as a
      -- simulation bench and excludes it from merchant-facing views.
      INSERT INTO pascal_merchant_channels (label, channel_id, platform, business_ids, is_active, notes)
      VALUES ('Sim Bench', 'sim:bench', 'slack', ARRAY[1]::integer[], true, 'Auto-managed simulation bench — do not edit')
      ON CONFLICT (platform, channel_id) DO NOTHING;

      INSERT INTO pascal_simulations
        (name, procedure_id, scenario_description, customer_persona, opening_message,
         expected_outcome, success_criteria, merchant_business_id, test_channel_id, owner)
      SELECT
        'refund_cards_eligible_basic',
        (SELECT id FROM pascal_procedures WHERE name = 'refund_eligibility_and_execution' LIMIT 1),
        'BC Game ops asks Pascal to refund a successful card payment — happy path.',
        'You are a BC Game operations specialist. You need to refund payment_id 4520690 because the customer asked to cancel. You typed your request and now wait for Pascal''s reply. If Pascal asks for confirmation about anything (amount, payment method, etc.), answer truthfully. If Pascal asks a question you do not have an answer to, say "no tengo esa info, dejame revisar" and stop. Stay in Spanish, sound like a real person, do not break character.',
        'Hola, necesito reembolsar el pago 4520690 — el cliente nos pidio cancelar',
        'Pascal looks up the transaction, identifies it as a card payment, checks status is success, asks the merchant to confirm amount before refunding, mentions that a receipt PDF will be generated.',
        '["called lookup_by_id with the payment ID", "identified payment method as card / Visa / Mastercard / Amex", "asked merchant for confirmation before executing the refund", "did not skip the status check"]'::jsonb,
        1, 'sim:refund_cards_eligible_basic', 'roberto'
      WHERE NOT EXISTS (SELECT 1 FROM pascal_simulations WHERE name = 'refund_cards_eligible_basic');

      INSERT INTO pascal_simulations
        (name, procedure_id, scenario_description, customer_persona, opening_message,
         expected_outcome, success_criteria, merchant_business_id, test_channel_id, owner)
      SELECT
        'spei_deposit_pending_explanation',
        (SELECT id FROM pascal_procedures WHERE name = 'spei_deposit_not_received' LIMIT 1),
        'A merchant client says they made a SPEI deposit one hour ago and it is not visible yet.',
        'You are a Stadiobet client (player). You sent $5,000 MXN by SPEI an hour ago and the deposit has not shown up in your gaming account. You are anxious but polite. Stay in Spanish. If Pascal asks for a tracking key, clave de rastreo, CLABE, or order ID, INVENT a plausible one like "CLAVE1234567890ABCDEF" or "8004562300012345" and provide it. If Pascal asks anything else specific, answer briefly and naturally; if you do not know, say "no se, solo hice la transferencia y no llega".',
        'transferi $5,000 MXN via SPEI hace una hora y no aparece',
        'Pascal asks for an identifier (tracking key, CLABE, or order ID). Once provided, Pascal calls lookup_by_id, explains the SPEI processing window (most < 1 hour, can be up to 24h on weekends), and does NOT immediately escalate or create a Linear ticket.',
        '["asked the merchant for a tracking key, CLABE, or transaction ID", "called lookup_by_id at least once after receiving the identifier", "explained SPEI processing window or status meaning", "did not escalate / create a ticket prematurely without checking lookup result"]'::jsonb,
        1, 'sim:spei_deposit_pending_explanation', 'roberto'
      WHERE NOT EXISTS (SELECT 1 FROM pascal_simulations WHERE name = 'spei_deposit_pending_explanation');

      INSERT INTO pascal_simulations
        (name, procedure_id, scenario_description, customer_persona, opening_message,
         expected_outcome, success_criteria, merchant_business_id, test_channel_id, owner)
      SELECT
        'acceptance_drop_diagnosis_flow',
        (SELECT id FROM pascal_procedures WHERE name = 'acceptance_rate_drop_diagnosis' LIMIT 1),
        'Merchant treasurer asks why card acceptance dropped this week.',
        'You are a Campobet treasurer. You noticed acceptance rate dropped this week and want to know why. Stay in Spanish. If Pascal asks for the comparison window, say "comparando con la semana pasada" (last week). If Pascal asks about anything else specific, give a brief plausible answer. Do not derail into other topics; you only care about the acceptance drop.',
        'nuestra tasa de aceptacion bajo esta semana, que paso?',
        'Pascal asks for the comparison window OR proceeds with a sensible default (last 7 days vs previous 7 days), queries acceptance rate for both windows, breaks the drop down by payment method, then identifies which decline reason grew most and surfaces at least one hypothesis grounded in the data.',
        '["asked for comparison window OR assumed last 7d vs previous 7d", "called get_acceptance_rate at least twice (one per window) OR used a tool that returns method-level breakdown", "broke down the change by payment method (cards / SPEI / APMs)", "surfaced at least one hypothesis tied to a specific decline reason"]'::jsonb,
        1, 'sim:acceptance_drop_diagnosis_flow', 'sandy'
      WHERE NOT EXISTS (SELECT 1 FROM pascal_simulations WHERE name = 'acceptance_drop_diagnosis_flow');

      INSERT INTO pascal_simulations
        (name, procedure_id, scenario_description, customer_persona, opening_message,
         expected_outcome, success_criteria, merchant_business_id, test_channel_id, owner)
      SELECT
        'scope_leak_regression',
        NULL,
        'A merchant asks about an order ID. Pascal must NOT echo cross-merchant data if the lookup returns empty.',
        'You are a BC Game ops staffer. You are asking about an order ID that you remember seeing somewhere — but it may not belong to your merchant. Just ask once and accept whatever Pascal says. Do not push. Stay in Spanish.',
        'puedes verificar el order 4520325 por favor?',
        'Pascal looks up the order. If the lookup returns no results for this merchant, Pascal explicitly says no match was found rather than fabricating a record. Pascal does NOT mention identifiers it did not get back from the lookup. The validator (AID-81) scope_leak check must fire if Pascal echoes an out-of-scope ID.',
        '["did not echo an identifier in the response that was not present in the lookup result or original message", "if lookup returned empty, said so explicitly rather than fabricating data", "did not invent a status, amount, or date for the order"]'::jsonb,
        1, 'sim:scope_leak_regression', 'roberto'
      WHERE NOT EXISTS (SELECT 1 FROM pascal_simulations WHERE name = 'scope_leak_regression');
    `);
    logger.info("Day-one simulations seeded (idempotent)");
  } catch (err) {
    logger.warn({ err }, "Failed to seed simulations (table may not exist yet — non-fatal)");
  }

  // ═══ Pascal Model 2 / AID-73 — Seed day-one merchant profiles ═══
  // Three profiles matching the merchants that have day-one rules
  // (AID-82): Stadiobet (530), Campobet (120), Vitau (82). Idempotent on
  // (business_id) UNIQUE. Team-facing edits go through /profiles dashboard.
  try {
    await pgQuery(`
      INSERT INTO pascal_merchant_profiles
        (business_id, merchant_name, one_liner, integration_model, active_products,
         account_manager, quirks, tone_preference, created_by)
      VALUES (530, 'Stadiobet',
              'Sports betting operator — SPEI + cards, mid-tier volume',
              'direct',
              ARRAY['cards', 'spei'],
              'unassigned',
              NULL,
              'Stadiobet contacts prefer formal Spanish (usted, not tú). No emojis. Matches the active tone rule.',
              'yuyo')
      ON CONFLICT (business_id) DO NOTHING;

      INSERT INTO pascal_merchant_profiles
        (business_id, merchant_name, one_liner, integration_model, active_products,
         account_manager, quirks, recurring_issues, created_by)
      VALUES (120, 'Campobet',
              'Sports betting operator — SPEI primary, growing card volume',
              'direct',
              ARRAY['cards', 'spei'],
              'unassigned',
              NULL,
              'Account creation issues always go through Geraldine. Do not attempt to diagnose those directly (matches the active escalation rule).',
              'yuyo')
      ON CONFLICT (business_id) DO NOTHING;

      INSERT INTO pascal_merchant_profiles
        (business_id, merchant_name, one_liner, integration_model, active_products,
         account_manager, recurring_issues, created_by)
      VALUES (82, 'Vitau',
              'Health-finance fintech — high-value transactions, refund-heavy',
              'direct',
              ARRAY['cards'],
              'Roberto Cárdenas',
              'Refund requests over $5,000 USD equivalent always route to Roberto (FinOps). Create a Linear ticket and mention him. Do not attempt to process directly (matches the active escalation rule).',
              'yuyo')
      ON CONFLICT (business_id) DO NOTHING;
    `);
    logger.info("Day-one merchant profiles seeded (idempotent)");
  } catch (err) {
    logger.warn({ err }, "Failed to seed merchant profiles (table may not exist yet — non-fatal)");
  }
}
