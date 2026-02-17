"use client";

import { useEffect, useState, useCallback } from "react";

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

const CATEGORY_COLORS: Record<string, string> = {
  faq: "bg-violet-100 text-violet-700",
  integration: "bg-blue-100 text-blue-700",
  decline_code: "bg-red-100 text-red-700",
  payment_method: "bg-emerald-100 text-emerald-700",
  troubleshooting: "bg-amber-100 text-amber-700",
  policy: "bg-gray-100 text-gray-700",
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

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

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
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Memory</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Knowledge base entries &middot; Pascal auto-injects matching entries
            into context
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Entry
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              category === cat.value
                ? "bg-white text-violet-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search patterns, titles, or content..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-gray-900">{active.length}</p>
          <p className="text-xs text-gray-400">Active Entries</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-violet-600">{totalHits}</p>
          <p className="text-xs text-gray-400">Total Hits</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-gray-900">
            {active.length > 0
              ? (totalHits / active.length).toFixed(1)
              : "0"}
          </p>
          <p className="text-xs text-gray-400">Avg Hits/Entry</p>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* Active entries */}
          {active.length === 0 && inactive.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📚</div>
              <h2 className="text-xl font-semibold text-gray-700">
                No knowledge entries yet
              </h2>
              <p className="text-gray-400 mt-2">
                Add entries to teach Pascal about FAQs, decline codes, and more.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={() => openEdit(entry)}
                  onToggle={() => handleToggle(entry.id, entry.is_active)}
                />
              ))}
            </div>
          )}

          {/* Inactive entries */}
          {inactive.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-3"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showInactive ? "rotate-90" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                {inactive.length} inactive{" "}
                {inactive.length === 1 ? "entry" : "entries"}
              </button>

              {showInactive && (
                <div className="space-y-3 opacity-60">
                  {inactive.map((entry) => (
                    <EntryCard
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? "Edit Entry" : "Add Knowledge Entry"}
              </h2>

              <div className="space-y-4">
                {/* Category */}
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Category
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  >
                    {CATEGORIES.filter((c) => c.value).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Match Pattern */}
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Match Pattern{" "}
                    <span className="normal-case text-gray-400">
                      (comma-separated keywords)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={form.match_pattern}
                    onChange={(e) =>
                      setForm({ ...form, match_pattern: e.target.value })
                    }
                    placeholder="refund, reembolso, devolucion"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 font-mono"
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="How Refunds Work"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  />
                </div>

                {/* Content */}
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Content
                  </label>
                  <textarea
                    value={form.content}
                    onChange={(e) =>
                      setForm({ ...form, content: e.target.value })
                    }
                    rows={5}
                    placeholder="Detailed knowledge that Pascal will use to answer questions..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
                  />
                </div>

                {/* Action */}
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Recommended Action{" "}
                    <span className="normal-case text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={form.action}
                    onChange={(e) =>
                      setForm({ ...form, action: e.target.value })
                    }
                    rows={2}
                    placeholder="Tell the merchant to contact support for manual processing..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Priority{" "}
                    <span className="normal-case text-gray-400">
                      (1 = highest, 10 = lowest)
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: parseInt(e.target.value) || 5 })
                    }
                    className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  />
                </div>
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={
                    saving ||
                    !form.title.trim() ||
                    !form.match_pattern.trim() ||
                    !form.content.trim()
                  }
                  className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : editingId ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Entry Card ─── */

function EntryCard({
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
  const catColor = CATEGORY_COLORS[entry.category] || "bg-gray-100 text-gray-700";
  const catLabel = CATEGORY_LABELS[entry.category] || entry.category;

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">
              {entry.title}
            </h3>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${catColor}`}
            >
              {catLabel}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
              P{entry.priority}
            </span>
            {entry.hit_count > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium">
                {entry.hit_count} hits
              </span>
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

          <p className="text-sm text-gray-600 line-clamp-2">{entry.content}</p>

          {entry.action && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-1">
              <span className="font-medium">Action:</span> {entry.action}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-md transition-colors"
            title="Edit"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={onToggle}
            className={`p-1.5 rounded-md transition-colors ${
              entry.is_active
                ? "text-gray-400 hover:text-amber-600 hover:bg-amber-50"
                : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"
            }`}
            title={entry.is_active ? "Disable" : "Enable"}
          >
            {entry.is_active ? (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title="Delete permanently"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
