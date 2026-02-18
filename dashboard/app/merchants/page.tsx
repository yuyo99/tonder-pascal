"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PartnerBot {
  id: number;
  username: string;
  label: string;
}

interface Merchant {
  id: number;
  label: string;
  channel_id: string;
  platform: string;
  business_ids: number[];
  is_active: boolean;
  notes: string;
  partner_bots: PartnerBot[];
}

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [bizNames, setBizNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "slack" | "telegram">("all");

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then(async (data) => {
        const list: Merchant[] = data.merchants || [];
        setMerchants(list);

        // Batch-resolve business names
        const allIds = [...new Set(list.flatMap((m) => m.business_ids))];
        if (allIds.length > 0) {
          try {
            const r = await fetch(`/api/merchants/businesses/resolve?ids=${allIds.join(",")}`);
            const res = await r.json();
            setBizNames(res.names || {});
          } catch {
            // Fallback: no names, just show IDs
          }
        }
      })
      .catch(() => setMerchants([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = merchants.filter(
    (m) => filter === "all" || m.platform === filter
  );

  async function toggleActive(id: number, currentActive: boolean) {
    await fetch(`/api/merchants/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    setMerchants((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_active: !currentActive } : m))
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Merchants</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage merchant channel configurations
          </p>
        </div>
        <Link
          href="/merchants/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Merchant
        </Link>
      </div>

      {/* Platform filter */}
      <div className="mt-6 flex gap-2">
        {(["all", "slack", "telegram"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f
                ? "bg-violet-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "all" ? "All" : f === "slack" ? "Slack" : "Telegram"}
            <span className="ml-1 opacity-70">
              ({f === "all" ? merchants.length : merchants.filter((m) => m.platform === f).length})
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            No merchants found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Label</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Platform</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Channel ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Businesses</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Bots</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/merchants/${m.id}`} className="font-semibold text-gray-900 hover:text-violet-600">
                        {m.label}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.platform === "slack"
                          ? "bg-purple-50 text-purple-700"
                          : "bg-blue-50 text-blue-700"
                      }`}>
                        {m.platform === "slack" ? "#" : "@"} {m.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {m.channel_id}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {m.business_ids.map((bid) => (
                          <span key={bid} className="inline-flex flex-col px-2 py-0.5 bg-violet-50 text-violet-700 text-xs rounded-lg font-medium">
                            <span>{bizNames[String(bid)] || `Business ${bid}`}</span>
                            <span className="text-[10px] text-violet-400 font-normal">ID: {bid}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {m.partner_bots?.length || 0}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(m.id, m.is_active)}
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                          m.is_active
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${m.is_active ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {m.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/merchants/${m.id}`}
                        className="text-violet-600 hover:text-violet-700 text-xs font-medium"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
