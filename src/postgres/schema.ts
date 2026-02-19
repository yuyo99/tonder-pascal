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
`;

export async function ensureTables(): Promise<void> {
  await pgQuery(DDL);
  logger.info("PostgreSQL tables ensured");
}
