"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Replay {
  id: number;
  original_conversation_id: string;
  started_at: string;
  finished_at: string | null;
  status: "pending" | "running" | "done" | "error";
  replayed_answer: string | null;
  replayed_latency_ms: number | null;
  error: string | null;
  triggered_by: string;
  // joined columns from pascal_conversation_log
  original_question: string | null;
  original_answer: string | null;
  original_merchant: string | null;
  original_platform: string | null;
  original_created_at: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  done: "t-badge-emerald",
  pending: "t-badge-gray",
  running: "t-badge-blue",
  error: "t-badge-red",
};

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function ReplaysIndexPage() {
  const [replays, setReplays] = useState<Replay[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchReplays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/replays?limit=50");
      const data = await res.json();
      setReplays(data.replays || []);
    } catch {
      setReplays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReplays();
  }, [fetchReplays]);

  const filtered = replays.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.original_merchant ?? "").toLowerCase().includes(q) ||
      (r.original_question ?? "").toLowerCase().includes(q) ||
      (r.replayed_answer ?? "").toLowerCase().includes(q) ||
      (r.triggered_by ?? "").toLowerCase().includes(q)
    );
  });

  const stats = {
    total: replays.length,
    done: replays.filter((r) => r.status === "done").length,
    errors: replays.filter((r) => r.status === "error").length,
    running: replays.filter((r) => r.status === "pending" || r.status === "running").length,
  };

  return (
    <>
      <PageHeader
        title="Replays"
        subtitle="Re-run past conversations against current Pascal · Fin-style test mode"
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total replays" value={stats.total} delay={1} />
        <KpiCard label="Successful" value={stats.done} delay={2} />
        <KpiCard
          label="Errors"
          value={stats.errors}
          delay={3}
          tone={stats.errors > 0 ? "danger" : "neutral"}
        />
        <KpiCard
          label="In flight"
          value={stats.running}
          delay={4}
          tone={stats.running > 0 ? "warn" : "neutral"}
        />
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search merchant, question text, or replay output…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input w-full !py-[7px]"
        />
      </div>

      {/* Helper hint */}
      {!loading && replays.length === 0 && (
        <div className="t-card text-center py-12">
          <h2 className="text-sm font-semibold text-gray-900">No replays yet</h2>
          <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
            Open any conversation in <Link href="/analytics" className="text-violet-600 hover:text-violet-700 underline underline-offset-2">/analytics</Link> and click <strong>Replay against current Pascal</strong> to re-run it through the latest version of Pascal. Use it to verify rule, procedure, or profile changes against real history.
          </p>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : replays.length === 0 ? null : filtered.length === 0 ? (
        <div className="t-card text-center py-12">
          <p className="text-xs text-gray-400">No replays match your search.</p>
        </div>
      ) : (
        <div className="t-card t-card-flush overflow-hidden fade-in d5">
          <div className="overflow-x-auto">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Original question</th>
                  <th>Status</th>
                  <th>Triggered by</th>
                  <th>Latency</th>
                  <th>Replayed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/replays/${r.id}`}
                        className="text-gray-900 hover:text-violet-600 font-medium"
                      >
                        {r.original_merchant ?? <span className="text-gray-300">unknown</span>}
                      </Link>
                      {r.original_platform && (
                        <p className="text-[11px] text-gray-400 mt-0.5 uppercase">
                          {r.original_platform}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[400px]">
                      <p className="text-gray-700 truncate">
                        {r.original_question ?? <span className="text-gray-300">no question captured</span>}
                      </p>
                      {r.original_created_at && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          originally {timeAgo(r.original_created_at)}
                        </p>
                      )}
                    </td>
                    <td>
                      <span className={`t-badge ${STATUS_BADGE[r.status] ?? "t-badge-gray"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="text-[12px] text-gray-500">{r.triggered_by}</td>
                    <td className="text-gray-500 text-[13px]">
                      {r.replayed_latency_ms != null
                        ? `${(r.replayed_latency_ms / 1000).toFixed(1)}s`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="text-gray-500 text-[13px]">{timeAgo(r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── KpiCard (lightweight, mirrors the shared component) ──────────── */

function KpiCard({
  label,
  value,
  delay,
  tone,
}: {
  label: string;
  value: number | string;
  delay: number;
  tone?: "danger" | "warn" | "neutral";
}) {
  const valueClass =
    tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-gray-900";
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`text-[var(--text-metric)] font-semibold leading-tight mt-1 ${valueClass}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
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
