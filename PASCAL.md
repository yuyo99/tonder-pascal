# Pascal — Tonder's AI Payment Assistant

> *Last updated: 2026-06 — after PR3 course-correction (commit `7a72f6b`).*

Pascal is Tonder's merchant-facing AI assistant. Merchants ask Pascal about their payments — acceptance rates, declines, withdrawals, specific transactions — and Pascal answers in Slack, Telegram, and (eventually) embedded in `dashboard.tonder.io`. This repo is two products in one tree:

1. **Pascal-the-AI** (`src/`) — the orchestrator, channel adapters, tools, scheduler, and HTTP listener that *is* Pascal.
2. **Pascal Admin** (`dashboard/`) — Tonder's internal Next.js control plane for configuring Pascal per merchant (rules, knowledge, profiles, procedures, conversation log, monitoring).

The merchant-facing chat UI itself **does not live in this repo** — when Tonder's existing `dashboard.tonder.io` adds it, that's a separate Vue codebase that POSTs to Pascal's `/internal/web-chat` endpoint.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Pascal Model 2 — the 7-stage pipeline](#pascal-model-2--the-7-stage-pipeline)
3. [Channels](#channels)
4. [Merchant model](#merchant-model)
5. [Tool surface](#tool-surface)
6. [Safety model](#safety-model)
7. [Critical business rules](#critical-business-rules)
8. [Data layer](#data-layer)
9. [Environment variables](#environment-variables)
10. [Deployment](#deployment)
11. [Local development](#local-development)
12. [Notable design decisions](#notable-design-decisions)
13. [Recent history](#recent-history)

---

## Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│                          PASCAL-THE-AI                             │
│                          (this repo's src/)                        │
│                                                                    │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐    │
│  │  Slack   │   │ Telegram │   │ Web HTTP │   │  Scheduler   │    │
│  │ adapter  │   │ adapter  │   │ /internal│   │  (cron jobs) │    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬───────┘    │
│       │              │              │                │            │
│       └──────────────┴──────────────┘                │            │
│                      ▼                               │            │
│         ┌────────────────────────────┐               │            │
│         │   handleIncomingMessage    │◀──────────────┘            │
│         │   (Pascal Model 2 pipeline)│                            │
│         └────────────┬───────────────┘                            │
│                      │                                            │
│         ┌────────────┴────────────┐                               │
│         ▼            ▼            ▼                               │
│   ┌──────────┐ ┌──────────┐ ┌──────────────┐                      │
│   │ MongoDB  │ │ Postgres │ │ Anthropic    │                      │
│   │ (data)   │ │ (config) │ │ Claude API   │                      │
│   └──────────┘ └──────────┘ └──────────────┘                      │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Tonder reps read/write
                              │
┌────────────────────────────────────────────────────────────────────┐
│                         PASCAL ADMIN                               │
│                       (this repo's dashboard/)                     │
│                                                                    │
│  Next.js 15 · 16 admin routes · shared-password auth               │
│  Reads Postgres directly · MongoDB read-only · NO Anthropic        │
└────────────────────────────────────────────────────────────────────┘
```

### Stack — Pascal-the-AI (`src/`)

```
Language:       TypeScript 5.7 (strict)
Runtime:        Node.js 20 (via tsx in dev, tsc → dist in prod)
LLM:            Anthropic Claude — claude-sonnet-4-5-20250929 (synthesis)
                                   claude-haiku-4-5-20251001 (gate/refine/social/validate)
Channels:       @slack/bolt v4 (Socket Mode) + telegraf v4 (long polling)
HTTP:           Node native http (src/web-api.ts) — no Express/Fastify
Database:       MongoDB v6 driver (read-only data)
                Postgres v8 driver (Pascal config + logs)
Cron:           node-cron
Logger:         pino
Monitoring:     Sentry (errors) + Postgres pascal_health_heartbeats + self-QA events
PDF:            pdfkit (refund receipts)
Tickets:        @linear/sdk (escalation)
Embeddings:     OpenAI (KB semantic search)
```

### Stack — Pascal Admin (`dashboard/`)

```
Framework:      Next.js 15 (App Router)
Runtime:        Node.js 20
Auth:           Shared-password cookie (DASHBOARD_API_KEY)
Database:       Postgres (config, rules, KB, profiles, conversations)
                MongoDB (read-only for live data views)
Styling:        Tailwind 4
LLM:            None — admin never calls Claude (the orchestrator does)
```

---

## Pascal Model 2 — the 7-stage pipeline

Every incoming message flows through this pipeline in `src/core/orchestrator.ts` `handleIncomingMessage()`. Each stage is fail-closed: a violation surfaces as a typed error rather than degraded output.

| # | Stage | File | Purpose |
|---|---|---|---|
| 0 | **Gate** | `src/core/rules.ts` `shouldRespond()` + `src/core/triage.ts` | Evaluate active business rules. Block on hard rules (e.g. `require_mention`, blacklisted topic). Loads merchant profile in parallel. |
| 1 | **Refine** | `src/core/refine.ts` `refineQuery()` | Haiku preprocessor: classifies intent (data_query / integration / social / bare_id), expands shorthand, extracts IDs. Returns a `tool_plan` (AID-79b) suggesting the first tool to call. |
| 1b | **Short-circuits** | same file | If input is a bare ID → call `lookup_by_id` directly. If "hi/thanks/ok" → canned Haiku reply. Skip the Sonnet tool loop. |
| 2 | **Retrieve** | `src/knowledge/loader.ts` `findRelevantKnowledge()` | Semantic search over `pascal_knowledge_base` (OpenAI embeddings) + keyword fallback. Injected as `## Relevant Knowledge` in the prompt. |
| 3 | **Procedure** | `src/core/procedures.ts` `matchProcedure()` | Loads channel/merchant-scoped playbooks. Injected as `## Active Procedure` when one matches. |
| 4 | **Generate** | `src/core/orchestrator.ts` `runToolLoop()` | Sonnet tool loop. Up to `MAX_TOOL_ROUNDS = 10` rounds. Wall-clock budget `DEFAULT_TOOL_LOOP_BUDGET_MS = 120_000` (AID-84). Streams progress reactions/edits to Slack/Telegram. |
| 5 | **Validate** | `src/core/validate.ts` `validateResponse()` | Scope-leak check ("don't talk about other merchants"), fabricated-numbers detection, hard-rule output constraints. If violation → `safeFallbackResponse()`. |
| 6 | **Reply** | channel adapter `sendMessage()` | Apply `auditResponse()` from `provider-mask.ts` one last time. Send. Record interaction to `pascal_conversation_log`. Track via `trackInteraction()` (daily report). |

### System prompt structure (`src/core/prompts.ts`)

```
You are Pascal, a payment assistant for ${merchantCtx.businessName} powered by Tonder.
↓
## Today's Date
## Your Personality
## Merchant Context (name + profile via renderMerchantProfileSection)
## Active Rules (renderActiveRulesSection — [HARD] + [soft] tagged)
## CRITICAL RULES — NEVER VIOLATE
  Rule 1: Provider Name Masking
  Rule 2: Merchant Data & Knowledge Isolation
  Rule 3: Answering Questions — You Are an Integrations Engineer
  Rule 4: No Data Fabrication
  Rule 5: Universal ID Lookup
    + BC Game specific rule
    + BC Game Solicitud vs Order ID skew  ← AID-86 follow-up
    + Non-Tonder PSP detection (FINCO PAY, CONEKTA, OPENPAY…) ← AID-86 follow-up
  Rule 6: Merchant Shorthand
  Rule 7: Fee & Revenue Confidentiality
## Important Business Rules (refunds, etc.)
## Payment Method Categories (Cards / SPEI / Cash Vouchers / Oxxopay / MercadoPago)
## Date Range Parameters
## Formatting
## Refund Receipts
↓
## Tonder Team Directory (people directory)
## Relevant Knowledge (KB injection from Phase 2)
## Active Procedure (procedure injection from Phase 3)
## Query Plan (tool_plan injection from refine phase)
```

---

## Channels

| Channel | Adapter | Entry mode | Notes |
|---|---|---|---|
| **Slack** | `src/channels/slack/adapter.ts` | Socket Mode (no public webhook) | @mentions, DMs, threads, ambient mode (opt-in per channel via `AMBIENT_CHANNELS` env). Progress edits via 👀 reaction + 15s/45s/90s message edits (AID-84). |
| **Telegram** | `src/channels/telegram/adapter.ts` | Long polling (telegraf) | Direct messages, group chats with @mention, ambient mode. Supports `partnerBots[]` — specific bot usernames (e.g. `bcgame_ticket_bot`) auto-trigger Pascal without @mention. |
| **Web** | `src/web-api.ts` | Internal HTTP `POST /internal/web-chat` | Bearer-token (`PASCAL_INTERNAL_TOKEN`). Synthesizes a `web` IncomingMessage and calls the same pipeline. Used by Tonder's future merchant-facing dashboard chat. **Not yet wired to any UI.** |
| **WhatsApp** | (planned) | Twilio + WhatsApp Business API | In stack notes; not built. |

`IncomingMessage` shape (`src/channels/types.ts`):
```ts
{
  channelId: string;
  platform: "slack" | "telegram" | "whatsapp" | "web";
  userId: string; userName: string;
  text: string;
  threadId?: string;
  rawEvent: unknown;
  ambient?: boolean;           // not @mentioned, picked up by ambient mode
  threadContext?: string[];    // for ambient mode
  mentions?: string[];         // extracted mention tokens
  isReplyToPascal?: boolean;
  botId?: string;              // for partner bots (BCGAME ticket bot)
}
```

---

## Merchant model

### Channel → business_id mapping

Configured in **Postgres** (`pascal_merchant_channels` table), seeded from `src/merchants/mappings.ts`. Each channel binds to one or more `business_id`s (e.g. Stadiobet = [530, 533]). Loaded into an in-memory index, polled every 60s (`startConfigPolling`).

`MerchantContext` (the security boundary — `src/merchants/types.ts`):
```ts
{
  businessId: number;          // primary id
  businessIdStr: string;
  businessIds: number[];       // all ids on this channel
  businessIdStrs: string[];
  businessName: string;        // hydrated from MongoDB business_business
  platform: "slack" | "telegram" | "whatsapp" | "web";
  channelId: string;
}
```

### Resolution

- **Slack/Telegram:** `resolveMerchantContext(channelId, platform)` — lookup in the channel index. Returns null for unmapped channels.
- **Web:** `buildWebMerchantContext(business_id)` — hydrates from `businessNameCache` (10-min TTL refresh from MongoDB `business_business`). The orchestrator parses `channelId = "web:${business_id}"` and trusts it (the upstream caller — Tonder's dashboard — was responsible for auth).

### Currently mapped merchants (representative)

| business_id | Name | Channels |
|---|---|---|
| 86 | Tonder (internal) | Slack `C0AF237ATKJ` |
| 91 | BCGAME (legacy) | Telegram |
| 112 | Fun MX | Slack |
| 120 | Campobet | Slack |
| 121 | BCGAME | Telegram `-1002589749469` + partner bot `bcgame_ticket_bot` |
| 530, 533 | Stadiobet + Stadiobet VIP | Slack (multi-id channel) |
| — | Vitau | Slack |

Multi-business channels (Stadiobet) get a combined `businessName: "Stadiobet + Stadiobet VIP"`.

---

## Tool surface

Defined in `src/core/tools.ts` as an `Anthropic.Tool[]` array. Executed by `executeTool(name, input, merchantCtx)`. Every tool output flows through `sanitizeToolOutput()` (provider-name masking) before reaching Claude's context.

| Tool | Purpose | Notes |
|---|---|---|
| `query_transactions` | Unified filtered + grouped + aggregated transactions query | AID-85 — replaces 6 legacy tools (behind `PASCAL_UNIFIED_QUERY_ENABLED` flag). Filters: status, method, decline, date, amount, search. Groups: status, method, decline, day. Bounded by tenant predicate. |
| `get_acceptance_rate` | Count-based + volume-based rates split by Cards vs APMs | Cards-only formula `Success / (Success + Declined + Failed)`. APM formula `Success / (Success + Pending + Expired + Failed + Declined)`. Never blended. |
| `get_transaction_volume` | Total, success volume, count, avg ticket | |
| `get_top_declines` | Top-N decline reasons | |
| `get_transactions_by_status` | Breakdown by status | |
| `get_withdrawal_status` | Payout summary by status | Withdrawal amount is at `monetary_amount.amount` (Decimal128). |
| `lookup_by_id` | Universal ID search across transactions, withdrawals, SPEI deposits | **AID-86** — thin wrapper around `src/core/id-search.ts` `searchById()`. Handles BCGAME 19-digit IDs, prefixes (WD/TX/DEP), UUIDs, emails, ObjectIds. Returns structured diagnostics on miss. |
| `lookup_spei_deposits` | SPEI-specific search | by amount, status, reference, date range, clave_rastreo |
| `list_recent_transactions` | Recent txns with optional status filter | |
| `list_recent_withdrawals` | Recent withdrawals | |
| `generate_refund_receipt` | Generate PDF refund receipt | Stored in memory, returned as channel attachment. |
| `create_internal_ticket` | Silent escalation to Tonder team | Routes to Linear (SOS/INT/FINOPS teams). Merchant only sees "team will respond shortly" — never a ticket ID. |

### Unified ID search (AID-86)

`src/core/id-search.ts` is the single source of truth for any precise ID resolution. Fans out across **3 MongoDB collections in parallel** (`Promise.allSettled`):

| Collection | Fields searched | Adapter |
|---|---|---|
| `mv_payment_transactions` | `payment_customer_order_reference`, `metadata_order_id`, `transaction_reference`, `tracking_key`, `payment_id` (num+str), `order_id` (num+str), `customer_email` | `searchTransactionsAdapter` |
| `usrv-withdrawals-withdrawals` | `id` (UUID), `tracking_key`, `metadata.orderId`, `metadata.order_id`, `_id` (ObjectId) | `searchWithdrawalsAdapter` |
| `usrv-deposits-spei` | `deposit_id`, `checkout_id`, `reference`, `transaction_reference`, `provider_reference`, `metadata.orderId`, `payment_id`, `order_id`, `response.webhook.payload.details.clave_rastreo` | `searchSpeiAdapter` |

**Safe-integer boundary:** BCGAME's 19-digit IDs exceed `Number.MAX_SAFE_INTEGER`. `normalizeIdInput()` rejects them as numbers and searches them ONLY as strings against `payment_customer_order_reference` + `metadata_order_id`.

**Structured diagnostics on miss:** returns which collections + fields + variants + date range were tried, so Sonnet can produce actionable "I searched X across Y, did you mean Z?" responses instead of flat "not found."

**Training corpus:** `src/scripts/training-pascal-pdf.ts` — 10 real CS cases from `PASCAL.pdf` (PGW + BCGAME), 10/10 PASS against production MongoDB.

---

## Safety model

### Provider name masking (`src/core/provider-mask.ts`)

Internal acquirer names NEVER reach the merchant. Three-layer defense:

1. **Query-level grouping** — acq codes are merged into merchant-facing labels at the MongoDB query layer (not in post-processing).
2. **Tool output sanitizer** — `sanitizeToolOutput()` regex-replaces forbidden names before Claude sees the JSON.
3. **Final response audit** — `auditResponse()` checks the drafted reply for forbidden names. If found, re-sanitizes.

| Internal acq | Merchant-facing label |
|---|---|
| kushki, unlimit, guardian, tonder | **Cards** |
| bitso, stp | **SPEI** |
| oxxopay | **Oxxopay** |
| mercadopago | **MercadoPago** |
| safetypay | **Cash Vouchers** |

**FORBIDDEN_NAMES** that must never appear in any merchant-facing output: `kushki`, `unlimit`, `guardian`, `bitso`, `stp`, `safetypay`.

### Tenant isolation

- Every Mongo query gets a `business_id` predicate injected at the query-builder layer (same chokepoint as provider grouping).
- `MerchantContext.businessIds` is the security boundary — passed into every tool call.
- Rule 2 ("Merchant Data & Knowledge Isolation") in the system prompt forbids Pascal from discussing OR confirming the existence of any other merchant.

### Validation phase (`src/core/validate.ts`)

After Sonnet drafts the reply, validate against:
- **Scope leak** — does the reply mention any merchant name OTHER than `merchantCtx.businessName`?
- **Fabricated numbers** — does the reply contain numbers not present in any tool output?
- **Hard-rule constraints** — declarative rules from `pascal_business_rules` table can attach output assertions.

Violation → `safeFallbackResponse()` returns a non-fabricated apology instead of the offending draft.

### Non-Tonder PSP detection (`src/core/constants.ts`)

```ts
NON_TONDER_PROCESSORS = [
  "FINCO PAY", "FINCOPAY", "CONEKTA", "OPENPAY",
  "STRIPE", "CULQI", "BANWIRE", "PAYPAL", "MERCADO PAGO BR"
]
```

When a merchant pastes a comprobante naming one of these as the receiving processor, Pascal short-circuits BEFORE calling `lookup_by_id` and replies "this isn't Tonder, verify with the issuing PSP." (Source: PASCAL.pdf Caso 9.)

---

## Critical business rules

These are codified in the system prompt (`src/core/prompts.ts`) and validated at the validation phase. **Violating any of them is a release-blocker.**

### 1. NEVER blend Cards + APM acceptance rates

- **Cards = acceptance rate** (bank approves/declines). Formula `Success / (Success + Declined + Failed)`. Excludes `pending` (3DS in flight) and `expired` (3DS timeout). Constant: `CARDS_DENOMINATOR_STATUSES`.
- **SPEI / Oxxopay / Cash Vouchers / MercadoPago = conversion rate** (voucher-based: user creates reference, may not pay). Formula `Success / (Success + Pending + Expired + Failed + Declined)`. Constant: `RATE_STATUSES_LOWER`.
- The headline "Acceptance Rate" KPI = **Cards only** (acq ∈ kushki, unlimit, with guardian/tonder normalized in). SPEI conversion is reported alongside, never blended.
- Applies to merchant reports, executive reports, alerts, and Slack summaries.

### 2. ALWAYS deduplicate by `payment_id`

- One `payment_id` = one user deposit intent. Retries are NOT separate transactions.
- Dedup method: group by `payment_id`, sort by `created desc`, take first record.
- Raw attempt counts may be shown as a separate "retry analysis" metric, NEVER as the primary number.

### 3. Show both count-based AND volume-based rates when available.

### 4. Provider name masking (see Safety model above).

### 5. Rule 2 — Merchant Data & Knowledge Isolation
*"You exist EXCLUSIVELY for ${merchantCtx.businessName}. NEVER reveal, discuss, confirm, or deny the existence of any other merchant…"*

### 6. Rule 7 — Fee & Revenue Confidentiality
*"NEVER share fee configurations, revenue metrics, platform fees, IN/OUT fee rates, rolling reserve percentages, or settlement amounts with merchants."*

### 7. Refunds via SPEI = NOT supported. Card payments only.

### 8. BCGAME-specific: Solicitud ≠ Order ID

BCGAME tickets often contain a 19-digit "Solicitud" that is **internal to BCGAME** and DIFFERENT from the Order ID actually sent to Tonder as `payment_customer_order_reference`. Many tickets only show the Solicitud → searching for that ID returns NO results even when the deposit exists. Pascal's response template (from PASCAL.pdf training):

> "I couldn't find the order ID `<id>` in Tonder's records. For BCGAME tickets this often means one of three things: (1) it's a frictionless deposit where BCGAME reused a prior order (look for a CPO-prefixed reference), (2) the Solicitud ID differs from the Order ID BCGAME sent us (please share the actual Order ID from the player's BCGAME chat), or (3) the bank clave de rastreo / Tonder payment_id. Can you share any of those?"

### 9. BCGAME frictionless flow

Reuses a prior Tonder `order_id`. The deposit's `payment_customer_order_reference` becomes `CPO<number>` (e.g. `CPO162191875214`) and `metadata_order_id` becomes the previously-used Order ID. The user's NEW BCGAME ID is never persisted in Tonder.

### 10. FINCO PAY is NOT Tonder
When a comprobante names FINCO PAY, CONEKTA, OPENPAY, STRIPE, CULQI, BANWIRE, PAYPAL, MERCADO PAGO BR as receiver, the deposit was never ours. Short-circuit before searching.

### 11. MongoDB status mixed case
`status` field has mixed case ("Success" AND "SUCCESS") → always `$toLower` in queries.

### 12. Withdrawal field gotchas
- `monetary_amount.amount` is Decimal128 → `parseFloat(String(v))`.
- `business_id` is a **string** in withdrawals, **number** in transactions.
- `business_name` is NOT on the withdrawal doc — must join with `business_business`.

---

## Data layer

### MongoDB (read-only data; database `pdn`)

| Collection | Purpose |
|---|---|
| `mv_payment_transactions` | Materialized view: all deposits across all PSPs. Primary table for acceptance rates, declines, transaction lookups. |
| `usrv-deposits-spei` | SPEI deposit details. Linked to transactions by `payment_id`. Contains `response.webhook.payload.details.clave_rastreo`. |
| `usrv-withdrawals-withdrawals` | Payouts/withdrawals. `id` is a UUID. |
| `business_business` | Business name + metadata. Source for `businessNameCache`. |

### Postgres (Pascal's own config + logs)

| Table | Purpose |
|---|---|
| `pascal_merchant_channels` | Channel ID → business_id(s) mapping. Primary tenant configuration. |
| `pascal_partner_bots` | Per-merchant partner-bot whitelist (BCGAME ticket bot, etc.). |
| `pascal_scheduled_reports` | Cron-scheduled merchant reports. |
| `pascal_conversation_log` | Every interaction: question, answer, tool calls, latency, error. |
| `pascal_knowledge_base` | KB entries (Tonder docs + per-merchant). Vector embeddings via OpenAI. |
| `pascal_onboardings` | Merchant onboarding wizard state. |
| `pascal_error_logs` | Captured errors by source (orchestrator, channel, scheduler). |
| `pascal_people` | Tonder staff + merchant contacts directory. |
| `pascal_business_rules` | Hard/soft rules per merchant or channel. Loaded at Phase 0. |
| `pascal_rule_applications` | Audit log of which rule fired when. |
| `pascal_procedures` | Step-by-step playbooks Pascal can dispatch. |
| `pascal_simulations` + `pascal_simulation_runs` + `pascal_simulation_jobs` | Regression test suite. |
| `pascal_merchant_profiles` | Per-merchant context card (quirks, tone, account mgr, recurring issues). |
| `pascal_conversation_replays` + `pascal_replay_jobs` | Replay past conversations through current Pascal to detect drift. |
| `pascal_health_heartbeats` | Liveness pings for the dashboard's health view. |
| `pascal_self_qa_events` | Self-QA evaluation outcomes (passed/failed/skipped per stage). |
| `pascal_incidents` | Active incidents flagged by self-QA or human ops. |
| `pascal_synthetic_check_runs` | Periodic canary checks against the live orchestrator. |

---

## Environment variables

All env-var references found in `src/`. Required vs optional noted. **All secrets are managed in Railway** — never committed.

### Required — Pascal-the-AI service

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key. |
| `OPENAI_API_KEY` | Embeddings for KB semantic search. |
| `MONGODB_URI` | Mongo connection string (production cluster). |
| `DB_NAME` | Mongo database name (e.g. `pdn`). |
| `DATABASE_URL` (or `DATABASE_PUBLIC_URL`) | Postgres connection string. |
| `SLACK_BOT_TOKEN` | `xoxb-...` — bot user OAuth token. |
| `SLACK_SIGNING_SECRET` | Slack signing secret. |
| `SLACK_APP_TOKEN` | `xapp-...` — Socket Mode app token. |
| `SLACK_ENABLED` | `"true"` to boot the Slack adapter. |
| `TELEGRAM_BOT_TOKEN` | Telegraf bot token. |
| `TELEGRAM_ENABLED` | `"true"` to boot Telegram adapter. |
| `LINEAR_API_KEY` | Linear API key for `create_internal_ticket`. |
| `LINEAR_DEFAULT_ASSIGNEE` | Linear user ID for default ticket assignment. |

### Required — Pascal Admin (dashboard)

| Var | Purpose |
|---|---|
| `DASHBOARD_API_KEY` | Shared Tonder-team password. Same value validates login + signs session cookies. |
| `DATABASE_URL` (or `POSTGRES_URL`) | Same Postgres as the orchestrator. |
| `MONGODB_URI` + `DB_NAME` | Read-only Mongo access for live data views. |
| `ANTHROPIC_API_KEY` | Used by the `/chat` admin playground (raw Mongo query tool — internal-only). |

### Required for web channel (PR2 forward-compat — not yet active in production)

| Var | Purpose |
|---|---|
| `PASCAL_INTERNAL_TOKEN` | Bearer token for `POST /internal/web-chat`. Set on BOTH orchestrator + caller. |
| `PASCAL_WEB_API_PORT` | Orchestrator listen port. Defaults `8080`. |

### Optional / feature flags

| Var | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL` | `claude-sonnet-4-5-20250929` | Synthesis model override. |
| `NODE_ENV` | — | `production` enables secure cookies + lockdown behaviors. |
| `LOG_LEVEL` | `info` | pino log level. |
| `TZ` | `America/Mexico_City` | Server timezone. |
| `SENTRY_DSN` | — | Error reporting. |
| `COMPANY_DOMAIN` | `tonder.io` | Used in escalation routing. |
| `AMBIENT_ENABLED` | `false` | Enable ambient mode (Pascal responds without @mention in flagged channels). |
| `AMBIENT_CHANNELS` | — | Comma-separated channel IDs for ambient mode. |
| `CUSTOMER_INTEGRATIONS_SLACK_CHANNEL_ID` | — | Tonder-internal channel for ticket shortcuts. |
| `PASCAL_ALERTS_SLACK_CHANNEL_ID` | — | Where Pascal posts proactive alerts. |
| `PASCAL_HEARTBEAT_INTERVAL_MS` | 60000 | How often heartbeat writes. |
| `PASCAL_HEARTBEAT_STALE_MS` | 180000 | When the dashboard considers the heartbeat stale. |
| `PASCAL_SYNTHETIC_CHECKS_ENABLED` | `false` | Run canary checks against the live orchestrator. |
| `PASCAL_SYNTHETIC_CHECK_INTERVAL_MIN` | 30 | Canary cadence. |
| `PASCAL_UNIFIED_QUERY_ENABLED` | `false` | AID-85 feature flag — route data queries to `query_transactions` instead of the 6 legacy tools. |
| `DAILY_REPORT_SLACK_USER` | — | DM target for the daily report. |
| `DIRECTIVE_EXTRACT_MAX_CANDIDATES` | 5 | KB gap-detection candidate cap. |
| `SIM_MAX_PARALLEL` | 4 | Concurrent simulation jobs. |
| `SIM_MAX_TURNS_GLOBAL` | 20 | Simulation safety cap. |

---

## Deployment

**Platform: Railway.** Two services in one project (`glistening-luck`):

| Service | Source | Build | Start | Domain |
|---|---|---|---|---|
| `tonder-pascal` | `src/` (root tsconfig) | `npm run build` (tsc → dist) | `npm start` (`node dist/index.js`) | internal — no public ingress; Slack/Telegram talk to it over their respective transports |
| `pascal-dashboard` | `dashboard/` (separate Next.js project) | `npm run build` (Next.js) | `npm start` (Next.js prod) | public — admin login wall |

**Auto-deploy:** Push to `main` on `github.com/yuyo99/tonder-pascal` → both services rebuild + redeploy in parallel. Watch via:

```bash
gh api repos/yuyo99/tonder-pascal/commits/<sha>/status \
  | jq -r '"\(.state) — " + ([.statuses[] | "\(.context): \(.state)"] | join(", "))'
```

Wait pattern:
```bash
until gh api repos/yuyo99/tonder-pascal/commits/<sha>/status 2>/dev/null \
        | jq -e '.state == "success" or .state == "failure"' >/dev/null
do sleep 30; done
```

### Graceful shutdown caveat

`src/index.ts` registers SIGTERM/SIGINT handlers with a **15s delay** — Telegraf's `bot.launch()` installs its own handlers and triggers process exit when polling fails (409 Conflict during deploy). The delay lets Telegraf's failed launch die into the void.

---

## Local development

```bash
# Backend
cd /Users/yuyo/tonder-pascal
cp .env.example .env       # fill in keys
npm install
npm run dev                # tsx watch src/index.ts

# Dashboard (separate terminal)
cd dashboard
npm install
npm run dev                # next dev on port 3001

# Type-check both
npx tsc --noEmit           # backend
cd dashboard && npx tsc --noEmit
```

### Key scripts under `src/scripts/`

| Script | Purpose |
|---|---|
| `training-pascal-pdf.ts` | Run 10 ground-truth CS cases from PASCAL.pdf against `searchById` (id-search regression). Acceptance: 10/10 PASS. |
| `replay-query-transactions.ts` | Replay last 30 logged data-query conversations through the new unified `query_transactions` tool; side-by-side diff. |
| `backfill-embeddings.ts` | Regenerate KB embeddings (one-time / migration). |

---

## Notable design decisions

### Why two repos co-located, not separate?

Pascal-the-AI (`src/`) and Pascal Admin (`dashboard/`) ship together so:
- Schema migrations land in lockstep with code.
- Type definitions (`MerchantContext`, etc.) can be referenced from both eventually (currently the admin reads Postgres directly and doesn't import from `src/`).
- One repo = one deploy trigger = one rollback unit.

### Why a separate HTTP listener (`src/web-api.ts`) instead of importing `handleIncomingMessage` from the dashboard?

The dashboard's Next.js process and Pascal-the-AI's Node process are **separate Railway services**. The dashboard CAN'T import from `src/` at runtime — they're different deploys with different node_modules. So the dashboard either:
- Calls the orchestrator over HTTP (chosen — `web-api.ts`), or
- Re-implements the orchestrator inline (rejected — that's exactly the duplication we're avoiding)

Status: `web-api.ts` listens on `:8080` in production but currently has no caller. Wired up when Tonder's actual merchant dashboard adds the chat embed.

### Why is the dashboard reading Postgres directly instead of going through `src/`?

For internal admin views, the dashboard renders database content (rules, KB, profiles, conversation logs). Going through an API layer would be extra plumbing without security benefit (it's already gated by the shared-team password). The dashboard's read patterns are simple `SELECT … LIMIT 50` queries; no business logic.

### Why MongoDB for data, Postgres for config?

- **MongoDB** is the source of truth for transactions/withdrawals/SPEI — owned by Tonder's main payment platform. Pascal is a read-only consumer.
- **Postgres** is Pascal's own config + audit store. Owned by us. Easier to migrate, index, and reason about for the kinds of queries we do (joins, ordering, JSONB).

### Streaming on the `/api/chat` admin playground

The admin playground (`dashboard/app/api/chat/route.ts`) DOES stream via SSE (`text/event-stream`). It's used by Tonder ops to dev-test against MongoDB. The merchant-facing path (when it lands) uses simple request/response for now via `web-api.ts`; streaming can be added when the UX needs it.

### Token discipline (planned — `pascal-token-management.md`)

Wired in a future PR:
- **Bound tool results** at the query-builder layer — `query_transactions` returns aggregates + cursor when >50 rows, never raw rows.
- **Cache the safety prefix** above an Anthropic prompt-cache breakpoint.
- **Per-stage budgets** as typed failures (Haiku for gate/refine/validate, Sonnet for synthesis only).
- **Per-tenant + per-conversation token ledger** — abuse guardrail (matters most on Telegram where identity is weak).

---

## Recent history

Last 15 commits, what they shipped:

| Commit | Date | What |
|---|---|---|
| `7a72f6b` | 2026-06-22 | **Pivot PR3** — course-correct: restored 13 internal admin routes, dropped wrong-direction Concierge portal. Kept `src/web-api.ts` + "web" platform as forward-compat. |
| `8e0d1f0` | 2026-06-22 | Pivot PR2 — merchant-auth + real-orchestrator chat + activity feed. *(Superseded by PR3.)* |
| `6271402` | 2026-06-22 | Pivot PR1 — deleted 13 internal dashboard routes, sidebar → 3 entries. *(Superseded by PR3.)* |
| `2af5f88` | 2026-06-04 | AID-86 follow-up — PASCAL.pdf training corpus (10 CS cases) + BCGAME/FINCO PAY prompt guidance. |
| `d7ccb24` | 2026-06-04 | **AID-86** — unified ID search (`src/core/id-search.ts`) — single source of truth + structured diagnostics on miss. |
| `5b4f315` | 2026-05 | /chat v7 — pin greeting to TOP so input bar feels persistent. |
| `05f67fa` | 2026-05 | /chat v6 — Citadel-style visual rebuild (sparkles + greeting + clock). |
| `9a781ec` | 2026-05 | /chat v5 — `interactive-widget=resizes-content` + `min-h-0` + greeting pin. |
| `db6bac7` | 2026-05 | /chat v4 — ChatGPT-style + visualViewport fix for iOS keyboard. |
| `2acbd7e` | 2026-05 | AID-79b — don't inject `<Query Plan>` when `suggested_tool` is null. |
| `7c82094` | 2026-05 | **AID-79b** — extended `refineQuery` with tool-call planner + social short-circuit. |
| `6c81fd1` | 2026-05 | AID-85 fixes — Decimal128 amount coercion + drop hardcoded `transaction_type` filter. |
| `8939a79` | 2026-05 | **AID-85** — unified `query_transactions` tool (behind feature flag). |
| `309203e` | 2026-05 | **AID-84** — Slack + Telegram progress edits + 120s tool-loop budget. |
| `11186d4` | 2026-04 | iPhone PWA polish — safe areas, splash screens, no-zoom inputs. |

### Active design tickets (AID = Anthropic-Internal-Decision)

| ID | Title | Status |
|---|---|---|
| AID-84 | Slack/Telegram progress edits + tool-loop budget | Shipped |
| AID-85 | Unified `query_transactions` (replace 6 tools) | Shipped behind flag — 7-day soak then remove legacy tools |
| AID-79b | Haiku tool-call planner in refine | Shipped |
| AID-86 | Unified ID search + structured diagnostics | Shipped + training corpus |
| AID-73 | Merchant profile injection in system prompt | Shipped |
| AID-81 | Validation phase (scope leak, fabricated numbers) | Shipped |
| AID-82 | Phase 0 Gate (business rules) | Shipped |

---

## Glossary

| Term | Meaning |
|---|---|
| **acq** | Acquirer code in MongoDB — internal identifier for the PSP rail (kushki, unlimit, bitso, stp, …). Never exposed to merchants. |
| **business_id** | Numeric Tonder merchant identifier. Primary tenant key throughout Pascal. |
| **Guardian** | Tonder's anti-fraud system. `tonder` + `guardian` providers are treated as ONE single performance (they work together) when measuring card performance. |
| **Solicitud** | A BCGAME-internal ticket ID. May or may not match the `payment_customer_order_reference` Tonder stored. |
| **CPO reference** | BCGAME frictionless flow — `payment_customer_order_reference` formatted as `CPO<number>` when BCGAME reuses a prior Tonder `order_id`. |
| **clave de rastreo** | SPEI bank tracking code. Stored in MongoDB at `response.webhook.payload.details.clave_rastreo`. |
| **Pascal Model 2** | The 7-stage pipeline (Gate → Refine → Retrieve → Procedure → Generate → Validate → Reply) implemented in `src/core/orchestrator.ts`. |
| **Self-QA** | After-the-fact evaluation of Pascal's own responses, recorded to `pascal_self_qa_events`. Surfaces drift before merchants notice. |

---

*Sources of truth for this doc: source code under `/Users/yuyo/tonder-pascal/src/` and `/dashboard/`, the CLAUDE.md user instruction set, the project memory at `~/.claude/projects/-Users-yuyo/memory/MEMORY.md`, the PASCAL.pdf CS-cases training set, and the AID-86 / pivot PR commit history.*
