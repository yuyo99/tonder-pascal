"use client";

import { useState, useCallback, useRef } from "react";

const CATEGORIES = [
  { value: "integration", label: "Integration" },
  { value: "troubleshooting", label: "Troubleshooting" },
  { value: "decline_code", label: "Decline Codes" },
  { value: "payment_method", label: "Payment Methods" },
  { value: "policy", label: "Policy" },
  { value: "faq", label: "FAQ" },
];

type Tab = "add" | "bulk" | "gaps";

interface BulkRow {
  category: string;
  title: string;
  content: string;
  match_pattern: string;
  action: string;
  business_id: string;
}

const emptyForm = {
  category: "faq",
  title: "",
  content: "",
  match_pattern: "",
  action: "",
  business_id: "",
};

export default function TrainingPage() {
  const [tab, setTab] = useState<Tab>("add");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Training</h1>
        <p className="text-sm text-gray-500 mt-1">
          Teach Pascal new knowledge. Entries are embedded for semantic search automatically.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100/80 rounded-lg p-1 w-fit mb-6">
        {(
          [
            { key: "add", label: "Add Entry" },
            { key: "bulk", label: "Bulk Import" },
            { key: "gaps", label: "Gap Queue" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === t.key
                ? "bg-white shadow-sm text-gray-900"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "add" && <AddEntryTab />}
      {tab === "bulk" && <BulkImportTab />}
      {tab === "gaps" && <GapQueueTab />}
    </div>
  );
}

// ── Add Entry Tab ──────────────────────────────────────────────────

function AddEntryTab() {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!form.title || !form.content || !form.match_pattern) return;
    setSaving(true);
    try {
      const res = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          business_id: form.business_id ? parseInt(form.business_id) : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setToast(`Error: ${err.error || "Failed to save"}`);
        return;
      }
      setForm(emptyForm);
      setToast("Entry saved + embedded successfully");
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }, [form]);

  const valid = form.title && form.content && form.match_pattern;

  return (
    <div className="max-w-2xl">
      {toast && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
            toast.startsWith("Error")
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {toast}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Category */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
            Category *
          </label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
            Title / Question *
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. How to handle SPEI refund requests"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
          />
        </div>

        {/* Content */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
            Content / Answer *
          </label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="The full knowledge Pascal should use when this topic comes up..."
            rows={6}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
          />
        </div>

        {/* Match Keywords */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
            Match Keywords *
          </label>
          <input
            type="text"
            value={form.match_pattern}
            onChange={(e) => setForm({ ...form, match_pattern: e.target.value })}
            placeholder="spei, refund, reembolso, devolucion"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Comma-separated keywords for fallback search (semantic search is primary)
          </p>
        </div>

        {/* Recommended Action */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
            Recommended Action
          </label>
          <textarea
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
            placeholder="Optional: what should Pascal do when this knowledge is triggered?"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
          />
        </div>

        {/* Merchant Scope */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
            Merchant Scope
          </label>
          <input
            type="text"
            value={form.business_id}
            onChange={(e) => setForm({ ...form, business_id: e.target.value })}
            placeholder="Leave blank for global (all merchants)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Business ID to scope this entry to a specific merchant (blank = available to all)
          </p>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={!valid || saving}
            className="px-5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save Entry"}
          </button>
          <button
            onClick={() => setForm(emptyForm)}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Import Tab ────────────────────────────────────────────────

function BulkImportTab() {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseCSV = useCallback((text: string) => {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return;

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const parsed: BulkRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || "";
      });
      parsed.push({
        category: row.category || "faq",
        title: row.title || row.question || "",
        content: row.content || row.answer || "",
        match_pattern: row.match_pattern || row.keywords || "",
        action: row.action || "",
        business_id: row.business_id || "",
      });
    }

    setRows(parsed.filter((r) => r.title && r.content));
  }, []);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        parseCSV(ev.target?.result as string);
        setResult(null);
      };
      reader.readAsText(file);
    },
    [parseCSV]
  );

  const handlePublish = useCallback(async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch("/api/training/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: rows.map((r) => ({
            ...r,
            business_id: r.business_id ? parseInt(r.business_id) : null,
          })),
        }),
      });
      const data = await res.json();
      setResult({ ok: data.ok, failed: data.failed });
      if (data.ok === rows.length) setRows([]);
    } catch {
      setResult({ ok: 0, failed: rows.length });
    } finally {
      setImporting(false);
    }
  }, [rows]);

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">
            Upload CSV
          </label>
          <p className="text-[11px] text-gray-400 mb-3">
            Columns: <code className="bg-gray-100 px-1 rounded">category, title, content, match_pattern, action, business_id</code>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            className="text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border file:border-gray-200 file:text-sm file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50 file:cursor-pointer"
          />
        </div>

        {result && (
          <div
            className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
              result.failed === 0
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}
          >
            {result.ok} entries saved, {result.failed} failed
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wider">
                    <th className="text-left py-2 px-3">Category</th>
                    <th className="text-left py-2 px-3">Title</th>
                    <th className="text-left py-2 px-3">Content</th>
                    <th className="text-left py-2 px-3">Keywords</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50/40">
                      <td className="py-2 px-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                          {row.category}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-700 max-w-[200px] truncate">
                        {row.title}
                      </td>
                      <td className="py-2 px-3 text-gray-500 max-w-[300px] truncate">
                        {row.content}
                      </td>
                      <td className="py-2 px-3 text-gray-400 max-w-[150px] truncate">
                        {row.match_pattern}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={handlePublish}
                disabled={importing}
                className="px-5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing
                  ? `Publishing ${rows.length} entries...`
                  : `Publish ${rows.length} Entries`}
              </button>
              <button
                onClick={() => {
                  setRows([]);
                  setResult(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Gap Queue Tab ──────────────────────────────────────────────────

interface Gap {
  id: string;
  question: string;
  channel_id: string | null;
  platform: string | null;
  merchant_name: string | null;
  business_id: number | null;
  frequency: number;
  status: string;
  suggested_category: string | null;
  detected_at: string;
}

function GapQueueTab() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [answeringGap, setAnsweringGap] = useState<Gap | null>(null);

  const fetchGaps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/training/gaps?status=pending");
      const data = await res.json();
      setGaps(data.gaps || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useState(() => { fetchGaps(); });

  const handleDismiss = useCallback(async (id: string) => {
    await fetch(`/api/training/gaps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    setGaps(prev => prev.filter(g => g.id !== id));
  }, []);

  const handleAnswered = useCallback(async (gapId: string) => {
    await fetch(`/api/training/gaps/${gapId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "answered" }),
    });
    setAnsweringGap(null);
    setGaps(prev => prev.filter(g => g.id !== gapId));
  }, []);

  if (answeringGap) {
    return (
      <div>
        <button
          onClick={() => setAnsweringGap(null)}
          className="text-sm text-violet-600 hover:text-violet-700 mb-4"
        >
          &larr; Back to Gap Queue
        </button>
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 mb-4">
          <p className="text-xs text-violet-500 uppercase tracking-wide mb-1">Answering gap</p>
          <p className="text-sm text-violet-900">{answeringGap.question}</p>
        </div>
        <AnswerGapForm gap={answeringGap} onAnswered={handleAnswered} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-3xl mb-3">&#x2705;</p>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">No pending gaps</h3>
        <p className="text-sm text-gray-500">
          Pascal is handling all questions well. Gaps appear when fallback or low-confidence responses occur.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{gaps.length} pending gaps</p>
        <button onClick={fetchGaps} className="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
            <th className="text-left py-2 px-5">Question</th>
            <th className="text-left py-2 px-3">Category</th>
            <th className="text-left py-2 px-3">Merchant</th>
            <th className="text-center py-2 px-3">Seen</th>
            <th className="text-right py-2 px-5">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {gaps.map((gap) => (
            <tr key={gap.id} className="hover:bg-gray-50/40">
              <td className="py-3 px-5 text-gray-700 max-w-[400px]">
                <p className="truncate">{gap.question}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {new Date(gap.detected_at).toLocaleDateString()}
                </p>
              </td>
              <td className="py-3 px-3">
                {gap.suggested_category && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                    {gap.suggested_category}
                  </span>
                )}
              </td>
              <td className="py-3 px-3 text-gray-500 text-xs">{gap.merchant_name || "—"}</td>
              <td className="py-3 px-3 text-center">
                <span className={`text-xs font-medium ${gap.frequency > 3 ? "text-red-600" : "text-gray-500"}`}>
                  {gap.frequency}x
                </span>
              </td>
              <td className="py-3 px-5 text-right">
                <button
                  onClick={() => setAnsweringGap(gap)}
                  className="text-xs px-3 py-1 bg-violet-600 text-white rounded-md hover:bg-violet-700 mr-2"
                >
                  Answer
                </button>
                <button
                  onClick={() => handleDismiss(gap.id)}
                  className="text-xs px-2 py-1 text-gray-400 hover:text-gray-600"
                >
                  Dismiss
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Answer Gap Form (pre-filled from gap question) ─────────────────

function AnswerGapForm({ gap, onAnswered }: { gap: Gap; onAnswered: (gapId: string) => Promise<void> }) {
  const [form, setForm] = useState({
    category: gap.suggested_category || "faq",
    title: gap.question.slice(0, 200),
    content: "",
    match_pattern: "",
    action: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!form.content || !form.match_pattern) return;
    setSaving(true);
    try {
      const res = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, business_id: gap.business_id || null }),
      });
      if (!res.ok) {
        setToast("Failed to save entry");
        return;
      }
      await onAnswered(gap.id);
      setToast("Entry saved + gap resolved");
    } catch {
      setToast("Network error");
    } finally {
      setSaving(false);
    }
  }, [form, gap, onAnswered]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-2xl">
      {toast && (
        <div className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          {toast}
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Title (from gap question)</label>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Answer / Content *</label>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="Write the answer Pascal should give for this type of question..."
          rows={5}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Match Keywords *</label>
        <input
          value={form.match_pattern}
          onChange={(e) => setForm({ ...form, match_pattern: e.target.value })}
          placeholder="comma-separated keywords"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Category</label>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <button
        onClick={handleSubmit}
        disabled={!form.content || !form.match_pattern || saving}
        className="px-5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving..." : "Save Entry + Resolve Gap"}
      </button>
    </div>
  );
}
