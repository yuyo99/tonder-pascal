"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import PageHeader from "@/components/PageHeader";

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
    <>
      <PageHeader
        title="Training"
        subtitle="Teach Pascal new knowledge — entries are embedded for semantic search automatically"
      />

      <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5 w-fit mb-6">
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
            className={`t-tab ${tab === t.key ? "active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "add" && <AddEntryTab />}
      {tab === "bulk" && <BulkImportTab />}
      {tab === "gaps" && <GapQueueTab />}
    </>
  );
}

/* ─── Add Entry tab ─────────────────────────────────────────────────── */

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
          className={`mb-4 px-4 py-2.5 rounded-md text-sm font-medium border ${
            toast.startsWith("Error")
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-emerald-50 text-emerald-800 border-emerald-200"
          }`}
        >
          {toast}
        </div>
      )}

      <div className="t-card space-y-5 fade-in d1">
        <Field label="Category" required>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="form-input"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Title / question" required>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. How to handle SPEI refund requests"
            className="form-input"
          />
        </Field>

        <Field label="Content / answer" required>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="The full knowledge Pascal should use when this topic comes up…"
            rows={6}
            className="form-input resize-y"
          />
        </Field>

        <Field label="Match keywords" required hint="comma-separated">
          <input
            type="text"
            value={form.match_pattern}
            onChange={(e) => setForm({ ...form, match_pattern: e.target.value })}
            placeholder="spei, refund, reembolso, devolucion"
            className="form-input font-mono text-[13px]"
          />
          <p className="text-[11px] text-gray-400 mt-1.5">
            Fallback keywords (semantic search is primary)
          </p>
        </Field>

        <Field label="Recommended action" hint="optional">
          <textarea
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
            placeholder="What should Pascal do when this knowledge is triggered?"
            rows={2}
            className="form-input resize-y"
          />
        </Field>

        <Field label="Merchant scope" hint="optional">
          <input
            type="text"
            value={form.business_id}
            onChange={(e) => setForm({ ...form, business_id: e.target.value })}
            placeholder="Business ID, or leave blank for global"
            className="form-input"
          />
          <p className="text-[11px] text-gray-400 mt-1.5">
            Blank = available to all merchants
          </p>
        </Field>

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <PrimaryButton onClick={handleSubmit} disabled={!valid || saving}>
            {saving ? "Saving…" : "Save entry"}
          </PrimaryButton>
          <button
            onClick={() => setForm(emptyForm)}
            className="preset"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Bulk import tab ───────────────────────────────────────────────── */

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
      headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
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
    <div className="t-card fade-in d1">
      <div className="mb-4">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Upload CSV</p>
        <p className="text-[11px] text-gray-400 mb-3">
          Columns:{" "}
          <code className="bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
            category, title, content, match_pattern, action, business_id
          </code>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFile}
          className="text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-4 file:rounded-md file:border file:border-gray-200 file:text-sm file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50 file:cursor-pointer"
        />
      </div>

      {result && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-md text-sm font-medium border ${
            result.failed === 0
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-amber-50 text-amber-800 border-amber-200"
          }`}
        >
          {result.ok} entries saved, {result.failed} failed
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto -mx-6 mt-4 border-t border-gray-100">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Title</th>
                  <th>Content</th>
                  <th>Keywords</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td><span className="t-badge t-badge-violet">{row.category}</span></td>
                    <td className="text-gray-900 max-w-[220px] truncate">{row.title}</td>
                    <td className="text-gray-500 max-w-[320px] truncate">{row.content}</td>
                    <td className="text-gray-400 max-w-[180px] truncate font-mono text-[12px]">{row.match_pattern}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
            <PrimaryButton onClick={handlePublish} disabled={importing}>
              {importing ? `Publishing ${rows.length}…` : `Publish ${rows.length} entries`}
            </PrimaryButton>
            <button
              onClick={() => {
                setRows([]);
                setResult(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="preset"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Gap queue tab ─────────────────────────────────────────────────── */

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

  useEffect(() => { fetchGaps(); }, [fetchGaps]);

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
          className="text-sm text-pascal-600 hover:text-pascal-700 mb-4 inline-flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to gap queue
        </button>
        <div className="t-card !p-4 mb-4 fade-in d1" style={{ background: "#faf9ff", borderColor: "#ddd6fe" }}>
          <p className="text-[10px] font-semibold text-pascal-600 uppercase tracking-wider mb-1">Answering gap</p>
          <p className="text-sm text-gray-900">{answeringGap.question}</p>
        </div>
        <AnswerGapForm gap={answeringGap} onAnswered={handleAnswered} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-pascal-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="t-card text-center py-12 fade-in d1">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">No pending gaps</h3>
        <p className="text-xs text-gray-400">
          Pascal is handling all questions well. Gaps appear when fallback or low-confidence responses occur.
        </p>
      </div>
    );
  }

  return (
    <div className="t-card t-card-flush overflow-hidden fade-in d1">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">{gaps.length} pending gaps</p>
        <button onClick={fetchGaps} className="preset">Refresh</button>
      </div>
      <table className="t-table">
        <thead>
          <tr>
            <th>Question</th>
            <th>Category</th>
            <th>Merchant</th>
            <th className="num">Seen</th>
            <th className="num">Actions</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap) => (
            <tr key={gap.id}>
              <td className="max-w-[400px]">
                <p className="text-gray-900 truncate">{gap.question}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{new Date(gap.detected_at).toLocaleDateString()}</p>
              </td>
              <td>
                {gap.suggested_category ? (
                  <span className="t-badge t-badge-violet">{gap.suggested_category}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="text-gray-500 text-[13px]">{gap.merchant_name || "—"}</td>
              <td className="num">
                <span className={`text-sm font-medium ${gap.frequency > 3 ? "text-red-600" : "text-gray-900"}`}>
                  {gap.frequency}×
                </span>
              </td>
              <td className="num">
                <div className="inline-flex items-center gap-1.5">
                  <button
                    onClick={() => setAnsweringGap(gap)}
                    className="text-xs px-3 py-1 bg-violet-600 text-white rounded-md hover:bg-violet-700 font-medium"
                  >
                    Answer
                  </button>
                  <button
                    onClick={() => handleDismiss(gap.id)}
                    className="text-xs px-2 py-1 text-gray-400 hover:text-gray-700"
                  >
                    Dismiss
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Answer-gap form ──────────────────────────────────────────────── */

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
    <div className="t-card space-y-4 max-w-2xl">
      {toast && (
        <div className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
          {toast}
        </div>
      )}
      <Field label="Title" hint="from gap question">
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="form-input"
        />
      </Field>
      <Field label="Answer / content" required>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="Write the answer Pascal should give for this type of question…"
          rows={5}
          className="form-input resize-y"
        />
      </Field>
      <Field label="Match keywords" required>
        <input
          value={form.match_pattern}
          onChange={(e) => setForm({ ...form, match_pattern: e.target.value })}
          placeholder="comma-separated keywords"
          className="form-input font-mono text-[13px]"
        />
      </Field>
      <Field label="Category">
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="form-input"
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>
      <PrimaryButton onClick={handleSubmit} disabled={!form.content || !form.match_pattern || saving}>
        {saving ? "Saving…" : "Save entry + resolve gap"}
      </PrimaryButton>
    </div>
  );
}

/* ─── Reusable bits ─────────────────────────────────────────────────── */

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
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
        {required && <span className="text-pascal-600 ml-0.5">*</span>}
        {hint && <span className="ml-1.5 normal-case font-normal text-gray-400 tracking-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-4 py-[7px] bg-violet-600 text-white text-sm font-medium rounded-md hover:bg-violet-700 transition disabled:bg-violet-300 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
