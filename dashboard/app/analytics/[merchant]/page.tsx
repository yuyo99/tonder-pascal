"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface MerchantStats {
  total: number;
  last7d: number;
  last24h: number;
  avgLatencyMs: number | null;
}

interface Conversation {
  id: string;
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

export default function MerchantAnalyticsPage() {
  const params = useParams();
  const merchantName = decodeURIComponent(params.merchant as string);

  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/analytics/stats`).then((r) => r.json()),
      fetch(
        `/api/analytics/conversations?merchant=${encodeURIComponent(merchantName)}&limit=${limit}&offset=${offset}`
      ).then((r) => r.json()),
    ]).then(([statsData, convsData]) => {
      const merchant = statsData.merchants.find(
        (m: { merchantName: string }) => m.merchantName === merchantName
      );
      setStats(
        merchant
          ? {
              total: merchant.total,
              last7d: merchant.last7d,
              last24h: merchant.last24h,
              avgLatencyMs: merchant.avgLatencyMs,
            }
          : { total: 0, last7d: 0, last24h: 0, avgLatencyMs: null }
      );
      setConversations(convsData.conversations);
      setTotal(convsData.total);
      setLoading(false);
    });
  }, [merchantName, offset]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/analytics"
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{merchantName}</h1>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Questions" value={stats.total} />
          <StatCard label="Last 7 Days" value={stats.last7d} />
          <StatCard label="Last 24 Hours" value={stats.last24h} />
          <StatCard
            label="Avg Response Time"
            value={stats.avgLatencyMs ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
          />
        </div>
      )}

      {/* Conversation log table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Conversation History
          </h2>
          <span className="text-xs text-gray-400">
            {total} conversation{total !== 1 ? "s" : ""}
          </span>
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
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${
                        c.platform === "slack"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {c.platform}
                    </span>
                    {c.userName && (
                      <span className="text-xs text-gray-400">{c.userName}</span>
                    )}
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
                      <span>
                        {c.toolCalls.length} tool{c.toolCalls.length > 1 ? "s" : ""}
                      </span>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="text-sm text-violet-600 hover:text-violet-800 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-xs text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={currentPage >= totalPages}
              className="text-sm text-violet-600 hover:text-violet-800 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
        {label}
      </p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
