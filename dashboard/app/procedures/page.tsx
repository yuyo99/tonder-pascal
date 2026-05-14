"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Procedure {
  id: number;
  name: string;
  trigger_pattern: string;
  intent_label: string | null;
  steps_markdown: string;
  tool_bindings: string[] | null;
  required_inputs: string[] | null;
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

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function ProceduresPage() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("active");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchProcedures = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter === "active") params.set("active", "true");
    else if (filter === "inactive") params.set("active", "false");
    if (search) params.set("search", search);
    try {
      const res = await fetch(`/api/procedures?${params}`);
      const data = await res.json();
      setProcedures(data.procedures || []);
    } catch {
      setProcedures([]);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    fetchProcedures();
  }, [fetchProcedures]);

  async function handleToggle(id: number, currentActive: boolean) {
    await fetch(`/api/procedures/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !currentActive }),
    });
    fetchProcedures();
  }

  const stats = {
    total: procedures.length,
    active: procedures.filter((p) => p.active).length,
    dispatched: procedures.reduce((s, p) => s + p.dispatch_count, 0),
    intents: new Set(procedures.map((p) => p.intent_label).filter(Boolean)).size,
  };

  return (
    <>
      <PageHeader
        title="Procedures"
        subtitle="Multi-step playbooks Pascal dispatches when intent matches — the team's workflow library"
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total" value={stats.total} delay={1} />
        <KpiCard label="Active" value={stats.active} delay={2} />
        <KpiCard label="Intents covered" value={stats.intents} delay={3} />
        <KpiCard
          label="Times dispatched"
          value={stats.dispatched.toLocaleString()}
          delay={4}
        />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
          {(["active", "inactive", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`t-tab ${filter === f ? "active" : ""}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search name, intent, or steps…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input flex-1 min-w-[240px] !py-[7px]"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : procedures.length === 0 ? (
        <div className="t-card text-center py-12">
          <h2 className="text-sm font-semibold text-gray-900">
            No procedures match these filters
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Try changing the filter or clearing search. Day-one procedures
            seed automatically on Pascal boot — if nothing appears at all,
            the migration may not have run yet.
          </p>
        </div>
      ) : (
        <div className="t-card t-card-flush overflow-hidden fade-in d5">
          <div className="overflow-x-auto">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Intent</th>
                  <th>Trigger</th>
                  <th>Scope</th>
                  <th>Tools</th>
                  <th className="num">Dispatched</th>
                  <th>Last fired</th>
                  <th>Owner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {procedures.map((p) => (
                  <ProcedureRow
                    key={p.id}
                    procedure={p}
                    expanded={expandedId === p.id}
                    onToggleExpand={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    onToggleActive={() => handleToggle(p.id, p.active)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Procedure row + expand panel ─────────────────────────────────── */

function ProcedureRow({
  procedure,
  expanded,
  onToggleExpand,
  onToggleActive,
}: {
  procedure: Procedure;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleActive: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button
            onClick={onToggleExpand}
            className="text-gray-900 hover:text-violet-600 font-semibold text-sm font-mono"
          >
            {procedure.name}
          </button>
          <p className="text-[11px] text-gray-400 mt-0.5">v{procedure.version}</p>
        </td>
        <td>
          {procedure.intent_label ? (
            <span className="t-badge t-badge-violet">{procedure.intent_label}</span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
        <td className="max-w-[260px]">
          <code className="font-mono text-[11px] text-gray-500 truncate block">
            {procedure.trigger_pattern}
          </code>
        </td>
        <td>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-gray-500 uppercase tracking-wider">{procedure.scope}</span>
            {procedure.scope_value && (
              <code className="font-mono text-[11px] text-gray-600 truncate max-w-[140px]">
                {procedure.scope_value}
              </code>
            )}
          </div>
        </td>
        <td>
          {procedure.tool_bindings && procedure.tool_bindings.length > 0 ? (
            <div className="flex flex-wrap gap-1 max-w-[200px]">
              {procedure.tool_bindings.slice(0, 3).map((t) => (
                <span key={t} className="t-badge t-badge-gray text-[10px] !px-1.5">
                  {t}
                </span>
              ))}
              {procedure.tool_bindings.length > 3 && (
                <span className="text-[10px] text-gray-400">
                  +{procedure.tool_bindings.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
        <td className="num">
          <button
            onClick={onToggleExpand}
            className={
              procedure.dispatch_count > 0
                ? "text-violet-600 hover:text-violet-700 font-medium text-sm"
                : "text-gray-300"
            }
          >
            {procedure.dispatch_count.toLocaleString()}
            {procedure.dispatch_count > 0 ? " ↗" : ""}
          </button>
        </td>
        <td className="text-gray-500 text-[13px]">
          {procedure.last_dispatched_at ? timeAgo(procedure.last_dispatched_at) : <span className="text-gray-300">never</span>}
        </td>
        <td className="text-gray-500 text-[13px]">{procedure.owner ?? <span className="text-gray-300">—</span>}</td>
        <td>
          <button
            onClick={onToggleActive}
            className={`t-badge ${procedure.active ? "t-badge-emerald" : "t-badge-gray"} hover:opacity-80 cursor-pointer`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${procedure.active ? "bg-emerald-500" : "bg-gray-400"}`} />
            {procedure.active ? "active" : "inactive"}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={9} className="!p-0">
            <div className="bg-violet-50/40 border-t border-violet-100 px-6 py-5">
              {procedure.success_criteria && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1">
                    Success criteria
                  </p>
                  <p className="text-sm text-gray-700">{procedure.success_criteria}</p>
                </div>
              )}
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1">
                  Steps Pascal follows when matched
                </p>
                <div className="t-card !p-4 !bg-white">
                  <pre className="text-[13px] text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {procedure.steps_markdown}
                  </pre>
                </div>
              </div>
              {procedure.required_inputs && procedure.required_inputs.length > 0 && (
                <div className="mb-2">
                  <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1">
                    Required inputs
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {procedure.required_inputs.map((i) => (
                      <span key={i} className="t-badge t-badge-gray">{i}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Bits ──────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  delay,
}: {
  label: string;
  value: number | string;
  delay: number;
}) {
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">
        {value}
      </p>
    </div>
  );
}

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
