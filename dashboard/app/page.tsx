"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

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
    <>
      <PageHeader title="Overview" subtitle="Pascal merchant channel configuration dashboard" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total merchants" value={stats?.total} delay={1} />
        <StatCard label="Active" value={stats?.active} delay={2} />
        <StatCard label="Slack channels" value={stats?.slack} delay={3} />
        <StatCard label="Telegram groups" value={stats?.telegram} delay={4} />
      </div>

      <div className="mt-8">
        <Link
          href="/merchants"
          className="inline-flex items-center gap-2 px-4 py-[7px] bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          Manage merchants
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </>
  );
}

function StatCard({ label, value, delay }: { label: string; value: number | undefined; delay: number }) {
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">
        {value !== undefined ? value : "—"}
      </p>
    </div>
  );
}
