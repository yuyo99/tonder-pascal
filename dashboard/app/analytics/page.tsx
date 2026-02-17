"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Summary {
  total: number;
  last24h: number;
  last7d: number;
  activeMerchants7d: number;
}

interface MerchantRow {
  merchantName: string;
  total: number;
  last7d: number;
  last24h: number;
  lastQuestion: string;
  avgLatencyMs: number | null;
}

interface Conversation {
  id: string;
  merchantName: string;
  platform: string;
  userName: string | null;
  question: string;
  answerPreview: string;
  toolCalls: { tool: string }[];
  rounds: number;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/analytics/stats").then((r) => r.json()),
      fetch("/api/analytics/conversations?limit=10").then((r) => r.json()),
    ]).then(([stats, convs]) => {
      setSummary(stats.summary);
      setMerchants(stats.merchants);
      setConversations(convs.conversations);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Analytics</h1>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Conversations" value={summary.total} />
          <StatCard label="Last 24 Hours" value={summary.last24h} />
          <StatCard label="Last 7 Days" value={summary.last7d} />
          <StatCard label="Active Merchants (7d)" value={summary.activeMerchants7d} />
        </div>
      )}

      {/* Per-merchant table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Per-Merchant Breakdown
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="px-5 py-3 font-medium">Merchant</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
                <th className="px-5 py-3 font-medium text-right">7 Days</th>
                <th className="px-5 py-3 font-medium text-right">24 Hours</th>
                <th className="px-5 py-3 font-medium text-right">Avg Latency</th>
                <th className="px-5 py-3 font-medium">Last Question</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((m) => (
                <tr
                  key={m.merchantName}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/analytics/${encodeURIComponent(m.merchantName)}`}
                      className="text-violet-600 hover:text-violet-800 font-medium"
                    >
                      {m.merchantName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right font-mono">{m.total}</td>
                  <td className="px-5 py-3 text-right font-mono">{m.last7d}</td>
                  <td className="px-5 py-3 text-right font-mono">{m.last24h}</td>
                  <td className="px-5 py-3 text-right text-gray-500">
                    {m.avgLatencyMs ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-500">
                    {m.lastQuestion ? timeAgo(m.lastQuestion) : "—"}
                  </td>
                </tr>
              ))}
              {merchants.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-400">
                    No conversations yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent conversations */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Recent Conversations
          </h2>
        </div>
        <div className="divide-y divide-gray-50">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/analytics/conversation/${c.id}`}
              className="block px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 text-sm">
                      {c.merchantName}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${
                      c.platform === "slack"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {c.platform}
                    </span>
                    {c.error && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                        ERROR
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 truncate">{c.question}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    {c.answerPreview}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">{timeAgo(c.createdAt)}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    {c.toolCalls.length > 0 && (
                      <span>{c.toolCalls.length} tool{c.toolCalls.length > 1 ? "s" : ""}</span>
                    )}
                    {c.latencyMs && (
                      <span>{(c.latencyMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
          {conversations.length === 0 && (
            <div className="px-5 py-8 text-center text-gray-400">
              No conversations yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
