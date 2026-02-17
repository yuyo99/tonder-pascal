"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

interface PartnerBot {
  username: string;
  label: string;
}

interface ScheduledReport {
  report_type: string;
  is_enabled: boolean;
  cron_expr: string;
  timezone: string;
  slack_user_id: string;
}

interface Business {
  id: number;
  name: string;
}

interface FormState {
  label: string;
  channel_id: string;
  platform: "slack" | "telegram";
  business_ids: number[];
  is_active: boolean;
  notes: string;
  partner_bots: PartnerBot[];
  scheduled_reports: ScheduledReport[];
}

const emptyForm: FormState = {
  label: "",
  channel_id: "",
  platform: "slack",
  business_ids: [],
  is_active: true,
  notes: "",
  partner_bots: [],
  scheduled_reports: [
    {
      report_type: "daily_report",
      is_enabled: false,
      cron_expr: "0 9 * * *",
      timezone: "America/Mexico_City",
      slack_user_id: "",
    },
  ],
};

export default function MerchantEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";

  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Business autocomplete
  const [bizSearch, setBizSearch] = useState("");
  const [bizResults, setBizResults] = useState<Business[]>([]);
  const [bizOpen, setBizOpen] = useState(false);

  // Load existing merchant
  useEffect(() => {
    if (isNew) return;
    fetch(`/api/merchants/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.merchant) {
          const m = data.merchant;
          setForm({
            label: m.label || "",
            channel_id: m.channel_id || "",
            platform: m.platform || "slack",
            business_ids: m.business_ids || [],
            is_active: m.is_active ?? true,
            notes: m.notes || "",
            partner_bots: m.partner_bots || [],
            scheduled_reports: m.scheduled_reports?.length
              ? m.scheduled_reports
              : emptyForm.scheduled_reports,
          });
        }
      })
      .catch(() => setError("Failed to load merchant"))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // Business search
  const searchBusinesses = useCallback(async (q: string) => {
    if (q.length < 1) {
      setBizResults([]);
      return;
    }
    try {
      const r = await fetch(`/api/merchants/businesses?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      setBizResults(data.businesses || []);
    } catch {
      setBizResults([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchBusinesses(bizSearch), 300);
    return () => clearTimeout(timer);
  }, [bizSearch, searchBusinesses]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addBusinessId(bizId: number) {
    if (!form.business_ids.includes(bizId)) {
      updateField("business_ids", [...form.business_ids, bizId]);
    }
    setBizSearch("");
    setBizOpen(false);
  }

  function removeBusinessId(bizId: number) {
    updateField("business_ids", form.business_ids.filter((b) => b !== bizId));
  }

  function addPartnerBot() {
    updateField("partner_bots", [...form.partner_bots, { username: "", label: "" }]);
  }

  function updatePartnerBot(index: number, field: keyof PartnerBot, value: string) {
    const updated = [...form.partner_bots];
    updated[index] = { ...updated[index], [field]: value };
    updateField("partner_bots", updated);
  }

  function removePartnerBot(index: number) {
    updateField("partner_bots", form.partner_bots.filter((_, i) => i !== index));
  }

  function updateScheduledReport(index: number, field: keyof ScheduledReport, value: string | boolean) {
    const updated = [...form.scheduled_reports];
    updated[index] = { ...updated[index], [field]: value };
    updateField("scheduled_reports", updated);
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const url = isNew ? "/api/merchants" : `/api/merchants/${id}`;
      const method = isNew ? "POST" : "PUT";

      // Filter out empty partner bots
      const cleanBots = form.partner_bots.filter((b) => b.username.trim());

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, partner_bots: cleanBots }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }
      router.push("/merchants");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await fetch(`/api/merchants/${id}`, { method: "DELETE" });
      router.push("/merchants");
    } catch {
      setError("Delete failed");
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-gray-400">Loading...</div>;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => router.push("/merchants")}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isNew ? "Add Merchant" : "Edit Merchant"}
        </h1>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Basic Info */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Basic Info
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => updateField("label", e.target.value)}
              placeholder="e.g. Tonder Production"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
              <select
                value={form.platform}
                onChange={(e) => updateField("platform", e.target.value as "slack" | "telegram")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              >
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel ID</label>
              <input
                type="text"
                value={form.channel_id}
                onChange={(e) => updateField("channel_id", e.target.value)}
                placeholder={form.platform === "slack" ? "C0AF237ATKJ" : "-1002589749469"}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              rows={2}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateField("is_active", !form.is_active)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                form.is_active ? "bg-violet-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                  form.is_active ? "translate-x-5" : ""
                }`}
              />
            </button>
            <span className="text-sm text-gray-700">Active</span>
          </div>
        </div>
      </section>

      {/* Business IDs */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Business IDs
        </h2>

        {/* Current IDs */}
        <div className="flex flex-wrap gap-2 mb-3">
          {form.business_ids.map((bid) => (
            <span
              key={bid}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-50 text-violet-700 text-sm rounded-full font-medium"
            >
              {bid}
              <button
                onClick={() => removeBusinessId(bid)}
                className="ml-0.5 text-violet-400 hover:text-violet-600"
              >
                &times;
              </button>
            </span>
          ))}
          {form.business_ids.length === 0 && (
            <span className="text-sm text-gray-400">No business IDs added</span>
          )}
        </div>

        {/* Autocomplete */}
        <div className="relative">
          <input
            type="text"
            value={bizSearch}
            onChange={(e) => {
              setBizSearch(e.target.value);
              setBizOpen(true);
            }}
            onFocus={() => setBizOpen(true)}
            placeholder="Search businesses by name or type an ID..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && bizSearch.trim()) {
                const num = parseInt(bizSearch.trim(), 10);
                if (!isNaN(num)) {
                  addBusinessId(num);
                }
              }
            }}
          />
          {bizOpen && bizResults.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {bizResults
                .filter((b) => !form.business_ids.includes(b.id))
                .slice(0, 10)
                .map((b) => (
                  <button
                    key={b.id}
                    onClick={() => addBusinessId(b.id)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-violet-50 flex items-center justify-between"
                  >
                    <span className="text-gray-900">{b.name}</span>
                    <span className="text-gray-400 text-xs">ID: {b.id}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Search by name or type a numeric ID and press Enter
        </p>
      </section>

      {/* Partner Bots (only for Telegram) */}
      {form.platform === "telegram" && (
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Partner Bots
            </h2>
            <button
              onClick={addPartnerBot}
              className="text-xs text-violet-600 hover:text-violet-700 font-medium"
            >
              + Add Bot
            </button>
          </div>

          {form.partner_bots.length === 0 ? (
            <p className="text-sm text-gray-400">No partner bots configured</p>
          ) : (
            <div className="space-y-3">
              {form.partner_bots.map((bot, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={bot.username}
                      onChange={(e) => updatePartnerBot(i, "username", e.target.value)}
                      placeholder="username"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={bot.label}
                      onChange={(e) => updatePartnerBot(i, "label", e.target.value)}
                      placeholder="Display label"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={() => removePartnerBot(i)}
                    className="mt-2 text-gray-400 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Scheduled Reports */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Scheduled Reports
        </h2>

        {form.scheduled_reports.map((sr, i) => (
          <div key={i} className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateScheduledReport(i, "is_enabled", !sr.is_enabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  sr.is_enabled ? "bg-violet-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                    sr.is_enabled ? "translate-x-5" : ""
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700">Daily Report</span>
            </div>

            {sr.is_enabled && (
              <div className="grid grid-cols-2 gap-3 pl-12">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Cron Expression
                  </label>
                  <input
                    type="text"
                    value={sr.cron_expr}
                    onChange={(e) => updateScheduledReport(i, "cron_expr", e.target.value)}
                    placeholder="0 9 * * *"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={sr.timezone}
                    onChange={(e) => updateScheduledReport(i, "timezone", e.target.value)}
                    placeholder="America/Mexico_City"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Slack User ID (for DM delivery)
                  </label>
                  <input
                    type="text"
                    value={sr.slack_user_id}
                    onChange={(e) => updateScheduledReport(i, "slack_user_id", e.target.value)}
                    placeholder="U0123456789"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div>
          {!isNew && (
            <>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="text-sm text-red-500 hover:text-red-600 font-medium"
                >
                  Delete Merchant
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600">Are you sure?</span>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                  >
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/merchants")}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.label || !form.channel_id || form.business_ids.length === 0}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? "Saving..." : isNew ? "Create Merchant" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
