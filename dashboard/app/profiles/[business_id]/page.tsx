"use client";

import { useEffect, useState, useCallback, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Contact {
  name: string;
  role?: string;
  email?: string;
  slack?: string;
}

interface Profile {
  id?: number;
  business_id: number;
  merchant_name: string;
  one_liner: string | null;
  integration_model: string | null;
  active_products: string[];
  account_manager: string | null;
  primary_contacts: Contact[];
  quirks: string | null;
  recurring_issues: string | null;
  tone_preference: string | null;
  recent_history_summary: string | null;
  recent_history_updated_at: string | null;
  notes: string | null;
  created_by: string | null;
  updated_at?: string;
}

const INTEGRATION_OPTIONS = [
  { value: "", label: "(not set)" },
  { value: "direct", label: "Direct API" },
  { value: "sdk", label: "SDK" },
  { value: "hosted_checkout", label: "Hosted Checkout" },
  { value: "partner_bot", label: "Partner bot" },
  { value: "no_code", label: "No-code / plugin" },
];

/* ─── Outer wrapper for Suspense (useSearchParams needs it) ────────── */

export default function ProfileEditorPage({
  params,
}: {
  params: Promise<{ business_id: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}>
      <ProfileEditor params={params} />
    </Suspense>
  );
}

/* ─── Editor ────────────────────────────────────────────────────────── */

function ProfileEditor({
  params,
}: {
  params: Promise<{ business_id: string }>;
}) {
  const { business_id } = use(params);
  const businessId = parseInt(business_id, 10);
  const searchParams = useSearchParams();
  const suggestedName = searchParams.get("name");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${businessId}`);
      if (res.status === 404) {
        // Create a blank profile shell for new entries
        setIsNew(true);
        setProfile({
          business_id: businessId,
          merchant_name: suggestedName ?? "",
          one_liner: null,
          integration_model: null,
          active_products: [],
          account_manager: null,
          primary_contacts: [],
          quirks: null,
          recurring_issues: null,
          tone_preference: null,
          recent_history_summary: null,
          recent_history_updated_at: null,
          notes: null,
          created_by: null,
        });
      } else if (res.ok) {
        const data = await res.json();
        setIsNew(false);
        setProfile(data);
      } else {
        const err = await res.json();
        setError(err.error || "Failed to load profile");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [businessId, suggestedName]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSave() {
    if (!profile) return;
    if (!profile.merchant_name.trim()) {
      setError("Merchant name is required");
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${businessId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      const updated = await res.json();
      setProfile(updated);
      setIsNew(false);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function addContact() {
    update("primary_contacts", [...(profile?.primary_contacts ?? []), { name: "" }]);
  }
  function updateContact(idx: number, patch: Partial<Contact>) {
    if (!profile) return;
    const next = [...profile.primary_contacts];
    next[idx] = { ...next[idx], ...patch };
    update("primary_contacts", next);
  }
  function removeContact(idx: number) {
    if (!profile) return;
    update("primary_contacts", profile.primary_contacts.filter((_, i) => i !== idx));
  }

  if (loading || !profile) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Loading…" />
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={profile.merchant_name || `Business #${businessId}`}
        subtitle={`Merchant profile · business_id #${businessId}${isNew ? " · new" : ""}`}
        right={
          <Link href="/profiles" className="filter-btn">
            ← All profiles
          </Link>
        }
      />

      {error && (
        <div className="t-card mb-4 !p-3 border-red-200" style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca" }}>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Left: editor (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Identity */}
          <div className="t-card fade-in d1">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Identity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="business_id">
                <input
                  type="text"
                  value={businessId}
                  disabled
                  className="form-input bg-gray-50 text-gray-400 font-mono"
                />
              </Field>
              <Field label="Merchant name" required>
                <input
                  type="text"
                  value={profile.merchant_name}
                  onChange={(e) => update("merchant_name", e.target.value)}
                  placeholder="e.g. Stadiobet"
                  className="form-input"
                />
              </Field>
            </div>
            <Field label="One-liner" hint="short summary, shows up first in Pascal's prompt">
              <input
                type="text"
                value={profile.one_liner ?? ""}
                onChange={(e) => update("one_liner", e.target.value || null)}
                placeholder="e.g. Sports betting operator — SPEI primary, mid-tier volume"
                className="form-input"
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Field label="Integration model">
                <select
                  value={profile.integration_model ?? ""}
                  onChange={(e) => update("integration_model", e.target.value || null)}
                  className="form-input"
                >
                  {INTEGRATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Active products" hint="comma-separated · cards, spei, oxxopay, mercadopago">
                <input
                  type="text"
                  value={profile.active_products.join(", ")}
                  onChange={(e) =>
                    update(
                      "active_products",
                      e.target.value
                        .split(",")
                        .map((p) => p.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="cards, spei"
                  className="form-input"
                />
              </Field>
            </div>
          </div>

          {/* People */}
          <div className="t-card fade-in d2">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">People</h3>
            <Field label="Tonder account manager" hint="name only">
              <input
                type="text"
                value={profile.account_manager ?? ""}
                onChange={(e) => update("account_manager", e.target.value || null)}
                placeholder="e.g. Roberto Cárdenas"
                className="form-input"
              />
            </Field>
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Primary contacts (merchant side)
                </label>
                <button
                  onClick={addContact}
                  className="text-xs text-violet-600 hover:text-violet-700 font-medium"
                >
                  + Add contact
                </button>
              </div>
              {profile.primary_contacts.length === 0 ? (
                <p className="text-xs text-gray-400">No contacts yet</p>
              ) : (
                <div className="space-y-2">
                  {profile.primary_contacts.map((c, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => updateContact(i, { name: e.target.value })}
                        placeholder="Name"
                        className="form-input col-span-3 !py-1.5 text-[13px]"
                      />
                      <input
                        type="text"
                        value={c.role ?? ""}
                        onChange={(e) => updateContact(i, { role: e.target.value || undefined })}
                        placeholder="Role"
                        className="form-input col-span-3 !py-1.5 text-[13px]"
                      />
                      <input
                        type="text"
                        value={c.email ?? ""}
                        onChange={(e) => updateContact(i, { email: e.target.value || undefined })}
                        placeholder="Email"
                        className="form-input col-span-3 !py-1.5 text-[13px]"
                      />
                      <input
                        type="text"
                        value={c.slack ?? ""}
                        onChange={(e) => updateContact(i, { slack: e.target.value || undefined })}
                        placeholder="Slack handle"
                        className="form-input col-span-2 !py-1.5 text-[13px]"
                      />
                      <button
                        onClick={() => removeContact(i)}
                        className="col-span-1 text-xs text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Behavioral context */}
          <div className="t-card fade-in d3">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Behavioral context</h3>
            <Field label="Quirks" hint="integration quirks Pascal should know">
              <textarea
                value={profile.quirks ?? ""}
                onChange={(e) => update("quirks", e.target.value || null)}
                placeholder="e.g. Partner bot sends payment_customer_order_reference instead of txid."
                rows={3}
                className="form-input resize-y"
              />
            </Field>
            <Field label="Recurring issues" hint="known patterns + how to handle">
              <textarea
                value={profile.recurring_issues ?? ""}
                onChange={(e) => update("recurring_issues", e.target.value || null)}
                placeholder="e.g. SPEI cutoffs on Saturday after 5pm — wait until next business day."
                rows={3}
                className="form-input resize-y"
              />
            </Field>
            <Field label="Tone preference">
              <input
                type="text"
                value={profile.tone_preference ?? ""}
                onChange={(e) => update("tone_preference", e.target.value || null)}
                placeholder="e.g. formal Spanish, no emojis"
                className="form-input"
              />
            </Field>
          </div>

          {/* Recent activity (read-only, v2 cron writes this) */}
          <div className="t-card fade-in d4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Recent activity</h3>
            <p className="text-[11px] text-gray-400 mb-3">
              Auto-generated by Pascal · {profile.recent_history_updated_at
                ? `last updated ${timeAgo(profile.recent_history_updated_at)}`
                : "not yet populated"}
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm text-gray-600 whitespace-pre-wrap">
              {profile.recent_history_summary ?? <span className="text-gray-400 italic">(no summary yet)</span>}
            </div>
          </div>

          {/* Notes */}
          <div className="t-card fade-in d5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Notes</h3>
            <textarea
              value={profile.notes ?? ""}
              onChange={(e) => update("notes", e.target.value || null)}
              placeholder="Anything else the team should remember about this merchant"
              rows={3}
              className="form-input resize-y"
            />
          </div>

          {/* Save bar */}
          <div className="sticky bottom-0 t-card !py-3 flex items-center justify-between fade-in d6">
            <div className="text-xs text-gray-400">
              {profile.updated_at && !isNew ? `Last saved ${timeAgo(profile.updated_at)}` : "Unsaved changes"}
            </div>
            <div className="flex items-center gap-2">
              {saveMsg && (
                <span className="text-xs text-emerald-700 font-medium">{saveMsg}</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !profile.merchant_name.trim()}
                className="inline-flex items-center gap-2 px-4 py-[7px] bg-violet-600 text-white text-sm font-medium rounded-md hover:bg-violet-700 transition disabled:bg-violet-300 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : isNew ? "Create profile" : "Save changes"}
              </button>
            </div>
          </div>
        </div>

        {/* Right: preview (1 col, sticky) */}
        <div className="lg:col-span-1">
          <div className="t-card fade-in d2 lg:sticky lg:top-20">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900">Pascal preview</h3>
              <span className="t-badge t-badge-violet">live</span>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              What Pascal sees as the <code className="font-mono bg-gray-50 px-1 rounded">## Merchant Profile</code> system-prompt section
            </p>
            <pre className="text-[12px] text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 border border-gray-200 rounded-md p-3 max-h-[60vh] overflow-y-auto">
              {renderPreview(profile)}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Preview (mirror of src/core/merchant-profile.ts renderMerchantProfileSection) ── */

function renderPreview(p: Profile): string {
  const parts: string[] = [];
  if (p.one_liner) parts.push(p.one_liner);

  const integrationBits: string[] = [];
  if (p.integration_model) integrationBits.push(p.integration_model);
  if (p.active_products.length > 0)
    integrationBits.push(`products: ${p.active_products.join(", ")}`);
  if (integrationBits.length > 0)
    parts.push(`**Integration**: ${integrationBits.join(" · ")}`);

  if (p.account_manager) parts.push(`**Account manager (Tonder)**: ${p.account_manager}`);
  if (p.primary_contacts.length > 0) {
    const lines = p.primary_contacts.map((c) => {
      const meta: string[] = [];
      if (c.role) meta.push(c.role);
      if (c.email) meta.push(c.email);
      if (c.slack) meta.push(c.slack);
      return `- ${c.name}${meta.length ? ` (${meta.join(", ")})` : ""}`;
    });
    parts.push(`**Primary contacts**:\n${lines.join("\n")}`);
  }
  if (p.quirks) parts.push(`**Quirks**: ${p.quirks}`);
  if (p.recurring_issues) parts.push(`**Recurring issues**: ${p.recurring_issues}`);
  if (p.tone_preference) parts.push(`**Tone preference**: ${p.tone_preference}`);
  if (p.recent_history_summary)
    parts.push(`**Recent activity** (auto-generated): ${p.recent_history_summary}`);

  if (parts.length === 0) {
    return "(profile is empty — fill in any field to see what Pascal will see)";
  }

  return [
    "## Merchant Profile",
    "",
    parts.join("\n\n"),
    "",
    "Use this context to personalize Pascal's response. When this conflicts with the Active Rules above, the rules win.",
  ].join("\n");
}

/* ─── Field helper ──────────────────────────────────────────────────── */

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
        {required && <span className="text-violet-600 ml-0.5">*</span>}
        {hint && (
          <span className="ml-1.5 normal-case font-normal text-gray-400 tracking-normal">
            ({hint})
          </span>
        )}
      </label>
      {children}
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
