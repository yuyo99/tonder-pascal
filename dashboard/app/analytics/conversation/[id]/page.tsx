"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface ConversationDetail {
  id: string;
  merchantName: string;
  platform: string;
  channelId: string;
  userName: string | null;
  question: string;
  answer: string;
  toolCalls: { tool: string; input: Record<string, unknown> }[];
  rounds: number;
  latencyMs: number | null;
  ticketId: string | null;
  error: string | null;
  knowledgeUsed: { id: string; title: string; category: string }[];
  createdAt: string;
}

interface ReplayJobStatus {
  id: number;
  job_status: "pending" | "running" | "done" | "error";
  replay_status: "pending" | "running" | "done" | "error" | null;
  replayed_answer: string | null;
  replayed_latency_ms: number | null;
  replay_error: string | null;
  finished_at: string | null;
  job_error: string | null;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Replay state
  const [replaying, setReplaying] = useState(false);
  const [replay, setReplay] = useState<ReplayJobStatus | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  async function handleReplay() {
    if (replaying) return;
    setReplayError(null);
    setReplay(null);
    setReplaying(true);
    try {
      const res = await fetch("/api/replays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: id,
          triggered_by: "dashboard:conversation_detail",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setReplayError(err.error || "Failed to enqueue replay");
        return;
      }
      const job = await res.json();
      await pollReplayJob(job.jobId);
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : "Network error");
    } finally {
      setReplaying(false);
    }
  }

  async function pollReplayJob(jobId: number, maxWaitMs = 180_000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const res = await fetch(`/api/replays/jobs?id=${jobId}`);
        if (!res.ok) continue;
        const data = (await res.json()) as ReplayJobStatus;
        if (data.job_status === "done" || data.job_status === "error") {
          setReplay(data);
          return;
        }
      } catch {
        // keep polling
      }
    }
    setReplayError("Replay timed out waiting for completion (180s)");
  }

  useEffect(() => {
    fetch(`/api/analytics/conversations/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setConv(data);
          setLoading(false);
        }
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (notFound || !conv) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 text-lg">Conversation not found</p>
        <Link
          href="/analytics"
          className="text-violet-600 hover:text-violet-800 text-sm mt-2 inline-block"
        >
          Back to Analytics
        </Link>
      </div>
    );
  }

  const date = new Date(conv.createdAt);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/analytics/${encodeURIComponent(conv.merchantName)}`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">
            Conversation Detail
          </h1>
          <p className="text-sm text-gray-400">
            {conv.merchantName} &middot;{" "}
            {date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <button
          onClick={handleReplay}
          disabled={replaying}
          className="inline-flex items-center gap-2 px-4 py-[7px] bg-violet-600 text-white text-sm font-medium rounded-md hover:bg-violet-700 transition disabled:bg-violet-300 disabled:cursor-not-allowed"
        >
          {replaying ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Replaying…
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              Replay against current Pascal
            </>
          )}
        </button>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Platform</p>
            <span
              className={`text-xs px-2 py-1 rounded font-medium uppercase ${
                conv.platform === "slack"
                  ? "bg-purple-100 text-purple-700"
                  : "bg-violet-100 text-violet-700"
              }`}
            >
              {conv.platform}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">User</p>
            <p className="text-gray-700">{conv.userName || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Latency</p>
            <p className="text-gray-700">
              {conv.latencyMs ? `${(conv.latencyMs / 1000).toFixed(1)}s` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Rounds</p>
            <p className="text-gray-700">{conv.rounds}</p>
          </div>
        </div>

        {conv.error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs text-red-500 uppercase tracking-wide font-medium mb-1">Error</p>
            <p className="text-sm text-red-700 font-mono break-all">{conv.error}</p>
          </div>
        )}
      </div>

      {/* Question */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Question</p>
        <p className="text-gray-800 whitespace-pre-wrap">{conv.question}</p>
      </div>

      {/* Answer (+ Replay comparison when present) */}
      {replay || replayError ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Original */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Original answer</p>
              <span className="text-[11px] text-gray-400">
                {conv.latencyMs ? `${(conv.latencyMs / 1000).toFixed(1)}s` : "—"}
              </span>
            </div>
            <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
              {conv.answer}
            </p>
          </div>

          {/* Replayed */}
          <div className="bg-violet-50/40 rounded-xl border border-violet-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-violet-700 uppercase tracking-wide font-medium">
                Replayed against current Pascal
              </p>
              {replay?.replayed_latency_ms != null && (
                <span className="text-[11px] text-violet-600">
                  {(replay.replayed_latency_ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {replayError ? (
              <p className="text-sm text-red-700">{replayError}</p>
            ) : replay?.replay_error || replay?.job_error ? (
              <p className="text-sm text-red-700">{replay.replay_error || replay.job_error}</p>
            ) : replay?.replayed_answer ? (
              <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
                {replay.replayed_answer}
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">
                {replaying ? "Running…" : "no response captured"}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Answer</p>
          <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">{conv.answer}</p>
        </div>
      )}

      {/* Knowledge Used */}
      {conv.knowledgeUsed && conv.knowledgeUsed.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-3">
            Knowledge Used ({conv.knowledgeUsed.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {conv.knowledgeUsed.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-2 border border-violet-200 bg-violet-50 rounded-lg px-3 py-2"
              >
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-200 text-violet-700 font-medium uppercase">
                  {k.category}
                </span>
                <span className="text-sm text-violet-800">{k.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool Calls */}
      {conv.toolCalls.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-3">
            Tool Calls ({conv.toolCalls.length})
          </p>
          <div className="space-y-3">
            {conv.toolCalls.map((tc, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-3">
                <p className="text-sm font-medium text-violet-700 mb-1">{tc.tool}</p>
                <pre className="text-xs text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto">
                  {JSON.stringify(tc.input, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
