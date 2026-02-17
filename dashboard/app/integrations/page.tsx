"use client";

import { useEffect, useState, useCallback } from "react";

/* ─── Types ─── */

interface MerchantIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  status: string;
  statusType: string;
  priority: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
}

interface MerchantEntry {
  name: string;
  type: "merchant" | "partner";
  section: "integration" | "support";
  issues: MerchantIssue[];
  openCount: number;
  latestStatus: string;
  latestStatusType: string;
  assignee: string | null;
  lastActivity: string;
}

interface IntegrationStats {
  totalInIntegration: number;
  totalLive: number;
  blockedCount: number;
  inProgressCount: number;
  completedThisMonth: number;
}

interface IntegrationData {
  integrations: MerchantEntry[];
  support: MerchantEntry[];
  stats: IntegrationStats;
  cachedAt: string;
}

/* ─── Constants ─── */

const STATUS_STYLES: Record<string, string> = {
  "In Progress": "bg-blue-100 text-blue-700",
  Investigating: "bg-blue-100 text-blue-700",
  Open: "bg-violet-100 text-violet-700",
  "Waiting for Customer": "bg-amber-100 text-amber-700",
  Paused: "bg-amber-100 text-amber-700",
  Triage: "bg-gray-100 text-gray-600",
  Backlog: "bg-gray-100 text-gray-600",
  Completed: "bg-emerald-100 text-emerald-700",
  Resolved: "bg-emerald-100 text-emerald-700",
  Canceled: "bg-red-100 text-red-600",
  Duplicate: "bg-gray-100 text-gray-500",
};

const SECTION_TABS = [
  { value: "all", label: "All" },
  { value: "integration", label: "In Integration" },
  { value: "support", label: "Live (Support)" },
];

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "merchant", label: "Merchants" },
  { value: "partner", label: "Partners" },
];

/* ─── Helpers ─── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/* ─── Page ─── */

export default function IntegrationsPage() {
  const [data, setData] = useState<IntegrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  const fetchData = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/integrations${refresh ? "?refresh=1" : ""}`
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
    } catch {
      setError("Failed to load integration data from Linear");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Merge and filter entries
  const allEntries: MerchantEntry[] = data
    ? [...data.integrations, ...data.support]
    : [];

  const filtered = allEntries.filter((entry) => {
    if (sectionFilter !== "all" && entry.section !== sectionFilter) return false;
    if (typeFilter !== "all" && entry.type !== typeFilter) return false;
    if (search && !entry.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const integrationEntries = filtered.filter(
    (e) => e.section === "integration"
  );
  const supportEntries = filtered.filter((e) => e.section === "support");

  const stats = data?.stats;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Integrations
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Merchant &amp; partner onboarding progress from Linear
            {data?.cachedAt && (
              <span className="ml-2 text-gray-300">
                &middot; Updated {timeAgo(data.cachedAt)}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0115-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 01-15 6.7L3 16" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard
            label="In Integration"
            value={stats.totalInIntegration}
            color="text-violet-600"
          />
          <StatCard
            label="Live (Support)"
            value={stats.totalLive}
            color="text-emerald-600"
          />
          <StatCard
            label="Blocked / Waiting"
            value={stats.blockedCount}
            color="text-amber-600"
          />
          <StatCard
            label="In Progress"
            value={stats.inProgressCount}
            color="text-blue-600"
          />
          <StatCard
            label="Done This Month"
            value={stats.completedThisMonth}
            color="text-gray-600"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {/* Section tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSectionFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                sectionFilter === tab.value
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Type tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setTypeFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                typeFilter === tab.value
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && !data ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
          <p className="text-sm text-gray-400">Loading from Linear...</p>
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#9888;&#65039;</div>
          <p className="text-gray-600 font-medium">{error}</p>
          <button
            onClick={() => fetchData(true)}
            className="mt-3 text-sm text-violet-600 hover:text-violet-800"
          >
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">&#128270;</div>
          <h2 className="text-xl font-semibold text-gray-700">
            No matches found
          </h2>
          <p className="text-gray-400 mt-2">
            Try adjusting your filters or search term.
          </p>
        </div>
      ) : (
        <>
          {/* In Integration section */}
          {(sectionFilter === "all" || sectionFilter === "integration") &&
            integrationEntries.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    In Integration
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                    {integrationEntries.length}
                  </span>
                </div>
                <EntityTable
                  entries={integrationEntries}
                  expandedEntity={expandedEntity}
                  onToggleExpand={setExpandedEntity}
                />
              </div>
            )}

          {/* Live / Support section */}
          {(sectionFilter === "all" || sectionFilter === "support") &&
            supportEntries.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    Live / Support
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                    {supportEntries.length}
                  </span>
                </div>
                <EntityTable
                  entries={supportEntries}
                  expandedEntity={expandedEntity}
                  onToggleExpand={setExpandedEntity}
                />
              </div>
            )}
        </>
      )}
    </div>
  );
}

/* ─── Sub-Components ─── */

function StatCard({
  label,
  value,
  color = "text-gray-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 text-center">
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || "bg-gray-100 text-gray-600";
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${style}`}
    >
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: "merchant" | "partner" }) {
  const style =
    type === "merchant"
      ? "bg-violet-50 text-violet-700"
      : "bg-red-50 text-red-600";
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${style}`}
    >
      {type}
    </span>
  );
}

function EntityTable({
  entries,
  expandedEntity,
  onToggleExpand,
}: {
  entries: MerchantEntry[];
  expandedEntity: string | null;
  onToggleExpand: (name: string | null) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left">
            <th className="px-4 py-3 font-medium text-gray-500 text-xs">
              Name
            </th>
            <th className="px-4 py-3 font-medium text-gray-500 text-xs">
              Type
            </th>
            <th className="px-4 py-3 font-medium text-gray-500 text-xs">
              Status
            </th>
            <th className="px-4 py-3 font-medium text-gray-500 text-xs text-center">
              Open
            </th>
            <th className="px-4 py-3 font-medium text-gray-500 text-xs hidden sm:table-cell">
              Assignee
            </th>
            <th className="px-4 py-3 font-medium text-gray-500 text-xs hidden md:table-cell">
              Last Activity
            </th>
            <th className="px-4 py-3 w-10" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const key = `${entry.section}:${entry.name}`;
            const isExpanded = expandedEntity === key;
            return (
              <EntityRow
                key={key}
                entry={entry}
                isExpanded={isExpanded}
                onToggle={() =>
                  onToggleExpand(isExpanded ? null : key)
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EntityRow({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: MerchantEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className={`w-3 h-3 text-gray-400 transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="font-medium text-gray-900">{entry.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <TypeBadge type={entry.type} />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={entry.latestStatus} />
        </td>
        <td className="px-4 py-3 text-center">
          <span
            className={`text-sm font-medium ${entry.openCount > 0 ? "text-gray-900" : "text-gray-300"}`}
          >
            {entry.openCount}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
          {entry.assignee || (
            <span className="text-gray-300">Unassigned</span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
          {timeAgo(entry.lastActivity)}
        </td>
        <td className="px-4 py-3">
          {entry.issues[0] && (
            <a
              href={entry.issues[0].url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-gray-400 hover:text-violet-600 transition-colors"
              title="Open in Linear"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </td>
      </tr>

      {/* Expanded: show all issues */}
      {isExpanded && entry.issues.length > 0 && (
        <tr>
          <td colSpan={7} className="bg-gray-50/80 px-4 py-2">
            <div className="space-y-1.5 ml-5">
              {entry.issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-center gap-3 text-xs py-1.5 px-3 bg-white rounded-lg border border-gray-100"
                >
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-violet-600 hover:text-violet-800 shrink-0"
                  >
                    {issue.identifier}
                  </a>
                  <span className="text-gray-700 truncate flex-1">
                    {issue.title}
                  </span>
                  <StatusBadge status={issue.status} />
                  <span className="text-gray-400 shrink-0 hidden sm:inline">
                    {issue.assignee || "Unassigned"}
                  </span>
                  {issue.dueDate && (
                    <span
                      className={`shrink-0 ${
                        new Date(issue.dueDate) < new Date()
                          ? "text-red-500 font-medium"
                          : "text-gray-400"
                      }`}
                    >
                      Due {new Date(issue.dueDate).toLocaleDateString()}
                    </span>
                  )}
                  <span className="text-gray-300 shrink-0">
                    {timeAgo(issue.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
