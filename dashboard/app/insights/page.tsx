"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import KpiCard from "@/components/KpiCard";
import Sparkline from "@/components/Sparkline";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface RuleRow {
  id: number;
  rule_type: string;
  scope: string;
  scope_value: string | null;
  instruction: string;
  apply_count: number;
  last_applied_at: string | null;
  created_at?: string;
}

interface ProcedureRow {
  id: number;
  name: string;
  intent_label: string | null;
  dispatch_count: number;
  last_dispatched_at: string | null;
  owner?: string | null;
  created_at?: string;
}

interface KbRow {
  id: string;
  category: string;
  title: string;
  hit_count?: number;
  action?: string | null;
  created_at?: string;
}

interface ValidatorEventRow {
  id: string;
  merchant_name: string | null;
  channel_id: string;
  business_id: string | null;
  raw_input: string | null;
  created_at: string;
  message_type: string;
}

interface SimFailing {
  id: number;
  name: string;
  consecutive_failures: number;
  last_run_at: string | null;
  last_failure_reason: string | null;
  linear_ticket: string | null;
}

interface InsightsPayload {
  range: { days: number; from: string; to: string };
  hero: {
    messages_handled: { value: number; delta: number | "new" };
    sim_pass_rate: { value: number | null; prev_value: number | null; total_runs: number };
    validator_catches: { value: number; critical: number; warning: number; delta: number | "new" };
    open_gaps: { value: number; arrived_in_period: number; resolved_in_period: number; delta: number };
  };
  pipeline: {
    bare_id_fast_path: { value: number; percent: number };
    gate_blocks: { value: number; top_rule: { rule_id: number; instruction: string; n: number } | null; per_rule: Array<{ rule_id: number; instruction: string; n: number }> };
    procedure_dispatches: { active_in_window: number; top: ProcedureRow[] };
  };
  sim: {
    daily: Array<{ date: string; pass: number; fail: number; partial: number; error: number }>;
    currently_failing: SimFailing[];
  };
  validator: {
    scope_leaks: { count: number; recent: ValidatorEventRow[] };
    fabricated_numbers: { count: number; recent: ValidatorEventRow[] };
  };
  rules: { top: RuleRow[]; stale: RuleRow[] };
  procedures: { top: ProcedureRow[]; stale: ProcedureRow[] };
  knowledge: { top: KbRow[]; dead_weight: KbRow[]; by_category: Array<{ category: string; entries: number; total_hits: number; avg_hits: number }> };
}

/* ─── Page wrapper (Suspense for useSearchParams) ──────────────────── */

export default function InsightsPageWrapper() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <InsightsPage />
    </Suspense>
  );
}

function InsightsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const daysParam = parseInt(searchParams.get("days") ?? "7", 10);
  const days = [7, 30].includes(daysParam) ? daysParam : 7;

  const [data, setData] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?days=${days}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load insights");
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  function setDays(newDays: 7 | 30) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", String(newDays));
    router.push(`/insights?${params.toString()}`);
  }

  const rangeToggle = (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
      {([7, 30] as const).map((d) => (
        <button
          key={d}
          onClick={() => setDays(d)}
          className={`t-tab ${days === d ? "active" : ""}`}
        >
          {d}d
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="How Pascal is performing across every layer"
        right={rangeToggle}
      />

      {error && (
        <div className="t-card mb-4 !p-3" style={{ background: "#fef2f2", borderColor: "#fecaca" }}>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Hero KPIs */}
      <SectionHero data={data} loading={loading} days={days} />

      {/* Pipeline */}
      <SectionHeader title="Pipeline activity" subtitle={`Last ${days} days`} />
      <SectionPipeline data={data} loading={loading} />

      {/* Sim health */}
      <SectionHeader title="Sim health" subtitle="Regression suite — last 30 days" />
      <SectionSim data={data} loading={loading} />

      {/* Validator catches */}
      <SectionHeader title="Validator catches" subtitle="Pre-send safety net" />
      <SectionValidator data={data} loading={loading} />

      {/* Rules & procedures activity */}
      <SectionHeader title="Rules & procedures" subtitle="What's firing, what's gathering dust" />
      <SectionRulesProcedures data={data} loading={loading} />

      {/* Knowledge effectiveness */}
      <SectionHeader title="Knowledge effectiveness" subtitle="What the KB is actually doing for Pascal" />
      <SectionKnowledge data={data} loading={loading} />
    </>
  );
}

/* ─── Sub-sections ─────────────────────────────────────────────────── */

function SectionHero({ data, loading, days }: { data: InsightsPayload | null; loading: boolean; days: number }) {
  const h = data?.hero;
  const sim = h?.sim_pass_rate;
  const simDelta = (sim && sim.value !== null && sim.prev_value !== null)
    ? Math.round((sim.value - sim.prev_value) * 10) / 10
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <KpiCard
        label={`Messages handled · ${days}d`}
        value={loading ? null : h?.messages_handled.value ?? 0}
        delta={loading ? null : h?.messages_handled.delta ?? null}
        delay={1}
      />
      <KpiCard
        label={`Sim pass rate · ${days}d`}
        value={loading ? null : sim?.value === null ? "—" : `${sim?.value}%`}
        delta={loading ? null : simDelta}
        deltaUnit="pp"
        delay={2}
        right={
          h ? (
            <span className="text-xs text-gray-400">{h.sim_pass_rate.total_runs} runs</span>
          ) : null
        }
      />
      <KpiCard
        label={`Validator catches · ${days}d`}
        value={loading ? null : h?.validator_catches.value ?? 0}
        delta={loading ? null : h?.validator_catches.delta ?? null}
        deltaPositiveDirection="down"
        tone={h && h.validator_catches.critical > 0 ? "danger" : "neutral"}
        delay={3}
        valueSuffix={
          h && h.validator_catches.critical > 0 ? (
            <span className="text-xs text-red-600 font-medium">
              ({h.validator_catches.critical} critical)
            </span>
          ) : undefined
        }
      />
      <KpiCard
        label="Open gaps"
        value={loading ? null : h?.open_gaps.value ?? 0}
        delta={loading ? null : h?.open_gaps.delta ?? null}
        deltaPositiveDirection="down"
        delay={4}
        right={
          h ? (
            <span className="text-xs text-gray-400">
              {h.open_gaps.arrived_in_period} arrived · {h.open_gaps.resolved_in_period} resolved
            </span>
          ) : null
        }
      />
    </div>
  );
}

function SectionPipeline({ data, loading }: { data: InsightsPayload | null; loading: boolean }) {
  const p = data?.pipeline;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
      <KpiCard
        label="Bare-ID fast path"
        value={loading ? null : p?.bare_id_fast_path.value ?? 0}
        delay={1}
        valueSuffix={
          p ? (
            <span className="text-xs text-gray-400">({p.bare_id_fast_path.percent}%)</span>
          ) : undefined
        }
        right={
          <span className="text-xs text-gray-500">
            Skipped Sonnet round-trips
          </span>
        }
      />
      <KpiCard
        label="Gate blocks"
        value={loading ? null : p?.gate_blocks.value ?? 0}
        delay={2}
        right={
          p?.gate_blocks.top_rule ? (
            <span className="text-xs text-gray-500 truncate max-w-[200px]">
              top: {p.gate_blocks.top_rule.instruction.slice(0, 40)}…
            </span>
          ) : (
            <span className="text-xs text-gray-300">no blocks</span>
          )
        }
      />
      <KpiCard
        label="Procedures dispatched"
        value={loading ? null : p?.procedure_dispatches.active_in_window ?? 0}
        valueSuffix={p ? <span className="text-xs text-gray-400">active</span> : undefined}
        delay={3}
        right={
          p && p.procedure_dispatches.top.length > 0 ? (
            <div className="flex flex-wrap gap-1 justify-end">
              {p.procedure_dispatches.top.slice(0, 3).map((proc) => (
                <span key={proc.id} className="t-badge t-badge-violet text-[10px]">
                  {proc.intent_label ?? proc.name}·{proc.dispatch_count}
                </span>
              ))}
            </div>
          ) : null
        }
      />
    </div>
  );
}

function SectionSim({ data, loading }: { data: InsightsPayload | null; loading: boolean }) {
  if (loading) return <div className="t-card !p-4 mb-8 text-sm text-gray-400">Loading…</div>;
  if (!data) return null;

  const daily = data.sim.daily;
  const failing = data.sim.currently_failing;

  // Compute daily pass rate for sparkline
  const passRateSeries = daily.map((d) => {
    const total = d.pass + d.fail + d.partial + d.error;
    return total > 0 ? d.pass / total : 0;
  });

  const lastRate = passRateSeries.length > 0 ? passRateSeries[passRateSeries.length - 1] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
      {/* Sparkline card */}
      <div className="t-card fade-in d1">
        <p className="text-sm font-medium text-gray-500 mb-1">Pass rate · 30d trend</p>
        <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mb-2">
          {lastRate !== null ? `${Math.round(lastRate * 100)}%` : "—"}
        </p>
        {daily.length > 0 ? (
          <Sparkline
            data={passRateSeries.map((r) => r * 100)}
            width={300}
            height={48}
            color={lastRate !== null && lastRate < 0.8 ? "amber" : "emerald"}
          />
        ) : (
          <p className="text-xs text-gray-400">No sim runs in the last 30 days</p>
        )}
        <p className="text-[11px] text-gray-400 mt-2">
          {daily.length} day{daily.length === 1 ? "" : "s"} with runs · cron-triggered only
        </p>
      </div>

      {/* Failing sims card */}
      <div className="t-card t-card-flush overflow-hidden fade-in d2">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            Currently failing
            {failing.length > 0 && (
              <span className="ml-2 t-badge t-badge-red">{failing.length}</span>
            )}
          </h3>
          <Link href="/simulations?filter=fail" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
            All simulations →
          </Link>
        </div>
        {failing.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            All sims passing ✓
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {failing.map((s) => (
              <Link
                key={s.id}
                href={`/simulations`}
                className="block px-6 py-3 hover:bg-violet-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {s.last_failure_reason ?? "no judge summary"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="t-badge t-badge-red text-[10px]">
                      {s.consecutive_failures}× fail
                    </span>
                    {s.last_run_at && (
                      <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(s.last_run_at)}</p>
                    )}
                    {s.linear_ticket && (
                      <p className="text-[11px] text-violet-600 font-mono mt-0.5">
                        {s.linear_ticket}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionValidator({ data, loading }: { data: InsightsPayload | null; loading: boolean }) {
  if (loading) return <div className="t-card !p-4 mb-8 text-sm text-gray-400">Loading…</div>;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
      <ValidatorCard
        title="Scope leaks"
        tone="critical"
        count={data.validator.scope_leaks.count}
        recent={data.validator.scope_leaks.recent}
        emptyText="No scope leaks caught — Pascal didn't try to echo any out-of-scope IDs."
      />
      <ValidatorCard
        title="Fabricated numbers"
        tone="warning"
        count={data.validator.fabricated_numbers.count}
        recent={data.validator.fabricated_numbers.recent}
        emptyText="No fabricated numbers detected by Haiku audit."
      />
    </div>
  );
}

function ValidatorCard({
  title,
  tone,
  count,
  recent,
  emptyText,
}: {
  title: string;
  tone: "critical" | "warning";
  count: number;
  recent: ValidatorEventRow[];
  emptyText: string;
}) {
  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d1">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          {title}
          <span className={`ml-2 t-badge ${tone === "critical" ? "t-badge-red" : "t-badge-amber"}`}>
            {count}
          </span>
        </h3>
        <Link href="/monitoring" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          Monitoring →
        </Link>
      </div>
      {recent.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {recent.map((e) => (
            <div key={e.id} className="px-6 py-3">
              <div className="flex items-start justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {e.merchant_name ?? <span className="text-gray-300">unknown merchant</span>}
                </span>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(e.created_at)}</span>
              </div>
              <p className="text-xs text-gray-600 line-clamp-2">
                {e.raw_input ?? <span className="text-gray-300 italic">no input captured</span>}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionRulesProcedures({ data, loading }: { data: InsightsPayload | null; loading: boolean }) {
  if (loading) return <div className="t-card !p-4 mb-8 text-sm text-gray-400">Loading…</div>;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
      <RulesCard
        title="Top rules · by apply count"
        emptyText="No rule applications yet."
        rows={data.rules.top}
        showApply
      />
      <ProceduresCard
        title="Top procedures · by dispatch count"
        emptyText="No procedure dispatches yet."
        rows={data.procedures.top}
        showDispatch
      />
      <RulesCard
        title="Stale rules · 30d+ idle"
        emptyText="No stale rules — every active rule has fired recently."
        rows={data.rules.stale}
        showApply
        stale
      />
      <ProceduresCard
        title="Stale procedures · 30d+ idle"
        emptyText="No stale procedures."
        rows={data.procedures.stale}
        showDispatch
        stale
      />
    </div>
  );
}

function RulesCard({
  title,
  emptyText,
  rows,
  showApply,
  stale,
}: {
  title: string;
  emptyText: string;
  rows: RuleRow[];
  showApply: boolean;
  stale?: boolean;
}) {
  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d1">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <Link href="/rules" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          All rules →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <table className="t-table">
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.id}>
                <td className="!py-2">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`t-badge ${RULE_TYPE_BADGE[r.rule_type] ?? "t-badge-gray"} !text-[10px]`}>{r.rule_type}</span>
                    <span className="text-[10px] text-gray-400 uppercase">{r.scope}</span>
                    {r.scope_value && (
                      <code className="font-mono text-[10px] text-gray-500 truncate max-w-[120px]">{r.scope_value}</code>
                    )}
                  </div>
                  <p className="text-[13px] text-gray-700 line-clamp-1">{r.instruction}</p>
                </td>
                {showApply && (
                  <td className="num !py-2 align-top">
                    <p className={`text-sm font-semibold ${stale ? "text-gray-300" : "text-gray-900"}`}>
                      {r.apply_count.toLocaleString()}
                    </p>
                    {r.last_applied_at ? (
                      <p className="text-[10px] text-gray-400">{timeAgo(r.last_applied_at)}</p>
                    ) : (
                      <p className="text-[10px] text-gray-300">never</p>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProceduresCard({
  title,
  emptyText,
  rows,
  showDispatch,
  stale,
}: {
  title: string;
  emptyText: string;
  rows: ProcedureRow[];
  showDispatch: boolean;
  stale?: boolean;
}) {
  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d2">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <Link href="/procedures" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          All procedures →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <table className="t-table">
          <tbody>
            {rows.slice(0, 10).map((p) => (
              <tr key={p.id}>
                <td className="!py-2">
                  <p className="text-[13px] font-medium text-gray-900 font-mono truncate">{p.name}</p>
                  {p.intent_label && (
                    <span className="t-badge t-badge-violet !text-[10px]">{p.intent_label}</span>
                  )}
                </td>
                {showDispatch && (
                  <td className="num !py-2 align-top">
                    <p className={`text-sm font-semibold ${stale ? "text-gray-300" : "text-gray-900"}`}>
                      {p.dispatch_count.toLocaleString()}
                    </p>
                    {p.last_dispatched_at ? (
                      <p className="text-[10px] text-gray-400">{timeAgo(p.last_dispatched_at)}</p>
                    ) : (
                      <p className="text-[10px] text-gray-300">never</p>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SectionKnowledge({ data, loading }: { data: InsightsPayload | null; loading: boolean }) {
  if (loading) return <div className="t-card !p-4 mb-8 text-sm text-gray-400">Loading…</div>;
  if (!data) return null;

  const k = data.knowledge;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
      {/* Top hits */}
      <div className="t-card t-card-flush overflow-hidden fade-in d1">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Top KB entries · by hits</h3>
          <Link href="/memory" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
            Memory →
          </Link>
        </div>
        {k.top.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">No KB hits yet.</div>
        ) : (
          <table className="t-table">
            <tbody>
              {k.top.map((e) => (
                <tr key={e.id}>
                  <td className="!py-2">
                    <p className="text-[13px] font-medium text-gray-900 line-clamp-1">{e.title}</p>
                    <span className="t-badge t-badge-gray !text-[10px]">{e.category}</span>
                  </td>
                  <td className="num !py-2 align-top text-sm font-semibold text-gray-900">
                    {(e.hit_count ?? 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dead weight */}
      <div className="t-card t-card-flush overflow-hidden fade-in d2">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            Dead weight
            {k.dead_weight.length > 0 && (
              <span className="ml-2 t-badge t-badge-amber">{k.dead_weight.length}</span>
            )}
          </h3>
        </div>
        {k.dead_weight.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Every active KB entry has fired at least once. Nothing to prune.
          </div>
        ) : (
          <table className="t-table">
            <tbody>
              {k.dead_weight.map((e) => (
                <tr key={e.id}>
                  <td className="!py-2">
                    <p className="text-[13px] text-gray-700 line-clamp-1">{e.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="t-badge t-badge-gray !text-[10px]">{e.category}</span>
                      <span className="text-[10px] text-gray-400">
                        added {e.created_at ? timeAgo(e.created_at) : "?"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Coverage by category */}
      <div className="t-card t-card-flush overflow-hidden fade-in d3">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Coverage by category</h3>
        </div>
        {k.by_category.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">No KB entries.</div>
        ) : (
          <table className="t-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Entries</th>
                <th className="num">Hits</th>
                <th className="num">Avg</th>
              </tr>
            </thead>
            <tbody>
              {k.by_category.map((c) => (
                <tr key={c.category}>
                  <td className="!py-2">
                    <span className="t-badge t-badge-gray !text-[11px]">{c.category}</span>
                  </td>
                  <td className="num !py-2 text-sm text-gray-900">{c.entries}</td>
                  <td className="num !py-2 text-sm text-gray-900 font-medium">{c.total_hits}</td>
                  <td className="num !py-2 text-sm text-gray-500">{c.avg_hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 mt-2">
      <h2 className="text-[13px] font-semibold text-gray-900 uppercase tracking-wider">
        {title}
      </h2>
      <p className="text-xs text-gray-400">{subtitle}</p>
    </div>
  );
}

const RULE_TYPE_BADGE: Record<string, string> = {
  behavioral: "t-badge-violet",
  parsing: "t-badge-blue",
  escalation: "t-badge-amber",
  tone: "t-badge-gray",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
