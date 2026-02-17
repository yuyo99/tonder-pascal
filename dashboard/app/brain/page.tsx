"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CATEGORY_COLORS, KNOWLEDGE_CATEGORIES, topicCategory } from "@/lib/brain-topics";

// Force graph MUST be loaded client-side only (Canvas)
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
    </div>
  ),
});

/* ─── Types ─── */

interface GraphNode {
  id: string;
  label: string;
  category: string;
  color: string;
  count: number;
  errorCount: number;
  avgRounds: number;
  x?: number;
  y?: number;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  weight: number;
}

interface BrainData {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  insights: {
    topTopics: { topic: string; category: string; count: number }[];
    errorTopics: {
      topic: string;
      errorCount: number;
      totalCount: number;
      errorRate: number;
    }[];
    topMerchants: { merchant: string; questionCount: number }[];
    complexTopics: { topic: string; avgRounds: number; count: number }[];
    weeklyTrend: { week: string; topic: string; count: number }[];
    knowledgeCoverage: { category: string; entryCount: number; totalHits: number }[];
  };
  recentQuestions: Record<
    string,
    { id: string; question: string; merchant: string; createdAt: string }[]
  >;
}

const TIME_RANGES = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

/* ─── Page ─── */

export default function BrainPage() {
  const [data, setData] = useState<BrainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });

  // Fetch data
  useEffect(() => {
    setLoading(true);
    fetch(`/api/brain?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [days]);

  // Fit graph on data change
  useEffect(() => {
    if (data && graphRef.current) {
      setTimeout(() => graphRef.current?.zoomToFit(400, 40), 300);
    }
  }, [data]);

  // Track container size
  useEffect(() => {
    function update() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: Math.max(containerRef.current.offsetHeight, 450),
        });
      }
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Node renderer
  const paintNode = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const r = Math.max(4, Math.sqrt(n.count) * 3);
      const fontSize = Math.max(10 / globalScale, 2);
      const isSelected = selectedNode?.id === n.id;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r + 4, 0, 2 * Math.PI);
        ctx.fillStyle = `${n.color}33`;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = n.color;
      ctx.fill();

      // Error indicator (red ring)
      if (n.errorCount > 0) {
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r + 1.5, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Label
      ctx.font = `${fontSize}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#374151";
      ctx.fillText(n.label, n.x!, n.y! + r + 2);
    },
    [selectedNode]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data || data.graph.nodes.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🧠</div>
        <h2 className="text-xl font-semibold text-gray-700">
          Not enough data yet
        </h2>
        <p className="text-gray-400 mt-2">
          Brain needs conversations to map. Start chatting with Pascal to see
          the knowledge graph appear.
        </p>
      </div>
    );
  }

  const graphData = {
    nodes: data.graph.nodes,
    links: data.graph.edges,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Brain</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Question knowledge graph &middot; connections &amp; insights
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.days}
              onClick={() => setDays(tr.days)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === tr.days
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex gap-6 flex-col lg:flex-row">
        {/* Left: Graph */}
        <div className="lg:w-2/3 w-full">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div
              ref={containerRef}
              className="relative"
              style={{ height: "500px" }}
            >
              <ForceGraph2D
                ref={graphRef}
                graphData={graphData}
                width={dimensions.width}
                height={dimensions.height}
                nodeCanvasObject={paintNode}
                nodePointerAreaPaint={(node, color, ctx) => {
                  const n = node as GraphNode;
                  const r = Math.max(4, Math.sqrt(n.count) * 3);
                  ctx.beginPath();
                  ctx.arc(n.x!, n.y!, r + 4, 0, 2 * Math.PI);
                  ctx.fillStyle = color;
                  ctx.fill();
                }}
                linkWidth={(link) =>
                  Math.max(1, ((link as GraphEdge).weight || 1) * 1.5)
                }
                linkColor={() => "#e5e7eb"}
                onNodeClick={(node) =>
                  setSelectedNode(
                    (node as GraphNode).id === selectedNode?.id
                      ? null
                      : (node as GraphNode)
                  )
                }
                cooldownTicks={80}
                d3AlphaDecay={0.04}
                d3VelocityDecay={0.3}
              />
            </div>

            {/* Legend */}
            <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-4">
              {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                <div key={cat} className="flex items-center gap-1.5">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-gray-500">{cat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Node detail drawer */}
          {selectedNode && (
            <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: selectedNode.color }}
                  />
                  <h3 className="text-lg font-semibold text-gray-900">
                    {selectedNode.label}
                  </h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {selectedNode.category}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-semibold text-gray-900">
                    {selectedNode.count}
                  </p>
                  <p className="text-xs text-gray-400">Questions</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p
                    className={`text-2xl font-semibold ${
                      selectedNode.errorCount > 0
                        ? "text-red-600"
                        : "text-gray-900"
                    }`}
                  >
                    {selectedNode.errorCount}
                  </p>
                  <p className="text-xs text-gray-400">Errors</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-semibold text-gray-900">
                    {selectedNode.avgRounds}
                  </p>
                  <p className="text-xs text-gray-400">Avg Rounds</p>
                </div>
              </div>

              {/* Recent questions for this topic */}
              {data.recentQuestions[selectedNode.id] && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
                    Recent Questions
                  </p>
                  <div className="space-y-2">
                    {data.recentQuestions[selectedNode.id].map((q) => (
                      <Link
                        key={q.id}
                        href={`/analytics/conversation/${q.id}`}
                        className="block p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <p className="text-sm text-gray-700 truncate">
                          {q.question}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {q.merchant} &middot;{" "}
                          {timeAgo(q.createdAt)}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Insights */}
        <div className="lg:w-1/3 w-full space-y-4">
          {/* Top Topics */}
          <InsightCard title="Top Topics">
            {data.insights.topTopics.map((t) => {
              const maxCount = data.insights.topTopics[0]?.count || 1;
              return (
                <div key={t.topic} className="flex items-center gap-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{t.topic}</p>
                  </div>
                  <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(t.count / maxCount) * 100}%`,
                        backgroundColor:
                          CATEGORY_COLORS[t.category] || "#6b7280",
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right">
                    {t.count}
                  </span>
                </div>
              );
            })}
            {data.insights.topTopics.length === 0 && (
              <p className="text-sm text-gray-400">No data yet</p>
            )}
          </InsightCard>

          {/* Documentation Gaps */}
          <InsightCard
            title="Documentation Gaps"
            subtitle="Topics with highest error rate"
          >
            {data.insights.errorTopics.map((t) => (
              <div
                key={t.topic}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <p className="text-sm text-gray-700 truncate">{t.topic}</p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <span className="text-sm font-medium text-red-600">
                    {t.errorRate}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">
                    ({t.errorCount}/{t.totalCount})
                  </span>
                </div>
              </div>
            ))}
            {data.insights.errorTopics.length === 0 && (
              <p className="text-sm text-emerald-600">
                ✓ No significant error patterns
              </p>
            )}
          </InsightCard>

          {/* Most Active Merchants */}
          <InsightCard title="Most Active Merchants">
            {data.insights.topMerchants.map((m) => (
              <div
                key={m.merchant}
                className="flex items-center justify-between py-1.5"
              >
                <Link
                  href={`/analytics/${encodeURIComponent(m.merchant)}`}
                  className="text-sm text-violet-600 hover:text-violet-800 truncate"
                >
                  {m.merchant}
                </Link>
                <span className="text-xs text-gray-400 ml-2 shrink-0">
                  {m.questionCount} questions
                </span>
              </div>
            ))}
            {data.insights.topMerchants.length === 0 && (
              <p className="text-sm text-gray-400">No merchants yet</p>
            )}
          </InsightCard>

          {/* Complex Topics */}
          <InsightCard
            title="Complex Topics"
            subtitle="Highest avg AI rounds — may need better docs"
          >
            {data.insights.complexTopics.map((t) => (
              <div
                key={t.topic}
                className="flex items-center justify-between py-1.5"
              >
                <p className="text-sm text-gray-700 truncate">{t.topic}</p>
                <div className="text-right shrink-0 ml-2">
                  <span className="text-sm font-medium text-amber-600">
                    {t.avgRounds} rounds
                  </span>
                  <span className="text-xs text-gray-400 ml-1">
                    ({t.count})
                  </span>
                </div>
              </div>
            ))}
            {data.insights.complexTopics.length === 0 && (
              <p className="text-sm text-gray-400">No data yet</p>
            )}
          </InsightCard>

          {/* Weekly Trend */}
          <InsightCard title="Weekly Trend">
            <WeeklyTrendChart data={data.insights.weeklyTrend} />
          </InsightCard>

          {/* Knowledge Coverage */}
          <InsightCard
            title="Knowledge Coverage"
            subtitle="Memory entries by category"
          >
            {data.insights.knowledgeCoverage.length > 0 ? (
              <>
                {data.insights.knowledgeCoverage.map((k) => (
                  <div
                    key={k.category}
                    className="flex items-center justify-between py-1.5"
                  >
                    <p className="text-sm text-gray-700">
                      {KNOWLEDGE_CATEGORIES[k.category] || k.category}
                    </p>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-sm font-medium text-violet-600">
                        {k.entryCount}
                      </span>
                      <span className="text-xs text-gray-400 ml-1">
                        ({k.totalHits} hits)
                      </span>
                    </div>
                  </div>
                ))}
                <Link
                  href="/memory"
                  className="block text-xs text-violet-600 hover:text-violet-800 mt-2"
                >
                  Manage memory →
                </Link>
              </>
            ) : (
              <div>
                <p className="text-sm text-gray-400 mb-2">
                  No knowledge entries yet
                </p>
                <Link
                  href="/memory"
                  className="text-xs text-violet-600 hover:text-violet-800"
                >
                  Add knowledge entries →
                </Link>
              </div>
            )}
          </InsightCard>

          {/* Missing Knowledge */}
          {data.insights.errorTopics.length > 0 && (
            <InsightCard
              title="Missing Knowledge"
              subtitle="Error topics that could benefit from memory entries"
            >
              {data.insights.errorTopics.slice(0, 3).map((t) => (
                <div
                  key={t.topic}
                  className="flex items-center justify-between py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <p className="text-sm text-gray-700 truncate">{t.topic}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 ml-2">
                    {t.errorCount} errors
                  </span>
                </div>
              ))}
              <Link
                href="/memory"
                className="block text-xs text-violet-600 hover:text-violet-800 mt-2"
              >
                Add knowledge to reduce errors →
              </Link>
            </InsightCard>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

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

function InsightCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
        {title}
      </h3>
      {subtitle && (
        <p className="text-[10px] text-gray-400 mb-2">{subtitle}</p>
      )}
      {!subtitle && <div className="mb-2" />}
      {children}
    </div>
  );
}

function WeeklyTrendChart({
  data,
}: {
  data: { week: string; topic: string; count: number }[];
}) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No trend data yet</p>;
  }

  // Group by week
  const weeks: Record<string, Record<string, number>> = {};
  let maxWeekTotal = 0;

  for (const d of data) {
    const w = d.week;
    if (!weeks[w]) weeks[w] = {};
    weeks[w][d.topic] = (weeks[w][d.topic] || 0) + d.count;
  }

  const sortedWeeks = Object.keys(weeks).sort();
  for (const w of sortedWeeks) {
    const total = Object.values(weeks[w]).reduce((s, v) => s + v, 0);
    if (total > maxWeekTotal) maxWeekTotal = total;
  }

  // Collect unique topics
  const allTopics = [...new Set(data.map((d) => d.topic))];

  return (
    <div className="space-y-1.5">
      {sortedWeeks.slice(-8).map((w) => {
        const weekData = weeks[w];
        const total = Object.values(weekData).reduce((s, v) => s + v, 0);
        const weekLabel = new Date(w).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        return (
          <div key={w} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 w-12 shrink-0">
              {weekLabel}
            </span>
            <div className="flex-1 h-4 bg-gray-50 rounded overflow-hidden flex">
              {allTopics.map((topic) => {
                const count = weekData[topic] || 0;
                if (count === 0) return null;
                const pct = (count / maxWeekTotal) * 100;
                const cat = topicCategory(topic);
                const color = CATEGORY_COLORS[cat] || "#6b7280";
                return (
                  <div
                    key={topic}
                    className="h-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                    title={`${topic}: ${count}`}
                  />
                );
              })}
            </div>
            <span className="text-[10px] text-gray-400 w-6 text-right">
              {total}
            </span>
          </div>
        );
      })}
    </div>
  );
}
