"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Simulation {
  id: number;
  name: string;
  procedure_id: number | null;
  procedure_name: string | null;
  scenario_description: string;
  customer_persona: string;
  opening_message: string;
  max_turns: number;
  expected_outcome: string;
  success_criteria: string[];
  test_channel_id: string;
  last_run_at: string | null;
  last_result: "pass" | "fail" | "partial" | "error" | null;
  last_failure_reason: string | null;
  consecutive_failures: number;
  active: boolean;
  owner: string | null;
}

interface SimulationRun {
  id: number;
  simulation_id: number;
  started_at: string;
  finished_at: string | null;
  result: "pass" | "fail" | "partial" | "error" | null;
  judge_summary: string | null;
  judge_criteria: { name: string; met: boolean; reason: string }[] | null;
  transcript: { role: "customer" | "pascal"; text: string; latencyMs?: number; error?: string }[];
  turns: number;
  latency_ms: number | null;
  error: string | null;
  linear_ticket: string | null;
  triggered_by: string;
}

const RESULT_BADGE: Record<string, string> = {
  pass: "t-badge-emerald",
  fail: "t-badge-red",
  partial: "t-badge-amber",
  error: "t-badge-gray",
};

const RESULT_LABEL: Record<string, string> = {
  pass: "✓ pass",
  fail: "✗ fail",
  partial: "◐ partial",
  error: "⚠ error",
};

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function SimulationsPage() {
  const [sims, setSims] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "fail" | "pass" | "partial" | "error">("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<Record<number, SimulationRun[]>>({});
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [transcriptModal, setTranscriptModal] = useState<SimulationRun | null>(null);

  const fetchSims = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("result", filter);
    if (search) params.set("search", search);
    try {
      const res = await fetch(`/api/simulations?${params}`);
      const data = await res.json();
      setSims(data.simulations || []);
    } catch {
      setSims([]);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { fetchSims(); }, [fetchSims]);

  async function fetchRuns(simId: number) {
    try {
      const res = await fetch(`/api/simulations/${simId}/runs?limit=10`);
      const data = await res.json();
      setRuns((prev) => ({ ...prev, [simId]: data.runs || [] }));
    } catch {
      setRuns((prev) => ({ ...prev, [simId]: [] }));
    }
  }

  async function handleToggle(id: number, currentActive: boolean) {
    await fetch(`/api/simulations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !currentActive }),
    });
    fetchSims();
  }

  async function handleRunNow(simId: number) {
    setRunningIds((prev) => new Set(prev).add(simId));
    try {
      const res = await fetch("/api/simulations/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulation_id: simId, triggered_by: "dashboard:run_now" }),
      });
      const job = await res.json();
      if (!job.jobId) {
        throw new Error(job.error || "Failed to enqueue job");
      }
      // Poll until done
      await pollJob(job.jobId);
      fetchSims();
      if (expandedId === simId) fetchRuns(simId);
    } catch (err) {
      console.error("Run now failed:", err);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(simId);
        return next;
      });
    }
  }

  async function pollJob(jobId: number, maxWaitMs = 180_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const res = await fetch(`/api/simulations/jobs?id=${jobId}`);
        const data = await res.json();
        if (data.status === "done" || data.status === "error") return;
      } catch {
        // ignore — keep polling
      }
    }
    throw new Error("job timed out waiting for completion");
  }

  function toggleExpand(simId: number) {
    if (expandedId === simId) {
      setExpandedId(null);
    } else {
      setExpandedId(simId);
      if (!runs[simId]) fetchRuns(simId);
    }
  }

  const stats = {
    total: sims.length,
    active: sims.filter((s) => s.active).length,
    failing: sims.filter((s) => s.last_result === "fail" || s.last_result === "error").length,
    lastRun: sims
      .map((s) => (s.last_run_at ? new Date(s.last_run_at).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0),
  };

  return (
    <>
      <PageHeader
        title="Simulations"
        subtitle="Pascal's regression suite — nightly at 3 AM Mexico City + on-demand"
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total simulations" value={stats.total} delay={1} />
        <KpiCard label="Active" value={stats.active} delay={2} />
        <KpiCard
          label="Currently failing"
          value={stats.failing}
          delay={3}
          tone={stats.failing > 0 ? "danger" : "neutral"}
        />
        <KpiCard
          label="Last suite run"
          value={stats.lastRun > 0 ? timeAgo(new Date(stats.lastRun).toISOString()) : "—"}
          delay={4}
        />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
          {(["all", "fail", "partial", "pass", "error"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`t-tab ${filter === f ? "active" : ""}`}
            >
              {f === "all" ? "All" : RESULT_LABEL[f]}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search name, scenario, or persona…"
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
      ) : sims.length === 0 ? (
        <div className="t-card text-center py-12">
          <h2 className="text-sm font-semibold text-gray-900">No simulations match these filters</h2>
          <p className="text-xs text-gray-400 mt-1">
            Day-one sims seed automatically on Pascal boot — if nothing appears at all, the migration may not have run yet.
          </p>
        </div>
      ) : (
        <div className="t-card t-card-flush overflow-hidden fade-in d5">
          <div className="overflow-x-auto">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Procedure</th>
                  <th>Last result</th>
                  <th className="num">Failures</th>
                  <th>Last run</th>
                  <th>Linear</th>
                  <th>Owner</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sims.map((s) => (
                  <SimRow
                    key={s.id}
                    sim={s}
                    expanded={expandedId === s.id}
                    runs={runs[s.id] || []}
                    running={runningIds.has(s.id)}
                    onToggleExpand={() => toggleExpand(s.id)}
                    onToggleActive={() => handleToggle(s.id, s.active)}
                    onRunNow={() => handleRunNow(s.id)}
                    onViewTranscript={(run) => setTranscriptModal(run)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transcript modal */}
      {transcriptModal && (
        <TranscriptModal run={transcriptModal} onClose={() => setTranscriptModal(null)} />
      )}
    </>
  );
}

/* ─── Sim row + expand ─────────────────────────────────────────────── */

function SimRow({
  sim,
  expanded,
  runs,
  running,
  onToggleExpand,
  onToggleActive,
  onRunNow,
  onViewTranscript,
}: {
  sim: Simulation;
  expanded: boolean;
  runs: SimulationRun[];
  running: boolean;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onRunNow: () => void;
  onViewTranscript: (run: SimulationRun) => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button
            onClick={onToggleExpand}
            className="text-left text-gray-900 hover:text-violet-600 font-medium text-sm"
          >
            {sim.name}
          </button>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[280px]">
            {sim.scenario_description}
          </p>
        </td>
        <td>
          {sim.procedure_id && sim.procedure_name ? (
            <Link
              href={`/procedures`}
              className="text-violet-600 hover:text-violet-700 text-xs font-medium font-mono"
            >
              {sim.procedure_name}
            </Link>
          ) : (
            <span className="text-gray-300 text-xs">free-form</span>
          )}
        </td>
        <td>
          {sim.last_result ? (
            <span className={`t-badge ${RESULT_BADGE[sim.last_result]}`}>
              {RESULT_LABEL[sim.last_result]}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">never run</span>
          )}
        </td>
        <td className="num">
          {sim.consecutive_failures > 0 ? (
            <span className="t-badge t-badge-red">{sim.consecutive_failures}×</span>
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </td>
        <td className="text-gray-500 text-[13px]">
          {sim.last_run_at ? timeAgo(sim.last_run_at) : <span className="text-gray-300">never</span>}
        </td>
        <td>
          {runs[0]?.linear_ticket ? (
            <a
              href={`https://linear.app/tonderio/issue/${runs[0].linear_ticket}`}
              target="_blank"
              rel="noreferrer"
              className="text-violet-600 hover:text-violet-700 text-xs font-medium font-mono"
            >
              {runs[0].linear_ticket}
            </a>
          ) : (
            <span className="text-gray-300 text-xs">—</span>
          )}
        </td>
        <td className="text-gray-500 text-[13px]">{sim.owner ?? <span className="text-gray-300">—</span>}</td>
        <td className="num">
          <div className="inline-flex items-center gap-1.5">
            <button
              onClick={onRunNow}
              disabled={running}
              className="text-xs px-3 py-1 bg-violet-600 text-white rounded-md hover:bg-violet-700 font-medium disabled:bg-violet-300 disabled:cursor-not-allowed"
            >
              {running ? "Running…" : "Run now"}
            </button>
            <button
              onClick={onToggleActive}
              className={`t-badge ${sim.active ? "t-badge-emerald" : "t-badge-gray"} hover:opacity-80 cursor-pointer`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${sim.active ? "bg-emerald-500" : "bg-gray-400"}`} />
              {sim.active ? "active" : "inactive"}
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} className="!p-0">
            <div className="bg-violet-50/40 border-t border-violet-100 px-6 py-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                <div>
                  <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1">
                    Expected outcome
                  </p>
                  <p className="text-sm text-gray-700">{sim.expected_outcome}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1">
                    Success criteria
                  </p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {sim.success_criteria.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-violet-400 shrink-0">{i + 1}.</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-2">
                  Recent runs ({runs.length})
                </p>
                {runs.length === 0 ? (
                  <p className="text-sm text-gray-400">No runs yet. Click "Run now" above.</p>
                ) : (
                  <div className="space-y-2">
                    {runs.map((r) => (
                      <div key={r.id} className="t-card !p-3 flex items-start gap-3">
                        <span className={`t-badge ${RESULT_BADGE[r.result ?? "error"]}`}>
                          {RESULT_LABEL[r.result ?? "error"]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-400">
                            {timeAgo(r.started_at)} · {r.triggered_by} · {r.turns} turn{r.turns === 1 ? "" : "s"}
                            {r.latency_ms ? ` · ${(r.latency_ms / 1000).toFixed(1)}s` : ""}
                          </p>
                          {r.judge_summary && (
                            <p className="text-sm text-gray-700 mt-1">{r.judge_summary}</p>
                          )}
                          {r.judge_criteria && r.judge_criteria.length > 0 && (
                            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                              {r.judge_criteria.map((c, i) => (
                                <div key={i} className="text-[12px] flex gap-1.5 items-start">
                                  <span className={c.met ? "text-emerald-600" : "text-red-600"}>
                                    {c.met ? "✓" : "✗"}
                                  </span>
                                  <span className="text-gray-700 line-clamp-1">{c.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onViewTranscript(r)}
                          className="text-xs text-violet-600 hover:text-violet-700 font-medium shrink-0"
                        >
                          Transcript →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Transcript modal ─────────────────────────────────────────────── */

function TranscriptModal({ run, onClose }: { run: SimulationRun; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        ref={ref}
        className="modal-box !w-[640px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Run #{run.id}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {timeAgo(run.started_at)} · {run.triggered_by} · {run.turns} turn{run.turns === 1 ? "" : "s"}
            </p>
          </div>
          <span className={`t-badge ${RESULT_BADGE[run.result ?? "error"]}`}>
            {RESULT_LABEL[run.result ?? "error"]}
          </span>
        </div>

        <div className="px-6 py-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {run.transcript.map((t, i) => (
            <div
              key={i}
              className={`flex gap-3 ${t.role === "customer" ? "" : "bg-violet-50/40 -mx-2 px-2 py-2 rounded-md"}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider w-20 shrink-0 mt-0.5">
                {t.role === "customer" ? (
                  <span className="text-gray-400">Customer</span>
                ) : (
                  <span className="text-violet-700">Pascal</span>
                )}
              </span>
              <div className="flex-1 text-sm text-gray-700 whitespace-pre-wrap">
                {t.text}
                {t.error && <span className="text-red-600 ml-2">[error: {t.error}]</span>}
                {t.latencyMs ? (
                  <span className="text-[10px] text-gray-400 ml-2">({t.latencyMs}ms)</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="filter-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Bits ──────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  delay,
  tone,
}: {
  label: string;
  value: number | string;
  delay: number;
  tone?: "danger" | "neutral";
}) {
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p
        className={`text-[var(--text-metric)] font-semibold leading-tight mt-1 ${
          tone === "danger" ? "text-red-700" : "text-gray-900"
        }`}
      >
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
