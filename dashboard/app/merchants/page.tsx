"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

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
  integration_model: string;
  active_products: string[];
  stage_email: string;
  production_email: string;
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

        const allIds = [...new Set(list.flatMap((m) => m.business_ids))];
        if (allIds.length > 0) {
          try {
            const r = await fetch(`/api/merchants/businesses/resolve?ids=${allIds.join(",")}`);
            const res = await r.json();
            setBizNames(res.names || {});
          } catch {
            /* no-op */
          }
        }
      })
      .catch(() => setMerchants([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = merchants.filter((m) => filter === "all" || m.platform === filter);
  const totals = {
    all: merchants.length,
    slack: merchants.filter((m) => m.platform === "slack").length,
    telegram: merchants.filter((m) => m.platform === "telegram").length,
  };

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
    <>
      <PageHeader
        title="Merchants"
        subtitle="Manage merchant channel configurations"
        right={
          <Link href="/merchants/new" className="filter-btn active">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add merchant
          </Link>
        }
      />

      {/* Platform filter — status-tab style with counts */}
      <div className="flex items-center gap-0 border-b border-gray-200 mb-4">
        {(["all", "slack", "telegram"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`status-tab ${filter === f ? "active" : ""}`}
          >
            {f === "all" ? "All" : f === "slack" ? "Slack" : "Telegram"}
            <span className="count">{totals[f]}</span>
          </button>
        ))}
      </div>

      <div className="t-card t-card-flush overflow-hidden fade-in d1">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">No merchants found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Platform</th>
                  <th>Channel</th>
                  <th>Businesses</th>
                  <th>Integration</th>
                  <th>Emails</th>
                  <th className="num">Bots</th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/merchants/${m.id}`} className="font-semibold text-gray-900 hover:text-pascal-600">
                        {m.label}
                      </Link>
                    </td>
                    <td>
                      <span className={`t-badge ${m.platform === "slack" ? "t-badge-violet" : "t-badge-blue"}`}>
                        {m.platform === "slack" ? "#" : "@"} {m.platform}
                      </span>
                    </td>
                    <td className="mono">{m.channel_id}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {m.business_ids.map((bid) => (
                          <span key={bid} className="inline-flex flex-col px-2 py-1 bg-pascal-50 text-pascal-700 text-[11px] rounded-md font-medium leading-tight">
                            <span>{bizNames[String(bid)] || `Business ${bid}`}</span>
                            <span className="text-[10px] text-pascal-400 font-normal">ID: {bid}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {m.integration_model ? (
                        <div>
                          <span className="t-badge t-badge-blue">{m.integration_model}</span>
                          {m.active_products?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {m.active_products.map((p) => (
                                <span key={p} className="t-badge t-badge-gray text-[10px] !px-1.5">
                                  {p}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td>
                      {m.stage_email || m.production_email ? (
                        <div className="space-y-0.5">
                          {m.stage_email && (
                            <div className="text-[12px] text-gray-500">
                              <span className="text-gray-400 mr-1">STG</span>{m.stage_email}
                            </div>
                          )}
                          {m.production_email && (
                            <div className="text-[12px] text-gray-500">
                              <span className="text-gray-400 mr-1">PRD</span>{m.production_email}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="num text-gray-900 font-medium">{m.partner_bots?.length || 0}</td>
                    <td>
                      <button
                        onClick={() => toggleActive(m.id, m.is_active)}
                        className={`t-badge ${m.is_active ? "t-badge-emerald" : "t-badge-amber"} hover:opacity-80 cursor-pointer`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${m.is_active ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {m.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="num">
                      <Link href={`/merchants/${m.id}`} className="text-pascal-600 hover:text-pascal-700 text-xs font-medium">
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
    </>
  );
}
