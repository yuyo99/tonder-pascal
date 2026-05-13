/**
 * Pascal Model 2 — Business Rules (Layer 3 of persistent memory).
 *
 * Three responsibilities:
 *   1. loadActiveRules(ctx)   — fetch rules in scope, ordered by precedence
 *   2. shouldRespond(ctx, msg) — Phase 0 Gate check (the canonical pipeline
 *      short-circuit; today evaluates {type:"require_mention"} predicates)
 *   3. logRuleApplication(...) — fire-and-forget audit log into
 *      pascal_rule_applications, with apply_count bump on the source rule
 *
 * Spec: PASCAL_MODEL_2.md §4 (Layer 3) and §3 (Phase 0).
 *
 * Scope precedence (most specific wins):
 *   channel > merchant > bot > global
 * Priority within a scope: hard > soft
 * Tiebreak: newer (created_at DESC) wins.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";

// ── Types ────────────────────────────────────────────────────────────────

export type RuleType = "behavioral" | "parsing" | "escalation" | "tone";
export type RuleScope = "global" | "merchant" | "channel" | "bot";
export type RulePriority = "hard" | "soft";
export type RulePhase = "gate" | "refine" | "generate" | "validate";
export type RuleOutcome = "applied" | "blocked" | "triggered_regen" | "no_effect";

export interface BusinessRule {
  id: number;
  rule_type: RuleType;
  scope: RuleScope;
  scope_value: string | null;
  instruction: string;
  predicate: Record<string, unknown> | null;
  priority: RulePriority;
  source: string;
  source_ref: string | null;
  confidence: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  last_applied_at: string | null;
  apply_count: number;
}

export interface RuleContext {
  businessId?: number;
  channelId: string;
  /** Set by adapters when the message originates from a known partner bot (e.g. "bcgame_ticket_bot"). */
  botId?: string;
}

export interface ParsedMessage {
  text: string;
  /**
   * Raw mention tokens extracted by the adapter (Slack: <@U0…> normalized;
   * Telegram: @username including the @). The shouldRespond() check is
   * case-insensitive and tolerant of either format.
   */
  mentions?: string[];
  /** True when the message is a reply to one of Pascal's prior messages. */
  isReplyToPascal?: boolean;
}

export interface GateResult {
  allow: boolean;
  blockedByRuleId?: number;
  reason?: string;
}

// ── Loader ───────────────────────────────────────────────────────────────

/**
 * Returns active rules whose scope matches the given context, sorted by
 * precedence so the first match in a given (rule_type) is the one that wins.
 *
 * Ordering: scope specificity (channel→merchant→bot→global)
 *           then priority (hard before soft)
 *           then recency (newer first)
 */
export async function loadActiveRules(ctx: RuleContext): Promise<BusinessRule[]> {
  const businessIdStr = ctx.businessId != null ? String(ctx.businessId) : null;

  // We pass each scope's value as a parameter, allowing NULLs through; the
  // CASE expression encodes specificity ordering for the SQL sort.
  const sql = `
    SELECT id, rule_type, scope, scope_value, instruction, predicate,
           priority, source, source_ref, confidence, active, created_by,
           created_at, last_applied_at, apply_count
      FROM pascal_business_rules
     WHERE active = true
       AND (
              (scope = 'global')
           OR (scope = 'channel'  AND scope_value = $1)
           OR (scope = 'merchant' AND scope_value = $2 AND $2 IS NOT NULL)
           OR (scope = 'bot'      AND scope_value = $3 AND $3 IS NOT NULL)
       )
     ORDER BY
       CASE scope
         WHEN 'channel'  THEN 1
         WHEN 'merchant' THEN 2
         WHEN 'bot'      THEN 3
         WHEN 'global'   THEN 4
       END,
       CASE priority WHEN 'hard' THEN 1 WHEN 'soft' THEN 2 END,
       created_at DESC
  `;

  try {
    const res = await pgQuery(sql, [ctx.channelId, businessIdStr, ctx.botId ?? null]);
    return res.rows as BusinessRule[];
  } catch (err) {
    // If the table doesn't exist yet (e.g. very first deploy before
    // ensureTables() finishes) or the DB is briefly unavailable, fail
    // open with an empty rule list — Pascal degrades to Model-1 behavior.
    logger.warn({ err }, "loadActiveRules: query failed, returning empty list");
    return [];
  }
}

// ── Phase 0 Gate ─────────────────────────────────────────────────────────

/**
 * Phase 0 — should this message reach the pipeline at all?
 *
 * Today implements a single predicate type:
 *   { "type": "require_mention", "tags": ["@pascal", "@Pascal"] }
 *
 * If a `behavioral` + `hard` rule scoped to this channel carries that
 * predicate and the message doesn't contain any of the required tags,
 * the gate blocks. Returns { allow: false, blockedByRuleId }.
 *
 * Additional predicate types ship with M5 (AID-77 / AID-81) and the
 * dispatch below should grow alongside them. For now: unknown predicate
 * types are ignored (fail open).
 */
export async function shouldRespond(
  ctx: RuleContext,
  msg: ParsedMessage,
  rules?: BusinessRule[],
): Promise<GateResult> {
  const activeRules = rules ?? (await loadActiveRules(ctx));

  // Only behavioral + hard rules can act as gates.
  const gateRules = activeRules.filter(
    (r) => r.rule_type === "behavioral" && r.priority === "hard" && r.predicate,
  );

  for (const rule of gateRules) {
    const predicate = rule.predicate as Record<string, unknown>;
    const type = predicate.type;

    if (type === "require_mention") {
      const required = Array.isArray(predicate.tags) ? (predicate.tags as string[]) : [];
      if (required.length === 0) continue;
      if (messageHasMention(msg, required)) continue; // satisfied — keep checking other rules
      // If reply-to-Pascal is set, the rule's natural-language form ("or
      // replies to a Pascal message") permits it through. Default predicate
      // also honors that.
      if (msg.isReplyToPascal) continue;
      return {
        allow: false,
        blockedByRuleId: rule.id,
        reason: `behavioral rule ${rule.id} requires mention of ${required.join("/")}`,
      };
    }

    // Unknown predicate types: log once and fail open. M5 will extend this.
    logger.debug(
      { ruleId: rule.id, predicateType: type },
      "shouldRespond: unknown predicate type — failing open",
    );
  }

  return { allow: true };
}

function messageHasMention(msg: ParsedMessage, required: string[]): boolean {
  const lowerText = (msg.text || "").toLowerCase();
  const lowerMentions = (msg.mentions || []).map((m) => m.toLowerCase());
  const lowerRequired = required.map((r) => r.toLowerCase());

  for (const tag of lowerRequired) {
    if (lowerText.includes(tag)) return true;
    if (lowerMentions.includes(tag)) return true;
    // Tolerate the @-stripped form in the mentions array too
    const bare = tag.startsWith("@") ? tag.slice(1) : tag;
    if (lowerMentions.includes(bare)) return true;
  }
  return false;
}

// ── Audit log ────────────────────────────────────────────────────────────

/**
 * Record a rule application. Fire-and-forget — never blocks the message
 * pipeline. Mirrors src/monitoring/self-qa.ts → recordSelfQA() pattern.
 * Also bumps apply_count + last_applied_at on the source rule.
 */
export function logRuleApplication(
  ruleId: number,
  conversationId: string,
  phase: RulePhase,
  outcome: RuleOutcome,
): void {
  // Intentionally not awaited.
  void (async () => {
    try {
      await pgQuery(
        `INSERT INTO pascal_rule_applications (rule_id, conversation_id, phase, outcome)
         VALUES ($1, $2, $3, $4)`,
        [ruleId, conversationId, phase, outcome],
      );
      await pgQuery(
        `UPDATE pascal_business_rules
            SET apply_count = apply_count + 1,
                last_applied_at = now()
          WHERE id = $1`,
        [ruleId],
      );
    } catch (err) {
      logger.warn({ err, ruleId, phase, outcome }, "logRuleApplication failed (non-fatal)");
    }
  })();
}
