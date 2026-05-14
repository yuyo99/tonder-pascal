/**
 * Pascal Model 2 / AID-79 — Procedures (Phase 4 dispatch)
 *
 * Multi-step playbooks Pascal injects into the system prompt when the
 * refined intent (from Phase 1) or the raw message text matches a
 * procedure's trigger. Think of them as Fin's "workflows" — a procedure
 * is a written instruction set the team controls via /procedures, and
 * Pascal dispatches one per message at most.
 *
 * Matching strategy (most-specific wins):
 *   1. Exact intent_label match against the refined intent
 *   2. Otherwise: trigger_pattern regex match against the canonical query
 *
 * The matched procedure's steps_markdown is injected into the system
 * prompt under `## Active Procedure`. Sonnet treats it as authoritative
 * for this single message.
 *
 * Spec: PASCAL_MODEL_2.md §3 Phase 4 / §6 Milestone 6 AID-79.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import type { RefineIntent } from "./refine";

export interface Procedure {
  id: number;
  name: string;
  trigger_pattern: string;
  intent_label: string | null;
  steps_markdown: string;
  tool_bindings: string[];
  required_inputs: string[];
  success_criteria: string | null;
  scope: "global" | "merchant" | "channel";
  scope_value: string | null;
  active: boolean;
  owner: string | null;
  version: number;
  dispatch_count: number;
  last_dispatched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcedureContext {
  businessId?: number;
  channelId: string;
}

/**
 * Returns active procedures whose scope matches the given context, ordered
 * by specificity (channel > merchant > global). Caller picks the first
 * match. Fails open with an empty list on any DB error.
 */
export async function loadActiveProcedures(ctx: ProcedureContext): Promise<Procedure[]> {
  const businessIdStr = ctx.businessId != null ? String(ctx.businessId) : null;
  try {
    const result = await pgQuery(
      `
        SELECT id, name, trigger_pattern, intent_label, steps_markdown,
               tool_bindings, required_inputs, success_criteria, scope,
               scope_value, active, owner, version, dispatch_count,
               last_dispatched_at, created_at, updated_at
          FROM pascal_procedures
         WHERE active = true
           AND (
                  (scope = 'global')
               OR (scope = 'channel'  AND scope_value = $1)
               OR (scope = 'merchant' AND scope_value = $2 AND $2 IS NOT NULL)
           )
         ORDER BY
           CASE scope
             WHEN 'channel'  THEN 1
             WHEN 'merchant' THEN 2
             WHEN 'global'   THEN 3
           END,
           created_at DESC
      `,
      [ctx.channelId, businessIdStr],
    );
    return result.rows as Procedure[];
  } catch (err) {
    logger.warn({ err }, "loadActiveProcedures: query failed, returning empty list");
    return [];
  }
}

/**
 * Pick the procedure that best matches a given intent + message text.
 *
 * 1. If `intent` is a known label and some procedure has the same
 *    `intent_label`, return that procedure.
 * 2. Otherwise, test each procedure's `trigger_pattern` (a Postgres-flavor
 *    regex stored as TEXT) against the message. We use JS RegExp here,
 *    so the pattern should be JS-compatible. Postgres `\m` / `\M`
 *    word-boundary anchors are translated to `\b` for JS.
 * 3. Returns the first hit (procedures are pre-sorted by specificity).
 */
export function matchProcedure(
  procedures: Procedure[],
  intent: RefineIntent | undefined,
  messageText: string,
): Procedure | null {
  if (procedures.length === 0) return null;

  // Map refine intents to procedure intent_labels we seed today
  const intentMap: Partial<Record<RefineIntent, string[]>> = {
    data_query: ["acceptance_diagnosis", "refund", "deposit_investigation"],
    integration_question: [],
    deposit_ticket: ["deposit_investigation"],
    escalation: ["refund"],
  };

  if (intent && intentMap[intent]?.length) {
    const candidates = intentMap[intent]!;
    for (const label of candidates) {
      const p = procedures.find((proc) => proc.intent_label === label);
      if (p && triggerMatches(p, messageText)) return p;
    }
  }

  // Fallback: trigger_pattern regex match
  for (const p of procedures) {
    if (triggerMatches(p, messageText)) return p;
  }
  return null;
}

function triggerMatches(proc: Procedure, text: string): boolean {
  if (!proc.trigger_pattern) return false;
  try {
    // Postgres `\m` / `\M` are word-boundary anchors; translate for JS.
    const jsPattern = proc.trigger_pattern.replace(/\\m|\\M/g, "\\b");
    const re = new RegExp(jsPattern, "i");
    return re.test(text);
  } catch {
    return false;
  }
}

/**
 * Render the procedure as a system-prompt section. Called by the
 * orchestrator after the procedure is matched.
 */
export function renderProcedureSection(proc: Procedure): string {
  return `\n\n## Active Procedure: ${proc.name}\n\nFollow this playbook for the merchant's current question. The steps are authoritative — prefer them over generic advice.\n\n${proc.steps_markdown}\n`;
}

/**
 * Fire-and-forget dispatch logging. Bumps dispatch_count + last_dispatched_at
 * so the /procedures page can show usage.
 */
export function logProcedureDispatch(procedureId: number): void {
  void (async () => {
    try {
      await pgQuery(
        `UPDATE pascal_procedures
            SET dispatch_count = dispatch_count + 1,
                last_dispatched_at = now()
          WHERE id = $1`,
        [procedureId],
      );
    } catch (err) {
      logger.warn({ err, procedureId }, "logProcedureDispatch failed (non-fatal)");
    }
  })();
}
