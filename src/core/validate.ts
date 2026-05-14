/**
 * Pascal Model 2 / AID-81 — Pre-send validation (Phase 5)
 *
 * The safety net. Runs AFTER the Sonnet tool loop produces a draft response
 * and BEFORE the response goes to the merchant. Catches three failure modes:
 *
 *   1. Scope leak — Pascal's draft references an ID that doesn't belong to
 *      this channel's merchant set. Hard block (replace draft + log critical)
 *      because a leak between merchants is never acceptable.
 *
 *   2. Fabricated numbers — Pascal's draft contains specific numeric values
 *      (amounts, decimal rates, transaction counts) that don't trace back to
 *      any tool output in this conversation. Soft warning for v1 (log only,
 *      don't modify the draft) so we can monitor false-positive rate before
 *      adding active regeneration.
 *
 *   3. Hard rule output constraints — for any active `behavioral` + `hard`
 *      rule that carries an output-shaped predicate (e.g. `{ "type":
 *      "no_quote_fees" }`), evaluate against the draft. Today no output
 *      predicates exist; this is the framework for future expansion.
 *
 * The validator NEVER fails the message. Any error in validateResponse
 * (Haiku timeout, regex catastrophe, etc.) returns `{ ok: true, violations:
 * [] }` so the merchant still gets their response — validation is a guard,
 * not a gate.
 *
 * Spec: PASCAL_MODEL_2.md §3 Phase 5 / §6 Milestone 5 AID-81.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { BusinessRule } from "./rules";
import { logger } from "../utils/logger";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 20_000 });

export type ViolationType = "scope_leak" | "fabricated_number" | "rule_constraint";
export type ViolationSeverity = "warning" | "critical";

export interface Violation {
  type: ViolationType;
  severity: ViolationSeverity;
  /** Short human-readable summary, logged to self-QA events. */
  details: string;
  /** When type === 'rule_constraint', the rule id that triggered. */
  ruleId?: number;
}

export interface ValidationInput {
  draft: string;
  toolOutputs: string[];
  /** The original merchant message — IDs they typed are always "in scope". */
  originalMessage: string;
  /** business_ids the channel is mapped to. Used by scope_leak detection. */
  businessIds: number[];
  /** Active rules for this channel/merchant — used for rule-constraint check. */
  activeRules: BusinessRule[];
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  /** When true, orchestrator should REPLACE the draft with a safe fallback. */
  blocked: boolean;
}

/* ─── ID extraction ───────────────────────────────────────────────────── */

// What "looks like an ID" in a draft: long numeric strings (8+ digits) and
// UUIDs. Short numbers (1-7 digits) are not assumed to be IDs — too many
// false positives (amounts, counts, percentages).
const ID_PATTERNS = [
  /\b\d{8,}\b/g,                                                    // long numeric IDs (BC Game order refs, payment_ids, etc.)
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // UUIDs
];

function extractIds(text: string): string[] {
  const ids = new Set<string>();
  for (const pat of ID_PATTERNS) {
    const matches = text.match(pat);
    if (matches) matches.forEach((m) => ids.add(m));
  }
  return [...ids];
}

/* ─── Main entry ──────────────────────────────────────────────────────── */

export async function validateResponse(input: ValidationInput): Promise<ValidationResult> {
  const violations: Violation[] = [];

  // 1. Scope leak — synchronous, regex + set membership. Fast, deterministic.
  try {
    const scopeViolation = checkScope(input);
    if (scopeViolation) violations.push(scopeViolation);
  } catch (err) {
    logger.warn({ err }, "validateResponse: scope check threw");
  }

  // 2. Fabricated numbers — async Haiku call. Only run when the draft has
  //    something worth checking (specific numbers AND at least one tool was
  //    called to produce them). Skip otherwise to save cost + latency.
  try {
    if (shouldRunNumberTracing(input)) {
      const fabricated = await checkFabricatedNumbers(input);
      if (fabricated) violations.push(fabricated);
    }
  } catch (err) {
    logger.warn({ err }, "validateResponse: number tracing threw");
  }

  // 3. Hard rule output constraints — framework for future predicate types.
  try {
    const ruleViolations = checkRuleConstraints(input);
    violations.push(...ruleViolations);
  } catch (err) {
    logger.warn({ err }, "validateResponse: rule constraint check threw");
  }

  // Block ONLY on critical violations. Warnings are logged but the draft is
  // still sent — gives us time to verify the validator's accuracy before
  // tightening the noose.
  const blocked = violations.some((v) => v.severity === "critical");

  return { ok: violations.length === 0, violations, blocked };
}

/* ─── 1. Scope leak ───────────────────────────────────────────────────── */

function checkScope(input: ValidationInput): Violation | null {
  const draftIds = extractIds(input.draft);
  if (draftIds.length === 0) return null;

  // "Safe" IDs are those that appeared in:
  //   - the original merchant question (they asked about it explicitly)
  //   - any tool output (Pascal got it back from a query, in-scope by construction)
  const safeText = [input.originalMessage, ...input.toolOutputs].join("\n");
  const safeIds = new Set(extractIds(safeText));

  const leaks = draftIds.filter((id) => !safeIds.has(id));
  if (leaks.length === 0) return null;

  return {
    type: "scope_leak",
    severity: "critical",
    details: `${leaks.length} ID${leaks.length > 1 ? "s" : ""} in draft did not appear in tool outputs or original question: ${leaks.slice(0, 3).join(", ")}${leaks.length > 3 ? ` (+${leaks.length - 3} more)` : ""}`,
  };
}

/* ─── 2. Fabricated numbers ───────────────────────────────────────────── */

/**
 * Skip the Haiku call when there's nothing to verify:
 *   - Draft has no specific numbers (decimals, percentages, multi-digit
 *     numbers other than years/short counts)
 *   - No tools were called — but if no tools ran, the draft shouldn't have
 *     specific numerical claims either; let it through.
 *   - Draft is very short (< 80 chars — likely a "yes/no/checking" reply)
 */
function shouldRunNumberTracing(input: ValidationInput): boolean {
  if (input.draft.length < 80) return false;
  if (input.toolOutputs.length === 0) return false;
  // Look for "specific" numbers: decimals, percentages, amounts, large counts.
  const specificNumber = /\b\d+\.\d+|\b\d{4,}|\b\d{1,3}(?:,\d{3})+\b/;
  return specificNumber.test(input.draft);
}

async function checkFabricatedNumbers(input: ValidationInput): Promise<Violation | null> {
  const prompt = `You are Pascal's response auditor. You check that the assistant did not hallucinate specific numbers in its response.

Below is Pascal's draft response and the raw JSON outputs of every tool call made in this conversation.

Your job: identify SPECIFIC NUMBERS in the draft (amounts, transaction counts, percentages, decimals, large IDs) that do NOT appear in the tool outputs. Ignore:
  • short whole numbers used as filler (1, 2, 3, 5, 10)
  • years (2024, 2025, 2026)
  • obvious generic ranges ("3-5 days", "24 hours", "10-20%")
  • numbers from the original merchant question
  • numbers used in policy language ("up to 30 days", "minimum $1")

Respond with ONLY a JSON object:
{
  "fabricated": ["<exact substring of suspicious number>", ...],
  "reason": "<short explanation>"
}

If everything looks fine, return: { "fabricated": [], "reason": "all numbers trace to tool outputs" }

Original merchant question: "${input.originalMessage.slice(0, 400)}"

Pascal's draft:
"""
${input.draft.slice(0, 4000)}
"""

Tool outputs (JSON, one per call):
${input.toolOutputs.map((o, i) => `[${i + 1}]\n${o.slice(0, 1500)}`).join("\n\n")}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: { fabricated?: string[]; reason?: string };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!parsed.fabricated || parsed.fabricated.length === 0) return null;

  return {
    type: "fabricated_number",
    severity: "warning",
    details: `${parsed.fabricated.length} potentially fabricated number${parsed.fabricated.length > 1 ? "s" : ""}: ${parsed.fabricated.slice(0, 3).join(", ")}${parsed.fabricated.length > 3 ? ` (+${parsed.fabricated.length - 3} more)` : ""} — ${parsed.reason ?? ""}`.trim(),
  };
}

/* ─── 3. Rule output constraints ──────────────────────────────────────── */

/**
 * Framework for hard-rule output predicates. Today there are no output
 * predicate types defined — `require_mention` lives at the gate, not here.
 * When future rule types arrive (e.g. `no_quote_fees`, `no_hourly_volume`,
 * `no_external_links`), add a case below.
 *
 * Each predicate type is a deterministic check against the draft string,
 * no Haiku required.
 */
function checkRuleConstraints(input: ValidationInput): Violation[] {
  const violations: Violation[] = [];
  for (const rule of input.activeRules) {
    if (rule.priority !== "hard") continue;
    if (!rule.predicate) continue;
    const type = (rule.predicate as { type?: string }).type;
    if (!type) continue;

    switch (type) {
      case "require_mention":
        // Gate-only predicate, not an output constraint.
        break;

      // Future predicates land here, e.g.:
      // case "no_hourly_volume":
      //   if (/\bhour|hora\b/i.test(input.draft) && /\$|MXN|volume|volumen/i.test(input.draft)) {
      //     violations.push({ type: "rule_constraint", severity: "critical",
      //       details: `rule ${rule.id} forbids hourly volume in response`, ruleId: rule.id });
      //   }
      //   break;

      default:
        // Unknown predicate type — no-op. Logged once per rule load.
        break;
    }
  }
  return violations;
}

/* ─── Safe fallback when a critical violation blocks the draft ────────── */

export function safeFallbackResponse(violations: Violation[]): string {
  const types = [...new Set(violations.map((v) => v.type))];
  if (types.includes("scope_leak")) {
    return "I noticed something off with the data I was about to share. Let me re-verify with the underlying records and get back to you shortly.";
  }
  if (types.includes("rule_constraint")) {
    return "I can't share that here — let me route you to the right person on the team.";
  }
  return "Let me double-check that before I share it. I'll follow up in a moment.";
}
