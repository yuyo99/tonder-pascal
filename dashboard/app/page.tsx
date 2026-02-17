"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  total: number;
  active: number;
  slack: number;
  telegram: number;
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then((data) => {
        const merchants = data.merchants || [];
        setStats({
          total: merchants.length,
          active: merchants.filter((m: { is_active: boolean }) => m.is_active).length,
          slack: merchants.filter((m: { platform: string }) => m.platform === "slack").length,
          telegram: merchants.filter((m: { platform: string }) => m.platform === "telegram").length,
        });
      })
      .catch(() => setStats(null));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
      <p className="mt-1 text-sm text-gray-500">
        Pascal merchant channel configuration dashboard
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Merchants" value={stats?.total} color="violet" />
        <StatCard label="Active" value={stats?.active} color="emerald" />
        <StatCard label="Slack Channels" value={stats?.slack} color="blue" />
        <StatCard label="Telegram Groups" value={stats?.telegram} color="indigo" />
      </div>

      <div className="mt-8">
        <Link
          href="/merchants"
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Manage Merchants
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  };
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color] || colorMap.violet}`}>
      <p className="text-xs font-medium uppercase tracking-wider opacity-70">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold">
        {value !== undefined ? value : "—"}
      </p>
    </div>
  );
}
