"use client";

import { useEffect, useState, useCallback } from "react";

/* ─── Types ─── */

interface ErrorStats {
  total: number;
  last1h: number;
  last24h: number;
  sourcesAffected: number;
  fatalCount: number;
}

interface SourceCount {
  source: string;
  count: number;
}

interface ErrorLog {
  id: string;
  source: string;
  severity: string;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  createdAt: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
}

/* ─── Constants ─── */

const TIME_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

const SOURCE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-100 text-violet-700",
  tool: "bg-indigo-100 text-indigo-700",
  slack: "bg-purple-100 text-purple-700",
  telegram: "bg-blue-100 text-blue-700",
  scheduler: "bg-amber-100 text-amber-700",
  feedback: "bg-teal-100 text-teal-700",
  config: "bg-gray-100 text-gray-700",
  system: "bg-red-100 text-red-700",
};

/* ─── Helpers ─── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    timeZone: "America/Mexico_City",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "…" : str;
}

/* ─── Component ─── */

export default function MonitoringPage() {
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [hours, setHours] = useState(24);
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        hours: String(hours),
        limit: "50",
        offset: String(offset),
      });
      if (source) params.set("source", source);
      if (severity) params.set("severity", severity);
      if (search) params.set("search", search);

      const res = await fetch(`/api/monitoring?${params}`);
      const data = await res.json();
      setStats(data.stats);
      setSources(data.sources);
      setErrors(data.errors);
      setPagination(data.pagination);
    } catch {
      setStats(null);
      setErrors([]);
    } finally {
      setLoading(false);
    }
  }, [hours, source, severity, search, offset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [hours, source, severity, search]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Error Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track and investigate Pascal errors in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time window selector */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                onClick={() => setHours(opt.hours)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  hours === opt.hours
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button
            onClick={fetchData}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total Errors" value={stats.total} />
          <StatCard label="Last Hour" value={stats.last1h} />
          <StatCard label="Fatal" value={stats.fatalCount} accent={stats.fatalCount > 0} />
          <StatCard label="Sources Affected" value={stats.sourcesAffected} />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 mb-4 flex flex-wrap gap-2 items-center">
        {/* Source filter */}
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.source} value={s.source}>
              {s.source} ({s.count})
            </option>
          ))}
        </select>

        {/* Severity filter */}
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
        >
          <option value="">All severities</option>
          <option value="error">error</option>
          <option value="fatal">fatal</option>
        </select>

        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search error messages..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Error Table */}
      {!loading && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {errors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium">No errors found</p>
              <p className="text-xs mt-1">All clear for the selected time window</p>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-[100px_100px_70px_1fr_140px] gap-3 px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <span>Time</span>
                <span>Source</span>
                <span>Level</span>
                <span>Message</span>
                <span>Context</span>
              </div>

              {/* Table rows */}
              {errors.map((err) => (
                <div key={err.id}>
                  <div
                    onClick={() =>
                      setExpandedId(expandedId === err.id ? null : err.id)
                    }
                    className="grid grid-cols-1 sm:grid-cols-[100px_100px_70px_1fr_140px] gap-1 sm:gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                  >
                    {/* Time */}
                    <span className="text-xs text-gray-500" title={formatDate(err.createdAt)}>
                      {timeAgo(err.createdAt)}
                    </span>

                    {/* Source badge */}
                    <span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          SOURCE_COLORS[err.source] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {err.source}
                      </span>
                    </span>

                    {/* Severity */}
                    <span>
                      <span
                        className={`text-[10px] font-semibold uppercase ${
                          err.severity === "fatal"
                            ? "text-red-600"
                            : "text-amber-600"
                        }`}
                      >
                        {err.severity}
                      </span>
                    </span>

                    {/* Message */}
                    <span className="text-sm text-gray-800 font-mono truncate">
                      {truncate(err.message, 120)}
                    </span>

                    {/* Context preview */}
                    <span className="text-xs text-gray-400 truncate">
                      {err.context.merchant
                        ? String(err.context.merchant)
                        : err.context.action
                        ? String(err.context.action)
                        : "—"}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {expandedId === err.id && (
                    <div className="px-4 py-4 bg-gray-50/50 border-b border-gray-100 space-y-3">
                      {/* Timestamp */}
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Timestamp
                        </span>
                        <p className="text-sm text-gray-700 mt-0.5">
                          {formatDate(err.createdAt)}
                        </p>
                      </div>

                      {/* Full message */}
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Message
                        </span>
                        <pre className="mt-1 bg-white rounded-lg border border-gray-200 p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-all overflow-x-auto max-h-32 overflow-y-auto">
                          {err.message}
                        </pre>
                      </div>

                      {/* Stack trace */}
                      {err.stack && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Stack Trace
                          </span>
                          <pre className="mt-1 bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-300 whitespace-pre-wrap break-all overflow-x-auto max-h-48 overflow-y-auto">
                            {err.stack}
                          </pre>
                        </div>
                      )}

                      {/* Context */}
                      {Object.keys(err.context).length > 0 && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Context
                          </span>
                          <pre className="mt-1 bg-white rounded-lg border border-gray-200 p-3 text-xs font-mono text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">
                            {JSON.stringify(err.context, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Pagination */}
          {pagination && pagination.total > pagination.limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                Showing {offset + 1}–{Math.min(offset + errors.length, pagination.total)} of{" "}
                {pagination.total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - pagination.limit))}
                  disabled={offset === 0}
                  className="px-3 py-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + pagination.limit)}
                  disabled={offset + pagination.limit >= pagination.total}
                  className="px-3 py-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Stat Card ─── */

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">
        {label}
      </p>
      <p
        className={`text-2xl font-semibold mt-1 ${
          accent ? "text-red-600" : "text-gray-900"
        }`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}
