"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

interface ReplayDetail {
  id: number;
  original_conversation_id: string;
  started_at: string;
  finished_at: string | null;
  status: "pending" | "running" | "done" | "error";
  replayed_answer: string | null;
  replayed_latency_ms: number | null;
  replayed_rounds: number;
  error: string | null;
  triggered_by: string;
  // original conversation columns (joined)
  original_question: string | null;
  original_answer: string | null;
  original_tool_calls: { tool: string; input: Record<string, unknown> }[] | null;
  original_rounds: number | null;
  original_latency_ms: number | null;
  original_merchant: string | null;
  original_platform: string | null;
  original_channel_id: string | null;
  original_user_name: string | null;
  original_created_at: string | null;
}

export default function ReplayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<ReplayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/replays/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Network error"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <>
        <PageHeader title="Replay" subtitle="Loading…" />
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader title="Replay" subtitle="Not found" />
        <div className="t-card text-center py-12">
          <p className="text-sm text-gray-400">{error ?? "Replay not found"}</p>
          <Link href="/replays" className="text-violet-600 hover:text-violet-700 text-sm mt-3 inline-block">
            ← All replays
          </Link>
        </div>
      </>
    );
  }

  const sameAnswer =
    data.replayed_answer && data.original_answer && data.replayed_answer.trim() === data.original_answer.trim();

  return (
    <>
      <PageHeader
        title="Replay comparison"
        subtitle={`Replay #${data.id} · ${data.original_merchant ?? "unknown merchant"}`}
        right={
          <div className="flex items-center gap-2">
            <Link href="/replays" className="filter-btn">
              ← All replays
            </Link>
            <Link
              href={`/analytics/conversation/${data.original_conversation_id}`}
              className="filter-btn"
            >
              Original conversation →
            </Link>
          </div>
        }
      />

      {/* Status banner */}
      <div className="t-card mb-4 !p-3 flex items-center justify-between fade-in d1">
        <div className="flex items-center gap-3">
          <span
            className={`t-badge ${
              data.status === "done"
                ? "t-badge-emerald"
                : data.status === "error"
                  ? "t-badge-red"
                  : "t-badge-blue"
            }`}
          >
            {data.status}
          </span>
          {sameAnswer && (
            <span className="t-badge t-badge-gray">no change in response</span>
          )}
          {!sameAnswer && data.status === "done" && (
            <span className="t-badge t-badge-violet">response changed</span>
          )}
        </div>
        <p className="text-xs text-gray-400">
          Triggered by {data.triggered_by} · {timeAgo(data.started_at)}
          {data.replayed_latency_ms ? ` · ${(data.replayed_latency_ms / 1000).toFixed(1)}s` : ""}
        </p>
      </div>

      {/* Original question */}
      <div className="t-card mb-4 fade-in d2">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Original question
        </p>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">
          {data.original_question}
        </p>
        <p className="text-xs text-gray-400 mt-2">
          {data.original_user_name && <>from {data.original_user_name} · </>}
          {data.original_platform} · {data.original_channel_id}
          {data.original_created_at && <> · {new Date(data.original_created_at).toLocaleString()}</>}
        </p>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 fade-in d3">
        <div className="t-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Original answer
            </p>
            <span className="text-[11px] text-gray-400">
              {data.original_latency_ms ? `${(data.original_latency_ms / 1000).toFixed(1)}s` : ""}
              {data.original_rounds ? ` · ${data.original_rounds} round${data.original_rounds === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {data.original_answer}
          </p>
        </div>

        <div className="rounded-lg p-6" style={{ background: "rgba(245,243,255,0.6)", borderColor: "#ddd6fe", borderWidth: 1, borderStyle: "solid" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider">
              Replayed · current Pascal
            </p>
            <span className="text-[11px] text-violet-600">
              {data.replayed_latency_ms ? `${(data.replayed_latency_ms / 1000).toFixed(1)}s` : ""}
            </span>
          </div>
          {data.error ? (
            <p className="text-sm text-red-700">{data.error}</p>
          ) : data.replayed_answer ? (
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {data.replayed_answer}
            </p>
          ) : (
            <p className="text-sm text-gray-400 italic">No response captured</p>
          )}
        </div>
      </div>

      {/* Original tool calls (for context — the replay's own tool calls aren't currently captured for v1) */}
      {data.original_tool_calls && data.original_tool_calls.length > 0 && (
        <div className="t-card t-card-flush overflow-hidden fade-in d4">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Original tool calls ({data.original_tool_calls.length})
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Replay-side tool calls aren't captured separately yet — that's a v2 extension.
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {data.original_tool_calls.map((tc, i) => (
              <div key={i} className="px-6 py-3">
                <p className="text-sm font-medium text-violet-700 font-mono">{tc.tool}</p>
                <pre className="text-[11px] text-gray-500 bg-gray-50 rounded p-2 mt-1 overflow-x-auto">
                  {JSON.stringify(tc.input, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
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
