"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Sparkline from "@/components/Sparkline";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Stats {
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
  lastQuestion: string | null;
  avgLatencyMs: number | null;
}

interface DailyPoint {
  date: string;
  count: number;
}

interface Health {
  status: string;
  heartbeat: {
    serviceName: string;
    lastSeenAt: string;
    ageSeconds: number;
    meta: Record<string, unknown>;
  } | null;
  openIncidents: number;
  lastHourQA: Record<string, number>;
}

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

interface Gap {
  id: string;
  question: string;
  merchant_name: string | null;
  frequency: number;
  suggested_category: string | null;
  detected_at: string;
}

interface Conversation {
  id: string;
  merchantName: string;
  platform: string;
  userName: string | null;
  question: string;
  answerPreview: string;
  rounds: number;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [errors, setErrors] = useState<ErrorStats | null>(null);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Six parallel fetches. Each section ignores its own failure and
    // renders an empty state instead of crashing the page.
    const safe = <T,>(p: Promise<Response>, fallback: T): Promise<T> =>
      p.then((r) => (r.ok ? (r.json() as Promise<T>) : fallback)).catch(() => fallback);

    Promise.all([
      safe<{ summary: Stats; merchants: MerchantRow[] }>(
        fetch("/api/analytics/stats"),
        { summary: { total: 0, last24h: 0, last7d: 0, activeMerchants7d: 0 }, merchants: [] },
      ),
      safe<{ daily: DailyPoint[] }>(fetch("/api/analytics/daily?days=30"), { daily: [] }),
      safe<Health>(fetch("/api/monitoring/health"), {
        status: "unknown",
        heartbeat: null,
        openIncidents: 0,
        lastHourQA: {},
      }),
      safe<{ stats: ErrorStats; sources: SourceCount[] }>(
        fetch("/api/monitoring?hours=24"),
        {
          stats: { total: 0, last1h: 0, last24h: 0, sourcesAffected: 0, fatalCount: 0 },
          sources: [],
        },
      ),
      safe<{ gaps: Gap[] }>(fetch("/api/training/gaps?status=pending"), { gaps: [] }),
      safe<{ conversations: Conversation[] }>(
        fetch("/api/analytics/conversations?limit=8"),
        { conversations: [] },
      ),
    ]).then(([s, d, h, e, g, c]) => {
      setStats(s.summary);
      setMerchants(s.merchants);
      setDaily(d.daily);
      setHealth(h);
      setErrors(e.stats);
      setSources(e.sources);
      setGaps(g.gaps);
      setConversations(c.conversations);
      setLoaded(true);
    });
  }, []);

  const healthInfo = computeHealth(health, errors);
  const errorRate24h = stats && stats.last24h > 0
    ? ((errors?.last24h ?? 0) / stats.last24h) * 100
    : 0;

  return (
    <>
      <PageHeader title="Overview" subtitle="What Pascal is doing right now" />

      {/* Hero KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Conversations · 24h"
          value={stats?.last24h ?? null}
          loaded={loaded}
          delay={1}
          right={
            daily.length > 0 ? (
              <Sparkline data={daily.map((d) => d.count)} color="violet" />
            ) : null
          }
        />
        <KPICard
          label="Pascal Health"
          value={loaded ? healthInfo.label : null}
          loaded={loaded}
          delay={2}
          valueClass={`text-base ${
            healthInfo.severity === "healthy"
              ? "text-emerald-700"
              : healthInfo.severity === "warning"
                ? "text-amber-700"
                : "text-red-700"
          }`}
          right={
            <span
              className={`t-badge ${
                healthInfo.severity === "healthy"
                  ? "t-badge-emerald"
                  : healthInfo.severity === "warning"
                    ? "t-badge-amber"
                    : "t-badge-red"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  healthInfo.severity === "healthy"
                    ? "bg-emerald-500"
                    : healthInfo.severity === "warning"
                      ? "bg-amber-500"
                      : "bg-red-500"
                }`}
              />
              {healthInfo.severity}
            </span>
          }
        />
        <KPICard
          label="Open gaps"
          value={loaded ? gaps.length : null}
          loaded={loaded}
          delay={3}
          right={
            loaded && gaps.length > 0 ? (
              <Link href="/training" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
                Review →
              </Link>
            ) : null
          }
        />
        <KPICard
          label="Error rate · 24h"
          value={loaded ? `${errorRate24h.toFixed(1)}%` : null}
          loaded={loaded}
          delay={4}
          valueClass={errorRate24h > 2 ? "text-red-700" : "text-gray-900"}
          right={
            <span className="text-xs text-gray-400 tabular-nums">
              {errors?.last24h ?? 0} errors · {stats?.last24h ?? 0} convos
            </span>
          }
        />
      </div>

      {/* Pascal Health card */}
      <PascalHealthCard health={health} errors={errors} sources={sources} loaded={loaded} />

      {/* Two-column: recent activity + learning queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <RecentActivity convos={conversations} loaded={loaded} />
        <LearningQueue gaps={gaps} loaded={loaded} />
      </div>

      {/* Top merchants */}
      <TopMerchants merchants={merchants.slice(0, 8)} loaded={loaded} />
    </>
  );
}

/* ─── KPI Card ─────────────────────────────────────────────────────── */

function KPICard({
  label,
  value,
  loaded,
  delay,
  right,
  valueClass,
}: {
  label: string;
  value: number | string | null;
  loaded: boolean;
  delay: number;
  right?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p
        className={`mt-1 leading-tight font-semibold ${
          valueClass ?? "text-gray-900 text-[var(--text-metric)]"
        }`}
      >
        {loaded
          ? typeof value === "number"
            ? value.toLocaleString()
            : (value ?? "—")
          : <span className="inline-block h-7 w-16 bg-gray-100 rounded animate-pulse" />}
      </p>
      {right && <div className="mt-3 flex items-center justify-between">{right}</div>}
    </div>
  );
}

/* ─── Pascal Health card ───────────────────────────────────────────── */

function PascalHealthCard({
  health,
  errors,
  sources,
  loaded,
}: {
  health: Health | null;
  errors: ErrorStats | null;
  sources: SourceCount[];
  loaded: boolean;
}) {
  const qa = health?.lastHourQA ?? {};
  const top3 = sources.slice(0, 3);

  return (
    <div className="t-card mb-6 fade-in d5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Pascal Health</h2>
          <p className="text-xs text-gray-400 mt-0.5">Heartbeat · incidents · last-hour self-QA</p>
        </div>
        <Link href="/monitoring" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          Open monitoring →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric
          label="Heartbeat"
          value={
            loaded && health?.heartbeat
              ? `${formatAge(health.heartbeat.ageSeconds)} ago`
              : loaded ? "no heartbeat" : "…"
          }
          tone={
            !loaded
              ? "neutral"
              : !health?.heartbeat || health.heartbeat.ageSeconds > 120
                ? "bad"
                : "good"
          }
        />
        <Metric
          label="Open incidents"
          value={loaded ? (health?.openIncidents ?? 0) : "…"}
          tone={!loaded ? "neutral" : (health?.openIncidents ?? 0) > 0 ? "bad" : "good"}
        />
        <Metric
          label="Self-QA · last hour"
          value={
            loaded
              ? `${qa.ok ?? 0} ok · ${qa.warning ?? 0} warn · ${qa.critical ?? 0} crit`
              : "…"
          }
          tone={!loaded ? "neutral" : (qa.critical ?? 0) > 0 ? "bad" : (qa.warning ?? 0) > 0 ? "warn" : "good"}
        />
        <Metric
          label="Fatal · 24h"
          value={loaded ? (errors?.fatalCount ?? 0) : "…"}
          tone={!loaded ? "neutral" : (errors?.fatalCount ?? 0) > 0 ? "bad" : "good"}
        />
      </div>

      {loaded && top3.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Top error sources · 24h
          </p>
          <div className="flex flex-wrap gap-2">
            {top3.map((s) => (
              <span key={s.source} className="t-badge t-badge-gray">
                {s.source}
                <span className="ml-0.5 text-gray-500 font-semibold">· {s.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-700"
          : "text-gray-400";
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

/* ─── Recent Activity ──────────────────────────────────────────────── */

function RecentActivity({
  convos,
  loaded,
}: {
  convos: Conversation[];
  loaded: boolean;
}) {
  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d6">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
        <Link href="/analytics" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          All conversations →
        </Link>
      </div>
      <div className="divide-y divide-gray-50">
        {!loaded ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : convos.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            No conversations yet
          </div>
        ) : (
          convos.map((c) => (
            <Link
              key={c.id}
              href={`/analytics/conversation/${c.id}`}
              className="block px-6 py-3 hover:bg-violet-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-gray-900 text-sm truncate">
                    {c.merchantName}
                  </span>
                  <span className={`t-badge ${c.platform === "slack" ? "t-badge-violet" : "t-badge-blue"}`}>
                    {c.platform}
                  </span>
                  {c.error && <span className="t-badge t-badge-red">error</span>}
                </div>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(c.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-700 truncate">{c.question}</p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Learning Queue ───────────────────────────────────────────────── */

function LearningQueue({
  gaps,
  loaded,
}: {
  gaps: Gap[];
  loaded: boolean;
}) {
  const top = gaps.slice(0, 5);
  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d7">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Learning queue</h2>
        <Link href="/training" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          All gaps →
        </Link>
      </div>
      <div className="divide-y divide-gray-50">
        {!loaded ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : top.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Gap queue is clear ✓
          </div>
        ) : (
          top.map((g) => (
            <div key={g.id} className="px-6 py-3 hover:bg-violet-50 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  {g.suggested_category && (
                    <span className="t-badge t-badge-violet">{g.suggested_category}</span>
                  )}
                  <span
                    className={`t-badge ${g.frequency > 3 ? "t-badge-red" : "t-badge-gray"}`}
                  >
                    {g.frequency}× seen
                  </span>
                </div>
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(g.detected_at)}</span>
              </div>
              <p className="text-sm text-gray-900 truncate">{g.question}</p>
              {g.merchant_name && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{g.merchant_name}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Top Merchants ────────────────────────────────────────────────── */

function TopMerchants({
  merchants,
  loaded,
}: {
  merchants: MerchantRow[];
  loaded: boolean;
}) {
  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d8">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Top merchants · 7d</h2>
        <Link href="/merchants" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
          All merchants →
        </Link>
      </div>
      {!loaded ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">Loading…</div>
      ) : merchants.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">No merchant activity yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="t-table">
            <thead>
              <tr>
                <th>Merchant</th>
                <th className="num">Total 7d</th>
                <th className="num">Last 24h</th>
                <th className="num">Avg latency</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((m) => (
                <tr key={m.merchantName}>
                  <td>
                    <Link
                      href={`/analytics/${encodeURIComponent(m.merchantName)}`}
                      className="text-gray-900 hover:text-violet-600 font-medium"
                    >
                      {m.merchantName}
                    </Link>
                  </td>
                  <td className="num font-medium text-gray-900">{m.last7d.toLocaleString()}</td>
                  <td className="num text-gray-700">{m.last24h.toLocaleString()}</td>
                  <td className="num text-gray-500">
                    {m.avgLatencyMs ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="text-gray-500">
                    {m.lastQuestion ? timeAgo(m.lastQuestion) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

type Severity = "healthy" | "warning" | "critical";

function computeHealth(
  h: Health | null,
  e: ErrorStats | null,
): { severity: Severity; label: string } {
  if (!h) return { severity: "critical", label: "No heartbeat" };
  if (!h.heartbeat) return { severity: "critical", label: "No heartbeat" };
  if (h.heartbeat.ageSeconds > 120) return { severity: "critical", label: "Heartbeat stale" };
  if (h.openIncidents > 0) {
    return {
      severity: "critical",
      label: `${h.openIncidents} open incident${h.openIncidents > 1 ? "s" : ""}`,
    };
  }
  if ((e?.fatalCount ?? 0) > 0) {
    return { severity: "critical", label: `${e!.fatalCount} fatal · 24h` };
  }
  if ((h.lastHourQA?.critical ?? 0) > 0) {
    return { severity: "warning", label: "QA critical · last hour" };
  }
  if ((e?.last1h ?? 0) > 5) {
    return { severity: "warning", label: `${e!.last1h} errors · 1h` };
  }
  return { severity: "healthy", label: "All systems operational" };
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

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
