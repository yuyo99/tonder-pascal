/**
 * Pascal Model 2 / AID-83 — Directive auto-extraction
 *
 * Nightly cron that mines pascal_conversation_log for team corrections
 * and proposes them as business rules (active=false) for human approval
 * in /training. This is the "Fin spots a pattern and asks you to confirm"
 * loop — closing the M4 milestone.
 *
 * Pipeline:
 *   1. SELECT candidate messages from the last 24h (or N-day backfill)
 *      where the speaker is a Tonder team member AND the text uses
 *      imperative language ("don't", "always", "from now on", etc.).
 *   2. For each candidate, dedupe against:
 *        a) already-proposed rules pointing to the same source_ref
 *        b) active rules with the same (rule_type, scope, scope_value)
 *           — the rule is already in effect, no point proposing it again.
 *   3. Call Haiku to classify the correction into:
 *        { rule_type, scope, scope_value, instruction, priority, confidence }
 *      or "none" if the message isn't actually a rule.
 *   4. INSERT into pascal_business_rules with active=false,
 *      source='auto:correction', source_ref=<conversation_id>.
 *
 * Cron: 30 1 * * * America/Mexico_City — runs at 1:30 AM, half an hour
 * before nightly-learn at 2:00 AM, so any rules extracted here are in
 * place before auto-learn promotes Q&A pairs.
 *
 * Spec: PASCAL_MODEL_2.md §6 Milestone 4 AID-83.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 20_000 });

/** Cap candidates per run so cost can't spike unexpectedly. */
const MAX_CANDIDATES_PER_RUN = parseInt(
  process.env.DIRECTIVE_EXTRACT_MAX_CANDIDATES ?? "200",
  10,
);

/** Imperative-language regex — broad-enough to catch corrections, tight
 *  enough to avoid false positives. Spanish + English. */
const IMPERATIVE_RE_PATTERN =
  "\\m(don'?t|do not|stop|always|never|remember|from now on|next time|no respondas|nunca|siempre|de ahora en|recuerda)\\M";

interface Candidate {
  conversation_id: string;
  channel_id: string;
  platform: string;
  merchant_name: string;
  business_ids: number[] | null;
  user_name: string;
  author_name: string;
  question: string;
  created_at: string;
}

interface Classification {
  rule_type: "behavioral" | "parsing" | "escalation" | "tone" | "none";
  scope?: "global" | "merchant" | "channel" | "bot";
  scope_value?: string | null;
  instruction?: string;
  priority?: "hard" | "soft";
  confidence?: number;
}

export interface DirectiveExtractOptions {
  /** Default 1 (last 24h). Set higher for a backfill run. */
  backfillDays?: number;
}

export async function runDirectiveExtract(
  opts: DirectiveExtractOptions = {},
): Promise<{
  candidates: number;
  classified: number;
  proposed: number;
  skipped_conflict: number;
  skipped_none: number;
}> {
  const days = Math.max(1, Math.min(opts.backfillDays ?? 1, 365));
  const startedAt = Date.now();

  logger.info({ days }, "directive-extract: starting");

  // ── 1. Pull candidates ────────────────────────────────────────────────
  let candidates: Candidate[];
  try {
    const result = await pgQuery(
      `
        SELECT
          cl.id::text       AS conversation_id,
          cl.channel_id,
          cl.platform,
          cl.merchant_name,
          mc.business_ids,
          cl.user_name,
          pp.name           AS author_name,
          cl.question,
          cl.created_at::text
        FROM pascal_conversation_log cl
        JOIN pascal_people pp
          ON pp.is_active = true
         AND pp.type = 'tonder_team'
         AND (
              (cl.platform = 'slack'    AND cl.user_name = pp.slack_user_id)
           OR (cl.platform = 'telegram' AND cl.user_name = pp.telegram_user_id)
           OR (cl.user_name = pp.name)
         )
        LEFT JOIN pascal_merchant_channels mc
          ON mc.platform = cl.platform AND mc.channel_id = cl.channel_id
        WHERE cl.created_at > now() - ($1 || ' days')::interval
          AND cl.question ~* $2
          AND NOT EXISTS (
            -- Skip conversations we've already proposed a rule for
            SELECT 1 FROM pascal_business_rules br
             WHERE br.source_ref = cl.id::text
          )
        ORDER BY cl.created_at DESC
        LIMIT $3
      `,
      [days, IMPERATIVE_RE_PATTERN, MAX_CANDIDATES_PER_RUN],
    );
    candidates = result.rows as Candidate[];
  } catch (err) {
    logger.error({ err }, "directive-extract: candidate query failed");
    storeErrorFromCatch("scheduler", err, { action: "directive-extract:query" });
    return { candidates: 0, classified: 0, proposed: 0, skipped_conflict: 0, skipped_none: 0 };
  }

  logger.info(
    { count: candidates.length },
    "directive-extract: candidates fetched",
  );

  // ── 2 + 3. Classify + dedupe + insert ─────────────────────────────────
  let classified = 0;
  let proposed = 0;
  let skipped_conflict = 0;
  let skipped_none = 0;

  for (const c of candidates) {
    let cls: Classification | null = null;
    try {
      cls = await classifyCorrection(c);
      classified++;
    } catch (err) {
      logger.warn({ err, convId: c.conversation_id }, "directive-extract: classify failed (skipping)");
      continue;
    }

    if (!cls || cls.rule_type === "none") {
      skipped_none++;
      continue;
    }

    const scope = cls.scope ?? "channel";
    let scopeValue: string | null = cls.scope_value ?? null;
    // For scope=channel, default to the channel the correction was made in.
    if (scope === "channel" && !scopeValue) scopeValue = c.channel_id;
    // For scope=merchant, default to the merchant's first business_id if missing.
    if (scope === "merchant" && !scopeValue && c.business_ids && c.business_ids.length > 0) {
      scopeValue = String(c.business_ids[0]);
    }
    if (scope === "global") scopeValue = null;

    if (scope !== "global" && !scopeValue) {
      logger.warn(
        { convId: c.conversation_id, scope },
        "directive-extract: missing scope_value, skipping",
      );
      skipped_none++;
      continue;
    }

    // Conflict check: skip if an active rule already exists with the same
    // (rule_type, scope, scope_value).
    const conflict = await pgQuery(
      `
        SELECT id FROM pascal_business_rules
         WHERE active = true
           AND rule_type = $1
           AND scope = $2
           AND (scope_value IS NOT DISTINCT FROM $3)
         LIMIT 1
      `,
      [cls.rule_type, scope, scopeValue],
    );
    if ((conflict.rowCount ?? 0) > 0) {
      skipped_conflict++;
      continue;
    }

    // Insert proposed rule
    try {
      await pgQuery(
        `
          INSERT INTO pascal_business_rules
            (rule_type, scope, scope_value, instruction, priority,
             source, source_ref, confidence, active, created_by)
          VALUES ($1, $2, $3, $4, $5, 'auto:correction', $6, $7, false, $8)
        `,
        [
          cls.rule_type,
          scope,
          scopeValue,
          (cls.instruction ?? c.question).trim(),
          cls.priority ?? "soft",
          c.conversation_id,
          cls.confidence ?? 0.5,
          c.author_name || c.user_name || null,
        ],
      );
      proposed++;
    } catch (err) {
      logger.warn(
        { err, convId: c.conversation_id },
        "directive-extract: insert failed (skipping)",
      );
    }
  }

  const elapsedMs = Date.now() - startedAt;
  logger.info(
    { candidates: candidates.length, classified, proposed, skipped_conflict, skipped_none, elapsedMs },
    "directive-extract: done",
  );

  return {
    candidates: candidates.length,
    classified,
    proposed,
    skipped_conflict,
    skipped_none,
  };
}

/**
 * Call Haiku to classify a correction. Returns null on parse failure.
 *
 * The model returns JSON only. We're tolerant of small format drift —
 * the response goes through a "find first JSON object" extractor before
 * JSON.parse.
 */
async function classifyCorrection(c: Candidate): Promise<Classification | null> {
  const prompt = buildClassifierPrompt(c);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // Extract first {...} JSON blob from the response, tolerant of code fences
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { rule_type: "none" };
  try {
    const parsed = JSON.parse(match[0]) as Classification;
    if (
      !parsed.rule_type ||
      !["behavioral", "parsing", "escalation", "tone", "none"].includes(parsed.rule_type)
    ) {
      return { rule_type: "none" };
    }
    return parsed;
  } catch {
    return { rule_type: "none" };
  }
}

function buildClassifierPrompt(c: Candidate): string {
  const businessLabel = c.merchant_name
    ? `${c.merchant_name}${c.business_ids?.length ? ` (business_ids: ${c.business_ids.join(",")})` : ""}`
    : "global";
  return `You are extracting a Pascal behavior rule from a Tonder team correction.

Pascal is an AI support agent for merchants on Tonder's payment platform.
The Tonder team can correct Pascal's behavior in any channel. Your job:
classify a single message into a structured rule so it can be approved
by a human and applied to all future Pascal responses.

Correction message: "${c.question.slice(0, 800)}"
From: ${c.author_name} (Tonder team)
Channel context: ${c.channel_id} (${c.platform}) — merchant: ${businessLabel}

Classify the correction. Respond with ONLY a JSON object (no prose, no
markdown fences). Schema:

{
  "rule_type": "behavioral" | "parsing" | "escalation" | "tone" | "none",
  "scope":     "global" | "merchant" | "channel" | "bot",
  "scope_value": "<business_id | channel_id | bot_id>" or null for global,
  "instruction": "<third-person directive Pascal should follow, 1-2 sentences>",
  "priority": "hard" | "soft",
  "confidence": 0.0 to 1.0
}

Use rule_type "none" if the message is NOT actually a behavior correction
(e.g. just a question, a thank-you, or off-topic chatter).

Rule type definitions:
  • behavioral — when/how Pascal responds (e.g. "don't reply unless tagged")
  • parsing — how to interpret merchant-specific message formats
  • escalation — when/how to route to a human (e.g. ">$5k refunds → Roberto")
  • tone — communication style overrides (e.g. "formal Spanish, no emojis")

Priority guidance:
  • hard — the correction uses absolute language ("never", "always", "do not", "must")
  • soft — the correction is a preference ("prefer", "usually", "please try to")

Scope guidance:
  • Default scope to "channel" with this channel_id if the user didn't specify
    a broader/narrower scope.
  • Use "merchant" + first business_id if the correction is clearly about a
    merchant's behavior regardless of channel.
  • Use "global" only if the correction explicitly applies everywhere.

Confidence: lower if the message is ambiguous or context-dependent.

Respond with JSON only.`;
}
