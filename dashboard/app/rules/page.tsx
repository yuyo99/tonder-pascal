"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────────── */

type RuleType = "behavioral" | "parsing" | "escalation" | "tone";
type RuleScope = "global" | "merchant" | "channel" | "bot";
type RulePriority = "hard" | "soft";

interface BusinessRule {
  id: number;
  rule_type: RuleType;
  scope: RuleScope;
  scope_value: string | null;
  instruction: string;
  predicate: Record<string, unknown> | null;
  priority: RulePriority;
  source: string;
  source_ref: string | null;
  confidence: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  last_applied_at: string | null;
  apply_count: number;
}

interface Application {
  id: number;
  conversation_id: string;
  phase: string;
  outcome: string;
  applied_at: string;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const RULE_TYPES: { value: RuleType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "behavioral", label: "Behavioral" },
  { value: "parsing", label: "Parsing" },
  { value: "escalation", label: "Escalation" },
  { value: "tone", label: "Tone" },
];

const SCOPES: { value: RuleScope | ""; label: string }[] = [
  { value: "", label: "All scopes" },
  { value: "global", label: "Global" },
  { value: "merchant", label: "Merchant" },
  { value: "channel", label: "Channel" },
  { value: "bot", label: "Bot" },
];

const RULE_TYPE_BADGE: Record<RuleType, string> = {
  behavioral: "t-badge-violet",
  parsing: "t-badge-blue",
  escalation: "t-badge-amber",
  tone: "t-badge-gray",
};

const PHASE_BADGE: Record<string, string> = {
  gate: "t-badge-violet",
  refine: "t-badge-blue",
  generate: "t-badge-gray",
  validate: "t-badge-amber",
};

const OUTCOME_BADGE: Record<string, string> = {
  applied: "t-badge-emerald",
  blocked: "t-badge-red",
  triggered_regen: "t-badge-amber",
  no_effect: "t-badge-gray",
};

const emptyForm = {
  rule_type: "behavioral" as RuleType,
  scope: "channel" as RuleScope,
  scope_value: "",
  instruction: "",
  priority: "soft" as RulePriority,
  predicate_json: "",
  created_by: "",
};

/* ─── Page ──────────────────────────────────────────────────────────── */

// Next.js App Router requires useSearchParams to be wrapped in Suspense,
// otherwise the whole page bails out of client-side navigation. Thin
// wrapper to keep the body cleaner.
export default function RulesPageWrapper() {
  return (
    <Suspense fallback={null}>
      <RulesPage />
    </Suspense>
  );
}

function RulesPage() {
  const searchParams = useSearchParams();
  const editDeepLink = searchParams.get("edit");

  // Default filters: when /rules is opened with ?edit=N from the Proposed
  // Rules tab, show all rules (including inactive) so the target row is
  // visible. Otherwise default to active-only.
  const defaultActive = editDeepLink ? "" : "true";

  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ rule_type: "", scope: "", active: defaultActive });
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.rule_type) params.set("rule_type", filters.rule_type);
    if (filters.scope) params.set("scope", filters.scope);
    if (filters.active === "true" || filters.active === "false") params.set("active", filters.active);
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/rules?${params}`);
      const data = await res.json();
      setRules(data.rules || []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [filters, search]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Deep-link: when /rules is opened with ?edit=<id> (from the Proposed
  // Rules tab in /training), find that rule once it loads and open the
  // edit modal automatically. Single-shot — we only do this on the first
  // load that includes the target rule.
  useEffect(() => {
    if (!editDeepLink || rules.length === 0 || showModal) return;
    const target = rules.find((r) => String(r.id) === editDeepLink);
    if (target) {
      openEdit(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDeepLink, rules.length]);

  const stats = {
    total: rules.length,
    hard: rules.filter((r) => r.priority === "hard" && r.active).length,
    auto: rules.filter((r) => r.source.startsWith("auto:")).length,
    fired: rules.reduce((s, r) => s + r.apply_count, 0),
  };

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  }

  function openEdit(rule: BusinessRule) {
    setEditingId(rule.id);
    setForm({
      rule_type: rule.rule_type,
      scope: rule.scope,
      scope_value: rule.scope_value ?? "",
      instruction: rule.instruction,
      priority: rule.priority,
      predicate_json: rule.predicate ? JSON.stringify(rule.predicate, null, 2) : "",
      created_by: rule.created_by ?? "",
    });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);

    let predicate: unknown = null;
    if (form.predicate_json.trim()) {
      try {
        predicate = JSON.parse(form.predicate_json);
      } catch {
        setError("Predicate must be valid JSON");
        setSaving(false);
        return;
      }
    }

    const payload = {
      rule_type: form.rule_type,
      scope: form.scope,
      scope_value: form.scope === "global" ? null : form.scope_value.trim() || null,
      instruction: form.instruction.trim(),
      priority: form.priority,
      predicate,
      created_by: form.created_by.trim() || null,
    };

    try {
      const res = await fetch(
        editingId ? `/api/rules/${editingId}` : "/api/rules",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      setShowModal(false);
      fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: number, currentActive: boolean) {
    await fetch(`/api/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !currentActive }),
    });
    fetchRules();
  }

  async function handleDelete(id: number) {
    if (!confirm("Soft-delete this rule? (Sets active=false; row preserved for audit trail.)")) return;
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    fetchRules();
  }

  async function toggleApplications(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setApplications([]);
    setAppsLoading(true);
    try {
      const res = await fetch(`/api/rules/${id}/applications?limit=20`);
      const data = await res.json();
      setApplications(data.applications || []);
    } finally {
      setAppsLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Rules"
        subtitle="Persistent directives Pascal follows · auto-loaded at the gate + injected into every system prompt"
        right={
          <button onClick={openAdd} className="filter-btn active">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add rule
          </button>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="t-card fade-in d1">
          <p className="text-sm font-medium text-gray-500">Total rules</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{stats.total}</p>
        </div>
        <div className="t-card fade-in d2">
          <p className="text-sm font-medium text-gray-500">Hard · active</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{stats.hard}</p>
        </div>
        <div className="t-card fade-in d3">
          <p className="text-sm font-medium text-gray-500">Auto-extracted</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{stats.auto}</p>
        </div>
        <div className="t-card fade-in d4">
          <p className="text-sm font-medium text-gray-500">Times fired</p>
          <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{stats.fired.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={filters.rule_type}
          onChange={(e) => setFilters({ ...filters, rule_type: e.target.value })}
          className="form-input !py-[7px] !px-3 w-auto text-sm"
        >
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={filters.scope}
          onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
          className="form-input !py-[7px] !px-3 w-auto text-sm"
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select
          value={filters.active}
          onChange={(e) => setFilters({ ...filters, active: e.target.value })}
          className="form-input !py-[7px] !px-3 w-auto text-sm"
        >
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="">All</option>
        </select>
        <input
          type="text"
          placeholder="Search instruction…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input flex-1 min-w-[240px] !py-[7px]"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : rules.length === 0 ? (
        <div className="t-card text-center py-12">
          <h2 className="text-sm font-semibold text-gray-900">No rules match these filters</h2>
          <p className="text-xs text-gray-400 mt-1">
            Clear filters above or add a rule to teach Pascal how to behave for this scope.
          </p>
        </div>
      ) : (
        <div className="t-card t-card-flush overflow-hidden fade-in d5">
          <div className="overflow-x-auto">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Scope</th>
                  <th>Instruction</th>
                  <th>Priority</th>
                  <th>Source</th>
                  <th className="num">Fired</th>
                  <th>Last fired</th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    expanded={expandedId === r.id}
                    applications={expandedId === r.id ? applications : []}
                    appsLoading={expandedId === r.id && appsLoading}
                    onToggleExpand={() => toggleApplications(r.id)}
                    onEdit={() => openEdit(r)}
                    onToggle={() => handleToggle(r.id, r.active)}
                    onDelete={() => handleDelete(r.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay open" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-[15px] font-semibold text-gray-900">
                {editingId ? "Edit rule" : "Add rule"}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {editingId
                  ? `Updating rule #${editingId}. Changes take effect on the next message.`
                  : "Pascal will apply this rule the next time a message matches its scope."}
              </p>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
                  {error}
                </div>
              )}

              <Field label="Rule type" required>
                <select
                  value={form.rule_type}
                  onChange={(e) => setForm({ ...form, rule_type: e.target.value as RuleType })}
                  className="form-input"
                >
                  {RULE_TYPES.filter((t) => t.value).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Scope" required>
                  <select
                    value={form.scope}
                    onChange={(e) => setForm({ ...form, scope: e.target.value as RuleScope })}
                    className="form-input"
                  >
                    {SCOPES.filter((s) => s.value).map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Scope value"
                  hint={form.scope === "global" ? "n/a" : form.scope === "channel" ? "channel id" : form.scope === "merchant" ? "business id" : "bot id"}
                  required={form.scope !== "global"}
                >
                  <input
                    type="text"
                    value={form.scope_value}
                    onChange={(e) => setForm({ ...form, scope_value: e.target.value })}
                    placeholder={form.scope === "global" ? "(leave blank)" : "e.g. -1002589749469"}
                    disabled={form.scope === "global"}
                    className="form-input font-mono text-[13px] disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </Field>
              </div>

              <Field label="Instruction" required hint="natural language directive for Pascal">
                <textarea
                  value={form.instruction}
                  onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                  rows={4}
                  placeholder="e.g. Do not respond to messages in this channel unless the message explicitly tags @Pascal."
                  className="form-input resize-y"
                />
              </Field>

              <Field label="Priority" required hint="hard = absolute, enforced at gate + validate; soft = strong preference">
                <div className="flex items-center gap-2">
                  {(["hard", "soft"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm({ ...form, priority: p })}
                      className={`filter-btn ${form.priority === p ? "active" : ""}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label="Predicate"
                hint='optional · structured check used by Phase 0 / Phase 5 · JSON e.g. {"type":"require_mention","tags":["@pascal"]}'
              >
                <textarea
                  value={form.predicate_json}
                  onChange={(e) => setForm({ ...form, predicate_json: e.target.value })}
                  rows={3}
                  placeholder='{"type": "require_mention", "tags": ["@pascal", "@Pascal"]}'
                  className="form-input resize-y font-mono text-[12px]"
                />
              </Field>

              <Field label="Created by" hint="optional · your name or handle">
                <input
                  type="text"
                  value={form.created_by}
                  onChange={(e) => setForm({ ...form, created_by: e.target.value })}
                  placeholder="yuyo"
                  className="form-input"
                />
              </Field>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="filter-btn">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={
                  saving ||
                  !form.instruction.trim() ||
                  (form.scope !== "global" && !form.scope_value.trim())
                }
                className="inline-flex items-center gap-2 px-4 py-[7px] bg-violet-600 text-white text-sm font-medium rounded-md hover:bg-violet-700 transition disabled:bg-violet-300 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : editingId ? "Update rule" : "Create rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Rule Row ──────────────────────────────────────────────────────── */

function RuleRow({
  rule,
  expanded,
  applications,
  appsLoading,
  onToggleExpand,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: BusinessRule;
  expanded: boolean;
  applications: Application[];
  appsLoading: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <span className={`t-badge ${RULE_TYPE_BADGE[rule.rule_type]}`}>{rule.rule_type}</span>
        </td>
        <td>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-gray-500 uppercase tracking-wider">{rule.scope}</span>
            {rule.scope_value && (
              <code className="font-mono text-[11px] text-gray-600 truncate max-w-[160px]">
                {rule.scope_value}
              </code>
            )}
          </div>
        </td>
        <td className="max-w-[440px]">
          <p className="text-gray-900 truncate">{rule.instruction}</p>
          {rule.predicate && (
            <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">
              {JSON.stringify(rule.predicate)}
            </p>
          )}
        </td>
        <td>
          <span className={`t-badge ${rule.priority === "hard" ? "t-badge-red" : "t-badge-gray"}`}>
            {rule.priority}
          </span>
        </td>
        <td>
          <span className="text-xs text-gray-500">
            {rule.source.startsWith("auto:") ? (
              <span className="t-badge t-badge-amber">{rule.source}</span>
            ) : (
              <span className="text-gray-400">{rule.source}</span>
            )}
          </span>
        </td>
        <td className="num">
          {rule.apply_count > 0 ? (
            <button onClick={onToggleExpand} className="text-violet-600 hover:text-violet-700 font-medium text-sm">
              {rule.apply_count.toLocaleString()} ↗
            </button>
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </td>
        <td className="text-gray-500 text-[13px]">
          {rule.last_applied_at ? timeAgo(rule.last_applied_at) : <span className="text-gray-300">never</span>}
        </td>
        <td>
          <button
            onClick={onToggle}
            className={`t-badge ${rule.active ? "t-badge-emerald" : "t-badge-gray"} hover:opacity-80 cursor-pointer`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${rule.active ? "bg-emerald-500" : "bg-gray-400"}`} />
            {rule.active ? "active" : "inactive"}
          </button>
        </td>
        <td className="num">
          <div className="inline-flex items-center gap-1.5">
            <button onClick={onEdit} className="text-xs text-gray-500 hover:text-violet-600 font-medium">
              Edit
            </button>
            <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-600">
              Delete
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={9} className="!p-0">
            <div className="bg-violet-50/40 border-t border-violet-100 px-6 py-4">
              <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-2">
                Recent applications · last 20
              </p>
              {appsLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : applications.length === 0 ? (
                <p className="text-sm text-gray-400">No applications yet.</p>
              ) : (
                <div className="space-y-1">
                  {applications.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 text-[13px]">
                      <span className={`t-badge ${PHASE_BADGE[a.phase] ?? "t-badge-gray"} !text-[10px]`}>
                        {a.phase}
                      </span>
                      <span className={`t-badge ${OUTCOME_BADGE[a.outcome] ?? "t-badge-gray"} !text-[10px]`}>
                        {a.outcome}
                      </span>
                      <code className="font-mono text-[11px] text-gray-500 flex-1 truncate">
                        {a.conversation_id}
                      </code>
                      <span className="text-gray-400 text-[11px]">{timeAgo(a.applied_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
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
    <div>
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

/* ─── Helpers ───────────────────────────────────────────────────────── */

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
