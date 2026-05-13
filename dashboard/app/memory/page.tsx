"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─── */

interface KnowledgeEntry {
  id: string;
  category: string;
  match_pattern: string;
  title: string;
  content: string;
  action: string | null;
  priority: number;
  is_active: boolean;
  hit_count: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "faq", label: "FAQ" },
  { value: "integration", label: "Integration" },
  { value: "decline_code", label: "Decline Codes" },
  { value: "payment_method", label: "Payment Methods" },
  { value: "troubleshooting", label: "Troubleshooting" },
  { value: "policy", label: "Policy" },
];

const CATEGORY_LABELS: Record<string, string> = {
  faq: "FAQ",
  integration: "Integration",
  decline_code: "Decline Code",
  payment_method: "Payment Method",
  troubleshooting: "Troubleshooting",
  policy: "Policy",
};

const CATEGORY_BADGE: Record<string, string> = {
  faq: "t-badge-violet",
  integration: "t-badge-blue",
  decline_code: "t-badge-red",
  payment_method: "t-badge-emerald",
  troubleshooting: "t-badge-amber",
  policy: "t-badge-gray",
};

const emptyForm = {
  category: "faq",
  match_pattern: "",
  title: "",
  content: "",
  action: "",
  priority: 5,
};

/* ─── Page ─── */

export default function MemoryPage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (search) params.set("search", search);
    const res = await fetch(`/api/memory?${params}`);
    const data = await res.json();
    setEntries(data.entries || []);
    setLoading(false);
  }, [category, search]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const active = entries.filter((e) => e.is_active);
  const inactive = entries.filter((e) => !e.is_active);
  const totalHits = active.reduce((s, e) => s + e.hit_count, 0);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setForm({
      category: entry.category,
      match_pattern: entry.match_pattern,
      title: entry.title,
      content: entry.content,
      action: entry.action || "",
      priority: entry.priority,
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/memory/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      setShowModal(false);
      fetchEntries();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, currentActive: boolean) {
    await fetch(`/api/memory/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    fetchEntries();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    fetchEntries();
  }

  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="Knowledge base entries — Pascal auto-injects matching entries into context"
        right={
          <button onClick={openAdd} className="filter-btn active">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add entry
          </button>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="t-card fade-in d1">
          <p className="text-sm font-medium text-gray-500">Active entries</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{active.length}</p>
        </div>
        <div className="t-card fade-in d2">
          <p className="text-sm font-medium text-gray-500">Total hits</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{totalHits.toLocaleString()}</p>
        </div>
        <div className="t-card fade-in d3">
          <p className="text-sm font-medium text-gray-500">Avg hits / entry</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">
            {active.length > 0 ? (totalHits / active.length).toFixed(1) : "0"}
          </p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`t-tab ${category === cat.value ? "active" : ""}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search patterns, titles, or content…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input flex-1 min-w-[260px] !py-[7px]"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-pascal-500 border-t-transparent rounded-full" />
        </div>
      ) : active.length === 0 && inactive.length === 0 ? (
        <div className="t-card text-center py-12">
          <h2 className="text-sm font-semibold text-gray-900">No knowledge entries yet</h2>
          <p className="text-xs text-gray-400 mt-1">Add entries to teach Pascal about FAQs, decline codes, and more.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {active.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onEdit={() => openEdit(entry)} onToggle={() => handleToggle(entry.id, entry.is_active)} />
            ))}
          </div>

          {inactive.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3"
              >
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${showInactive ? "rotate-90" : ""}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                {inactive.length} inactive {inactive.length === 1 ? "entry" : "entries"}
              </button>
              {showInactive && (
                <div className="flex flex-col gap-3 opacity-60">
                  {inactive.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      onEdit={() => openEdit(entry)}
                      onToggle={() => handleToggle(entry.id, entry.is_active)}
                      onDelete={() => handleDelete(entry.id)}
                      dimmed
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add / Edit modal */}
      {showModal && (
        <div className="modal-overlay open" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-[15px] font-semibold text-gray-900">
                {editingId ? "Edit entry" : "Add knowledge entry"}
              </h2>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <Field label="Category">
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="form-input"
                >
                  {CATEGORIES.filter((c) => c.value).map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Match pattern" hint="comma-separated keywords">
                <input
                  type="text"
                  value={form.match_pattern}
                  onChange={(e) => setForm({ ...form, match_pattern: e.target.value })}
                  placeholder="refund, reembolso, devolucion"
                  className="form-input font-mono text-[13px]"
                />
              </Field>

              <Field label="Title">
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="How refunds work"
                  className="form-input"
                />
              </Field>

              <Field label="Content">
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={5}
                  placeholder="Detailed knowledge that Pascal will use to answer questions…"
                  className="form-input resize-y"
                />
              </Field>

              <Field label="Recommended action" hint="optional">
                <textarea
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  rows={2}
                  placeholder="Tell the merchant to contact support for manual processing…"
                  className="form-input resize-y"
                />
              </Field>

              <Field label="Priority" hint="1 = highest, 10 = lowest">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 5 })}
                  className="form-input w-24"
                />
              </Field>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="filter-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim() || !form.match_pattern.trim() || !form.content.trim()}
                className="inline-flex items-center gap-2 px-4 py-[7px] bg-violet-600 text-white text-sm font-medium rounded-md hover:bg-violet-700 transition disabled:bg-violet-300 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Field helper ─── */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
        {hint && <span className="ml-1.5 normal-case font-normal text-gray-400 tracking-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

/* ─── Entry row ─── */

function EntryRow({
  entry,
  onEdit,
  onToggle,
  onDelete,
  dimmed,
}: {
  entry: KnowledgeEntry;
  onEdit: () => void;
  onToggle: () => void;
  onDelete?: () => void;
  dimmed?: boolean;
}) {
  const badgeClass = CATEGORY_BADGE[entry.category] || "t-badge-gray";
  const catLabel = CATEGORY_LABELS[entry.category] || entry.category;

  return (
    <div className={`t-card !py-4 ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">{entry.title}</h3>
            <span className={`t-badge ${badgeClass}`}>{catLabel}</span>
            <span className="t-badge t-badge-gray">P{entry.priority}</span>
            {entry.hit_count > 0 && (
              <span className="t-badge t-badge-violet">{entry.hit_count} hits</span>
            )}
          </div>

          <div className="flex flex-wrap gap-1 mb-2">
            {entry.match_pattern.split(",").map((p, i) => (
              <code
                key={i}
                className="text-[11px] px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded text-gray-600 font-mono"
              >
                {p.trim()}
              </code>
            ))}
          </div>

          <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">{entry.content}</p>

          {entry.action && (
            <p className="text-xs text-gray-400 mt-1.5 line-clamp-1">
              <span className="font-medium text-gray-500">Action:</span> {entry.action}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <IconBtn label="Edit" onClick={onEdit} hoverColor="pascal-600 hover:bg-pascal-50">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </IconBtn>
          <IconBtn
            label={entry.is_active ? "Disable" : "Enable"}
            onClick={onToggle}
            hoverColor={entry.is_active ? "amber-600 hover:bg-amber-50" : "emerald-600 hover:bg-emerald-50"}
          >
            {entry.is_active ? (
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </>
            ) : (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </IconBtn>
          {onDelete && (
            <IconBtn label="Delete" onClick={onDelete} hoverColor="red-600 hover:bg-red-50">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  hoverColor,
  children,
}: {
  label: string;
  onClick: () => void;
  hoverColor: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 text-gray-400 hover:text-${hoverColor} rounded-md transition-colors`}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
