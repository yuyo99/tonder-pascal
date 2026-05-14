"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Profile {
  id: number;
  business_id: number;
  merchant_name: string;
  one_liner: string | null;
  integration_model: string | null;
  active_products: string[];
  account_manager: string | null;
  primary_contacts: Array<{ name: string; role?: string; email?: string; slack?: string }>;
  quirks: string | null;
  recurring_issues: string | null;
  tone_preference: string | null;
  notes: string | null;
  updated_at: string;
}

interface MissingMerchant {
  business_id: number;
  suggested_name: string;
  channel_count: number;
}

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [missing, setMissing] = useState<MissingMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profiles");
      const data = await res.json();
      setProfiles(data.profiles || []);
      setMissing(data.missing || []);
    } catch {
      setProfiles([]);
      setMissing([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = profiles.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.merchant_name.toLowerCase().includes(q) ||
      String(p.business_id).includes(q) ||
      (p.one_liner ?? "").toLowerCase().includes(q) ||
      (p.account_manager ?? "").toLowerCase().includes(q)
    );
  });

  const lastUpdatedAt = profiles
    .map((p) => new Date(p.updated_at).getTime())
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <>
      <PageHeader
        title="Profiles"
        subtitle="Per-merchant context Pascal sees in every response"
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total profiles" value={profiles.length} delay={1} />
        <KpiCard
          label="Missing profiles"
          value={missing.length}
          delay={2}
          tone={missing.length > 0 ? "danger" : "neutral"}
        />
        <KpiCard
          label="Last updated"
          value={lastUpdatedAt > 0 ? timeAgo(new Date(lastUpdatedAt).toISOString()) : "—"}
          delay={3}
        />
      </div>

      {/* Missing banner */}
      {missing.length > 0 && (
        <div className="t-card mb-6 !p-4 fade-in d4 border-red-200" style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca" }}>
          <div className="flex items-start gap-3">
            <span className="t-badge t-badge-red mt-0.5">{missing.length} missing</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800 mb-1">
                {missing.length === 1 ? "One merchant has" : `${missing.length} merchants have`} no profile yet
              </p>
              <p className="text-xs text-red-700 mb-3">
                Pascal answers their channels without descriptive context (account manager, quirks, tone). Add profiles to give every response richer grounding.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missing.slice(0, 12).map((m) => (
                  <Link
                    key={m.business_id}
                    href={`/profiles/${m.business_id}?name=${encodeURIComponent(m.suggested_name)}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-red-200 rounded-md text-[12px] text-red-700 hover:border-red-300 hover:bg-red-50 font-medium"
                  >
                    {m.suggested_name}
                    <span className="text-red-400 font-mono">#{m.business_id}</span>
                  </Link>
                ))}
                {missing.length > 12 && (
                  <span className="text-xs text-red-500 px-2 py-1">+{missing.length - 12} more</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search merchant name, business_id, or account manager…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input w-full !py-[7px]"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="t-card text-center py-12">
          <h2 className="text-sm font-semibold text-gray-900">No profiles match</h2>
          <p className="text-xs text-gray-400 mt-1">
            {profiles.length === 0
              ? "Day-one profiles seed on Pascal boot. If nothing appears, the migration may not have run yet."
              : "Try clearing the search."}
          </p>
        </div>
      ) : (
        <div className="t-card t-card-flush overflow-hidden fade-in d5">
          <div className="overflow-x-auto">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Summary</th>
                  <th>Integration</th>
                  <th>Products</th>
                  <th>Account manager</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/profiles/${p.business_id}`}
                        className="text-gray-900 hover:text-violet-600 font-semibold"
                      >
                        {p.merchant_name}
                      </Link>
                      <p className="text-[11px] text-gray-400 font-mono mt-0.5">#{p.business_id}</p>
                    </td>
                    <td className="max-w-[320px] text-gray-700">
                      <span className="truncate block">{p.one_liner ?? <span className="text-gray-300">no one-liner</span>}</span>
                    </td>
                    <td>
                      {p.integration_model ? (
                        <span className="t-badge t-badge-violet">{p.integration_model}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td>
                      {p.active_products.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {p.active_products.slice(0, 3).map((prod) => (
                            <span key={prod} className="t-badge t-badge-gray text-[10px] !px-1.5">
                              {prod}
                            </span>
                          ))}
                          {p.active_products.length > 3 && (
                            <span className="text-[10px] text-gray-400">+{p.active_products.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="text-gray-700 text-[13px]">
                      {p.account_manager ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="text-gray-500 text-[13px]">{timeAgo(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Bits ──────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  delay,
  tone,
}: {
  label: string;
  value: number | string;
  delay: number;
  tone?: "danger" | "neutral";
}) {
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p
        className={`text-[var(--text-metric)] font-semibold leading-tight mt-1 ${
          tone === "danger" ? "text-red-700" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
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
