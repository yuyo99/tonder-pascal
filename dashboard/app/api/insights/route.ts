import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * GET /api/insights?days=7
 *
 * Single aggregation endpoint powering /insights. Returns hero KPIs +
 * pipeline activity + sim health + validator catches + rules/procedures
 * activity + knowledge effectiveness — all server-aggregated.
 *
 * Query queries run in parallel via Promise.allSettled so a single slow
 * or failed query doesn't kill the entire response.
 *
 * days is clamped to 1–90.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days") ?? "7";
  const days = Math.max(1, Math.min(parseInt(daysParam, 10) || 7, 90));
  const prevWindow = `interval '${days * 2} days'`;
  const currWindow = `interval '${days} days'`;

  const queries = [
    // 0. Messages handled — current window
    query(
      `SELECT count(*)::int AS n
         FROM pascal_conversation_log
        WHERE created_at > now() - ${currWindow}
          AND channel_id NOT LIKE 'sim:%'`,
    ),
    // 1. Messages handled — previous window (for delta)
    query(
      `SELECT count(*)::int AS n
         FROM pascal_conversation_log
        WHERE created_at > now() - ${prevWindow}
          AND created_at <= now() - ${currWindow}
          AND channel_id NOT LIKE 'sim:%'`,
    ),
    // 2. Sim pass rate — current window (cron-triggered only)
    query(
      `SELECT
          count(*) FILTER (WHERE result = 'pass')::int AS pass,
          count(*)::int AS total
         FROM pascal_simulation_runs
        WHERE started_at > now() - ${currWindow}
          AND triggered_by = 'cron'`,
    ),
    // 3. Sim pass rate — previous window
    query(
      `SELECT
          count(*) FILTER (WHERE result = 'pass')::int AS pass,
          count(*)::int AS total
         FROM pascal_simulation_runs
        WHERE started_at > now() - ${prevWindow}
          AND started_at <= now() - ${currWindow}
          AND triggered_by = 'cron'`,
    ),
    // 4. Validator catches — current window (breakdown by severity)
    query(
      `SELECT
          count(*) FILTER (WHERE failure_reason ILIKE '%critical%')::int AS critical,
          count(*) FILTER (WHERE failure_reason ILIKE '%warning%' AND failure_reason NOT ILIKE '%critical%')::int AS warning,
          count(*)::int AS total
         FROM pascal_self_qa_events
        WHERE failure_reason ILIKE '%validation:%'
          AND created_at > now() - ${currWindow}`,
    ),
    // 5. Validator catches — previous window total (for delta)
    query(
      `SELECT count(*)::int AS n
         FROM pascal_self_qa_events
        WHERE failure_reason ILIKE '%validation:%'
          AND created_at > now() - ${prevWindow}
          AND created_at <= now() - ${currWindow}`,
    ),
    // 6. Open gaps (no time filter — current state)
    query(`SELECT count(*)::int AS n FROM pascal_knowledge_gaps WHERE status = 'pending'`),
    // 7. Open gaps approximated previous-period (current state minus arrivals in current window)
    //    Delta interpretation: gaps that have ARRIVED in this window minus those answered/dismissed.
    //    For simplicity: just show current count, and the delta from "what changed in window".
    query(
      `SELECT
          count(*) FILTER (WHERE detected_at > now() - ${currWindow})::int AS arrived,
          count(*) FILTER (WHERE updated_at > now() - ${currWindow} AND status IN ('answered','dismissed'))::int AS resolved
         FROM pascal_knowledge_gaps`,
    ),

    // 8. Bare-ID fast path — current window (uses JSONB containment)
    query(
      `SELECT
          count(*) FILTER (WHERE tool_calls @> '[{"input":{"fast_path":true}}]'::jsonb)::int AS fast,
          count(*)::int AS total
         FROM pascal_conversation_log
        WHERE created_at > now() - ${currWindow}
          AND channel_id NOT LIKE 'sim:%'`,
    ),
    // 9. Gate blocks — current window + top rule
    query(
      `SELECT ra.rule_id, r.instruction, count(*)::int AS n
         FROM pascal_rule_applications ra
         JOIN pascal_business_rules r ON r.id = ra.rule_id
        WHERE ra.phase = 'gate' AND ra.outcome = 'blocked'
          AND ra.applied_at > now() - ${currWindow}
        GROUP BY ra.rule_id, r.instruction
        ORDER BY n DESC`,
    ),
    // 10. Procedure dispatches — current window (use last_dispatched_at as proxy)
    //     We don't have a per-dispatch event log, so this is approximate.
    //     For accuracy, we'd need to count from a future pascal_procedure_dispatches table.
    query(
      `SELECT id, name, intent_label, dispatch_count, last_dispatched_at
         FROM pascal_procedures
        WHERE active = true
          AND last_dispatched_at IS NOT NULL
          AND last_dispatched_at > now() - ${currWindow}
        ORDER BY dispatch_count DESC
        LIMIT 10`,
    ),

    // 11. Sim health: daily pass-rate buckets (30d hardcoded — sparkline always shows 30d)
    query(
      `SELECT
          date_trunc('day', started_at AT TIME ZONE 'America/Mexico_City')::date AS date,
          count(*) FILTER (WHERE result = 'pass')::int AS pass,
          count(*) FILTER (WHERE result = 'fail')::int AS fail,
          count(*) FILTER (WHERE result = 'partial')::int AS partial,
          count(*) FILTER (WHERE result = 'error')::int AS error
         FROM pascal_simulation_runs
        WHERE started_at > now() - interval '30 days'
          AND triggered_by = 'cron'
        GROUP BY 1
        ORDER BY 1 ASC`,
    ),
    // 12. Currently failing sims
    query(
      `SELECT s.id, s.name, s.consecutive_failures, s.last_run_at, s.last_failure_reason,
              (SELECT linear_ticket FROM pascal_simulation_runs r WHERE r.simulation_id = s.id ORDER BY started_at DESC LIMIT 1) AS linear_ticket
         FROM pascal_simulations s
        WHERE s.active = true
          AND s.last_result IN ('fail', 'error')
        ORDER BY s.consecutive_failures DESC, s.last_run_at DESC
        LIMIT 10`,
    ),

    // 13. Scope leaks — recent in current window
    query(
      `SELECT id, merchant_name, channel_id, business_id, raw_input, created_at, message_type
         FROM pascal_self_qa_events
        WHERE failure_reason ILIKE '%scope_leak%'
          AND created_at > now() - ${currWindow}
        ORDER BY created_at DESC
        LIMIT 5`,
    ),
    // 14. Fabricated numbers — recent in current window
    query(
      `SELECT id, merchant_name, channel_id, business_id, raw_input, created_at, message_type
         FROM pascal_self_qa_events
        WHERE failure_reason ILIKE '%fabricated_number%'
          AND created_at > now() - ${currWindow}
        ORDER BY created_at DESC
        LIMIT 5`,
    ),

    // 15. Top rules by apply_count
    query(
      `SELECT id, rule_type, scope, scope_value, instruction, apply_count, last_applied_at
         FROM pascal_business_rules
        WHERE active = true
        ORDER BY apply_count DESC, created_at DESC
        LIMIT 10`,
    ),
    // 16. Stale rules — active, no apply in 30d, created >30d ago
    query(
      `SELECT id, rule_type, scope, scope_value, instruction, apply_count, last_applied_at, created_at
         FROM pascal_business_rules
        WHERE active = true
          AND (last_applied_at IS NULL OR last_applied_at < now() - interval '30 days')
          AND created_at < now() - interval '30 days'
        ORDER BY last_applied_at NULLS FIRST, created_at
        LIMIT 10`,
    ),

    // 17. Top procedures by dispatch_count
    query(
      `SELECT id, name, intent_label, dispatch_count, last_dispatched_at, owner
         FROM pascal_procedures
        WHERE active = true
        ORDER BY dispatch_count DESC, created_at DESC
        LIMIT 10`,
    ),
    // 18. Stale procedures
    query(
      `SELECT id, name, intent_label, dispatch_count, last_dispatched_at, created_at
         FROM pascal_procedures
        WHERE active = true
          AND (last_dispatched_at IS NULL OR last_dispatched_at < now() - interval '30 days')
          AND created_at < now() - interval '30 days'
        ORDER BY last_dispatched_at NULLS FIRST, created_at
        LIMIT 10`,
    ),

    // 19. Top KB entries by hits
    query(
      `SELECT id, category, title, hit_count, action
         FROM pascal_knowledge_base
        WHERE is_active = true
        ORDER BY hit_count DESC, created_at DESC
        LIMIT 10`,
    ),
    // 20. Dead-weight KB — active, zero hits, >30d old
    query(
      `SELECT id, category, title, created_at
         FROM pascal_knowledge_base
        WHERE is_active = true
          AND hit_count = 0
          AND created_at < now() - interval '30 days'
        ORDER BY created_at
        LIMIT 10`,
    ),
    // 21. KB coverage by category
    query(
      `SELECT category,
              count(*)::int AS entries,
              coalesce(sum(hit_count), 0)::int AS total_hits
         FROM pascal_knowledge_base
        WHERE is_active = true
        GROUP BY category
        ORDER BY total_hits DESC, entries DESC`,
    ),
  ];

  const results = await Promise.allSettled(queries);

  // Helper to safely extract rows from a settled query result.
  function rows<T = Record<string, unknown>>(idx: number): T[] {
    const r = results[idx];
    if (r.status !== "fulfilled") return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((r.value as any).rows ?? []) as T[];
  }
  function row<T = Record<string, unknown>>(idx: number): T | null {
    const arr = rows<T>(idx);
    return arr.length > 0 ? arr[0] : null;
  }

  function delta(curr: number, prev: number): number | "new" {
    if (prev === 0 && curr > 0) return "new";
    if (prev === 0) return 0;
    return curr - prev;
  }

  function pct(num: number, denom: number): number {
    return denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;
  }

  // Hero
  const msgsCurr = (row<{ n: number }>(0)?.n ?? 0);
  const msgsPrev = (row<{ n: number }>(1)?.n ?? 0);
  const simCurr = row<{ pass: number; total: number }>(2) ?? { pass: 0, total: 0 };
  const simPrev = row<{ pass: number; total: number }>(3) ?? { pass: 0, total: 0 };
  const validatorCurr = row<{ critical: number; warning: number; total: number }>(4) ?? { critical: 0, warning: 0, total: 0 };
  const validatorPrevN = row<{ n: number }>(5)?.n ?? 0;
  const openGaps = row<{ n: number }>(6)?.n ?? 0;
  const gapsInPeriod = row<{ arrived: number; resolved: number }>(7) ?? { arrived: 0, resolved: 0 };

  // Pipeline
  const fast = row<{ fast: number; total: number }>(8) ?? { fast: 0, total: 0 };
  const gateBlocks = rows<{ rule_id: number; instruction: string; n: number }>(9);
  const gateBlocksTotal = gateBlocks.reduce((sum, r) => sum + r.n, 0);
  const procDispatched = rows<{ id: number; name: string; intent_label: string | null; dispatch_count: number; last_dispatched_at: string | null }>(10);

  // Sim
  const simDaily = rows<{ date: string; pass: number; fail: number; partial: number; error: number }>(11);
  const simFailing = rows<{
    id: number;
    name: string;
    consecutive_failures: number;
    last_run_at: string | null;
    last_failure_reason: string | null;
    linear_ticket: string | null;
  }>(12);

  // Validator
  const scopeLeaks = rows(13);
  const fabricatedNumbers = rows(14);

  // Rules / procedures activity
  const topRules = rows(15);
  const staleRules = rows(16);
  const topProcedures = rows(17);
  const staleProcedures = rows(18);

  // Knowledge
  const topKb = rows(19);
  const deadKb = rows(20);
  const kbByCategory = rows<{ category: string; entries: number; total_hits: number }>(21).map((r) => ({
    ...r,
    avg_hits: r.entries > 0 ? Math.round((r.total_hits / r.entries) * 10) / 10 : 0,
  }));

  return NextResponse.json({
    range: {
      days,
      from: new Date(Date.now() - days * 86_400_000).toISOString(),
      to: new Date().toISOString(),
    },
    hero: {
      messages_handled: {
        value: msgsCurr,
        delta: delta(msgsCurr, msgsPrev),
      },
      sim_pass_rate: {
        value: simCurr.total > 0 ? Math.round((simCurr.pass / simCurr.total) * 1000) / 10 : null,
        prev_value: simPrev.total > 0 ? Math.round((simPrev.pass / simPrev.total) * 1000) / 10 : null,
        total_runs: simCurr.total,
      },
      validator_catches: {
        value: validatorCurr.total,
        critical: validatorCurr.critical,
        warning: validatorCurr.warning,
        delta: delta(validatorCurr.total, validatorPrevN),
      },
      open_gaps: {
        value: openGaps,
        arrived_in_period: gapsInPeriod.arrived,
        resolved_in_period: gapsInPeriod.resolved,
        delta: gapsInPeriod.arrived - gapsInPeriod.resolved,
      },
    },
    pipeline: {
      bare_id_fast_path: {
        value: fast.fast,
        percent: pct(fast.fast, fast.total),
      },
      gate_blocks: {
        value: gateBlocksTotal,
        top_rule: gateBlocks[0] ?? null,
        per_rule: gateBlocks.slice(0, 5),
      },
      procedure_dispatches: {
        // Approximate — uses sum of dispatch_count across procedures that
        // fired in the window. Real per-event count requires a future
        // pascal_procedure_dispatches table.
        active_in_window: procDispatched.length,
        top: procDispatched.slice(0, 5),
      },
    },
    sim: {
      daily: simDaily,
      currently_failing: simFailing,
    },
    validator: {
      scope_leaks: { count: validatorCurr.critical, recent: scopeLeaks },
      fabricated_numbers: { count: validatorCurr.warning, recent: fabricatedNumbers },
    },
    rules: { top: topRules, stale: staleRules },
    procedures: { top: topProcedures, stale: staleProcedures },
    knowledge: { top: topKb, dead_weight: deadKb, by_category: kbByCategory },
  });
}
