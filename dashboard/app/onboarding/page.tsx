"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ONBOARDING_PHASES,
  PRIORITY_OPTIONS,
  INTEGRATION_MODELS,
  calculateProgress,
  getCurrentPhase,
  getPhaseStatus,
  getOverallStatus,
  getEffectiveItems,
  type PhasesState,
  type PhaseDefinition,
  type CustomItem,
} from "@/lib/onboarding-phases";

/* ─── Types ─── */

interface Onboarding {
  id: number;
  name: string;
  type: "merchant" | "partner";
  owner: string;
  notes: string;
  phases: PhasesState;
  status: "not_started" | "in_progress" | "completed";
  priority: string;
  target_date: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  merchant_channel_id: number | null;
  merchant_channel_label: string | null;
  integration_model: string;
  created_at: string;
  updated_at: string;
}

interface MerchantOption {
  id: number;
  label: string;
}

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const PRIORITY_TABS = [
  { value: "", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const SORT_OPTIONS = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "target_date", label: "Target date" },
  { value: "progress", label: "Progress %" },
  { value: "priority", label: "Priority" },
];

const emptyForm = {
  name: "",
  type: "merchant" as "merchant" | "partner",
  owner: "",
  notes: "",
  priority: "normal",
  target_date: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  merchant_channel_id: null as number | null,
  integration_model: "",
};

type FormData = typeof emptyForm;

/* ─── Helpers ─── */

function daysBetween(a: string, b: Date = new Date()): number {
  return Math.floor((b.getTime() - new Date(a).getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/* ─── Page ─── */

export default function OnboardingPage() {
  const [onboardings, setOnboardings] = useState<Onboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_desc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Onboarding | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [addingToPhase, setAddingToPhase] = useState<string | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);

  /* ─── Data Fetching ─── */

  const fetchOnboardings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      const res = await fetch(`/api/onboarding?${params}`);
      const data = await res.json();
      setOnboardings(data.onboardings || []);
    } catch {
      console.error("Failed to fetch onboardings");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter]);

  useEffect(() => {
    fetchOnboardings();
  }, [fetchOnboardings]);

  // Fetch merchants for the link dropdown
  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.merchants || []).map((m: { id: number; label: string }) => ({
          id: m.id,
          label: m.label,
        }));
        setMerchants(list);
      })
      .catch(() => {});
  }, []);

  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/onboarding/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      fetchDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  /* ─── Sorted + Filtered List ─── */

  const sortedOnboardings = useMemo(() => {
    const list = [...onboardings];
    switch (sortBy) {
      case "created_asc":
        list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "target_date":
        list.sort((a, b) => {
          if (!a.target_date && !b.target_date) return 0;
          if (!a.target_date) return 1;
          if (!b.target_date) return -1;
          return new Date(a.target_date).getTime() - new Date(b.target_date).getTime();
        });
        break;
      case "progress":
        list.sort((a, b) => calculateProgress(b.phases).percentage - calculateProgress(a.phases).percentage);
        break;
      case "priority":
        list.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
        break;
      default: // created_desc
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [onboardings, sortBy]);

  /* ─── CRUD Handlers ─── */

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(ob: Onboarding) {
    setEditingId(ob.id);
    setForm({
      name: ob.name,
      type: ob.type,
      owner: ob.owner,
      notes: ob.notes,
      priority: ob.priority || "normal",
      target_date: ob.target_date ? ob.target_date.split("T")[0] : "",
      contact_name: ob.contact_name || "",
      contact_email: ob.contact_email || "",
      contact_phone: ob.contact_phone || "",
      merchant_channel_id: ob.merchant_channel_id,
      integration_model: ob.integration_model || "",
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        target_date: form.target_date || null,
        merchant_channel_id: form.merchant_channel_id || null,
      };
      if (editingId) {
        await fetch(`/api/onboarding/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setShowModal(false);
      fetchOnboardings();
      if (editingId && selectedId === editingId) {
        fetchDetail(editingId);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/onboarding/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    if (selectedId === id) {
      setSelectedId(null);
    }
    fetchOnboardings();
  }

  async function handleToggleItem(phaseId: string, itemId: string) {
    if (!detail) return;

    const currentPhases: PhasesState = JSON.parse(JSON.stringify(detail.phases));
    const phaseData = { ...(currentPhases[phaseId] || {}) };
    const isChecked = phaseData[itemId]?.checked || false;

    if (isChecked) {
      delete phaseData[itemId];
    } else {
      phaseData[itemId] = {
        checked: true,
        checked_at: new Date().toISOString(),
      };
    }

    const updatedPhases: PhasesState = {
      ...currentPhases,
      [phaseId]: phaseData,
    };

    const newStatus = getOverallStatus(updatedPhases);
    setDetail({
      ...detail,
      phases: updatedPhases,
      status: newStatus,
      updated_at: new Date().toISOString(),
    });

    try {
      await fetch(`/api/onboarding/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phases: { [phaseId]: phaseData },
          status: newStatus,
        }),
      });
      fetchOnboardings();
    } catch {
      setDetail({ ...detail, phases: currentPhases });
    }
  }

  async function handleRenameItem(phaseId: string, itemId: string, newLabel: string) {
    if (!detail || !newLabel.trim()) {
      setEditingItemId(null);
      return;
    }

    const currentPhases: PhasesState = JSON.parse(JSON.stringify(detail.phases));
    const phaseData = { ...(currentPhases[phaseId] || {}) };
    const currentRenamed = (phaseData._renamed as Record<string, string>) || {};
    phaseData._renamed = { ...currentRenamed, [itemId]: newLabel.trim() };

    const updatedPhases = { ...currentPhases, [phaseId]: phaseData };
    const newStatus = getOverallStatus(updatedPhases);

    setDetail({ ...detail, phases: updatedPhases, status: newStatus, updated_at: new Date().toISOString() });
    setEditingItemId(null);

    try {
      await fetch(`/api/onboarding/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phases: { [phaseId]: phaseData }, status: newStatus }),
      });
      fetchOnboardings();
    } catch {
      setDetail({ ...detail, phases: currentPhases });
    }
  }

  async function handleRemoveItem(phaseId: string, itemId: string) {
    if (!detail) return;

    const currentPhases: PhasesState = JSON.parse(JSON.stringify(detail.phases));
    const phaseData = { ...(currentPhases[phaseId] || {}) };
    const currentRemoved = (phaseData._removed as string[]) || [];
    if (currentRemoved.includes(itemId)) return;

    phaseData._removed = [...currentRemoved, itemId];

    const updatedPhases = { ...currentPhases, [phaseId]: phaseData };
    const newStatus = getOverallStatus(updatedPhases);

    setDetail({ ...detail, phases: updatedPhases, status: newStatus, updated_at: new Date().toISOString() });

    try {
      await fetch(`/api/onboarding/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phases: { [phaseId]: phaseData }, status: newStatus }),
      });
      fetchOnboardings();
    } catch {
      setDetail({ ...detail, phases: currentPhases });
    }
  }

  async function handleAddItem(phaseId: string, label: string) {
    if (!detail || !label.trim()) return;

    const currentPhases: PhasesState = JSON.parse(JSON.stringify(detail.phases));
    const phaseData = { ...(currentPhases[phaseId] || {}) };
    const currentCustom = (phaseData._custom_items as CustomItem[]) || [];

    phaseData._custom_items = [...currentCustom, { id: `custom_${Date.now()}`, label: label.trim() }];

    const updatedPhases = { ...currentPhases, [phaseId]: phaseData };
    const newStatus = getOverallStatus(updatedPhases);

    setDetail({ ...detail, phases: updatedPhases, status: newStatus, updated_at: new Date().toISOString() });
    setAddingToPhase(null);
    setNewItemLabel("");

    try {
      await fetch(`/api/onboarding/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phases: { [phaseId]: phaseData }, status: newStatus }),
      });
      fetchOnboardings();
    } catch {
      setDetail({ ...detail, phases: currentPhases });
    }
  }

  /* ─── Stats ─── */

  const totalCount = onboardings.length;
  const activeCount = onboardings.filter((o) => o.status === "in_progress").length;
  const doneCount = onboardings.filter((o) => o.status === "completed").length;
  const overdueCount = onboardings.filter(
    (o) => o.target_date && o.status !== "completed" && new Date(o.target_date) < new Date()
  ).length;
  const avgDays = useMemo(() => {
    const inProgress = onboardings.filter((o) => o.status === "in_progress");
    if (inProgress.length === 0) return 0;
    const totalDays = inProgress.reduce((sum, o) => sum + daysBetween(o.created_at), 0);
    return Math.round(totalDays / inProgress.length);
  }, [onboardings]);

  /* ─── Render ─── */

  // Detail view
  if (selectedId !== null) {
    if (detailLoading) {
      return (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      );
    }

    if (!detail) {
      return (
        <div className="text-center py-16">
          <p className="text-gray-600">Onboarding not found</p>
          <button
            onClick={() => setSelectedId(null)}
            className="mt-3 text-sm text-violet-600 hover:text-violet-800"
          >
            Go back
          </button>
        </div>
      );
    }

    const progress = calculateProgress(detail.phases);
    const currentPhase = getCurrentPhase(detail.phases);
    const age = daysBetween(detail.created_at);
    const targetDays = detail.target_date ? daysUntil(detail.target_date) : null;
    const isOverdue = targetDays !== null && targetDays < 0 && detail.status !== "completed";

    // Build activity timeline from checked_at timestamps
    const activityEvents: { date: string; label: string }[] = [];
    activityEvents.push({ date: detail.created_at, label: "Onboarding created" });
    for (const phase of ONBOARDING_PHASES) {
      const phaseData = detail.phases[phase.id] || {};
      const effectiveItems = getEffectiveItems(phase, phaseData);
      for (const item of effectiveItems) {
        if (phaseData[item.id]?.checked_at) {
          activityEvents.push({
            date: phaseData[item.id].checked_at,
            label: `${phase.shortName}: ${item.label}`,
          });
        }
      }
    }
    activityEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
      <div>
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors mt-1"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold text-gray-900">{detail.name}</h1>
                <TypeBadge type={detail.type} />
                <PriorityBadge priority={detail.priority} />
                {detail.integration_model && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700">
                    {detail.integration_model}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-400 flex-wrap">
                {detail.owner && <span>Owner: {detail.owner}</span>}
                <span>{age} days old</span>
                {detail.target_date && (
                  <span className={isOverdue ? "text-red-500 font-medium" : ""}>
                    {isOverdue
                      ? `Overdue by ${Math.abs(targetDays!)} days`
                      : `${targetDays} days to go-live`}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => openEdit(detail)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
            {confirmDelete === detail.id ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDelete(detail.id)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(detail.id)}
                className="px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Info cards row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {/* Contact info */}
          {(detail.contact_name || detail.contact_email || detail.contact_phone) && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Contact</h3>
              {detail.contact_name && (
                <p className="text-sm font-medium text-gray-900">{detail.contact_name}</p>
              )}
              {detail.contact_email && (
                <a href={`mailto:${detail.contact_email}`} className="text-sm text-violet-600 hover:text-violet-800 block">
                  {detail.contact_email}
                </a>
              )}
              {detail.contact_phone && (
                <p className="text-sm text-gray-500">{detail.contact_phone}</p>
              )}
            </div>
          )}

          {/* Target date */}
          {detail.target_date && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Target Go-Live</h3>
              <p className={`text-lg font-semibold ${isOverdue ? "text-red-600" : "text-gray-900"}`}>
                {new Date(detail.target_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
              <p className={`text-xs mt-0.5 ${isOverdue ? "text-red-500" : "text-gray-400"}`}>
                {isOverdue ? `${Math.abs(targetDays!)} days overdue` : `${targetDays} days remaining`}
              </p>
            </div>
          )}

          {/* Linked merchant */}
          {detail.merchant_channel_id && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Linked Merchant Chat</h3>
              <Link
                href={`/merchants/${detail.merchant_channel_id}`}
                className="text-sm font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1"
              >
                {detail.merchant_channel_label || `Merchant #${detail.merchant_channel_id}`}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )}
        </div>

        {/* Notes */}
        {detail.notes && (
          <div className="mb-4 px-4 py-2.5 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-sm text-gray-600">{detail.notes}</p>
          </div>
        )}

        {/* Overall progress bar */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Overall Progress</span>
              <StatusBadge status={detail.status} />
            </div>
            <span className="text-sm font-semibold text-gray-900">
              {progress.completed}/{progress.total} items
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progress.percentage === 100 ? "bg-emerald-500" : "bg-violet-500"
                }`}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <span className={`text-lg font-bold ${progress.percentage === 100 ? "text-emerald-600" : "text-violet-600"}`}>
              {progress.percentage}%
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Current phase: {currentPhase.shortName} &mdash; {currentPhase.name}
          </p>
        </div>

        {/* Phase Timeline */}
        <div className="space-y-0">
          {ONBOARDING_PHASES.map((phase, phaseIndex) => (
            <PhaseSection
              key={phase.id}
              phase={phase}
              phases={detail.phases}
              isLast={phaseIndex === ONBOARDING_PHASES.length - 1}
              isCurrent={currentPhase.id === phase.id}
              onToggleItem={handleToggleItem}
              onRenameItem={handleRenameItem}
              onRemoveItem={handleRemoveItem}
              onAddItem={handleAddItem}
              editingItemId={editingItemId}
              editingLabel={editingLabel}
              setEditingItemId={setEditingItemId}
              setEditingLabel={setEditingLabel}
              addingToPhase={addingToPhase}
              newItemLabel={newItemLabel}
              setAddingToPhase={setAddingToPhase}
              setNewItemLabel={setNewItemLabel}
            />
          ))}
        </div>

        {/* Activity Timeline */}
        {activityEvents.length > 1 && (
          <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Activity</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {activityEvents.slice(0, 20).map((ev, i) => (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <span className="text-gray-300 shrink-0 w-24 text-right">
                    {new Date(ev.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" "}
                    {new Date(ev.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                  <span className="text-gray-600">{ev.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <FormModal
            editingId={editingId}
            form={form}
            setForm={setForm}
            saving={saving}
            onSave={handleSave}
            onClose={() => setShowModal(false)}
            merchants={merchants}
          />
        )}
      </div>
    );
  }

  // List view
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Onboarding</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Track merchant onboarding phases &amp; progress
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Onboarding
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-gray-900">{totalCount}</p>
          <p className="text-xs text-gray-400">Total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-violet-600">{activeCount}</p>
          <p className="text-xs text-gray-400">In Progress</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-emerald-600">{doneCount}</p>
          <p className="text-xs text-gray-400">Completed</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className={`text-2xl font-semibold ${overdueCount > 0 ? "text-red-600" : "text-gray-300"}`}>{overdueCount}</p>
          <p className="text-xs text-gray-400">Overdue</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-2xl font-semibold text-gray-600">{avgDays}</p>
          <p className="text-xs text-gray-400">Avg Days</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-wrap gap-3">
          {/* Status tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === tab.value
                    ? "bg-white text-violet-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Priority tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {PRIORITY_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setPriorityFilter(tab.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  priorityFilter === tab.value
                    ? "bg-white text-violet-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 bg-white"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
        />
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : sortedOnboardings.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">&#128640;</div>
          <h2 className="text-xl font-semibold text-gray-700">No onboardings yet</h2>
          <p className="text-gray-400 mt-2">
            Create your first onboarding to start tracking merchant progress.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedOnboardings.map((ob) => (
            <OnboardingCard
              key={ob.id}
              onboarding={ob}
              onClick={() => setSelectedId(ob.id)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <FormModal
          editingId={editingId}
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
          merchants={merchants}
        />
      )}
    </div>
  );
}

/* ─── Sub-Components ─── */

function FormModal({
  editingId,
  form,
  setForm,
  saving,
  onSave,
  onClose,
  merchants,
}: {
  editingId: number | null;
  form: FormData;
  setForm: (f: FormData) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  merchants: MerchantOption[];
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? "Edit Onboarding" : "New Onboarding"}
          </h2>

          <div className="space-y-4">
            {/* ── Basic Info ── */}
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Basic Info</div>

            {/* Name */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Merchant / Partner Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Nuvigo Pay"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
              />
            </div>

            {/* Type + Priority row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as "merchant" | "partner" })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  <option value="merchant">Merchant</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Owner + Target Date row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Owner</label>
                <input
                  type="text"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  placeholder="e.g. Geraldine Sprockel"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Target Go-Live</label>
                <input
                  type="date"
                  value={form.target_date}
                  onChange={(e) => setForm({ ...form, target_date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Any additional context..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
              />
            </div>

            {/* ── Contact Info ── */}
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide pt-2">Contact Info</div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Contact Name</label>
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                placeholder="e.g. John Doe"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  placeholder="john@company.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  placeholder="+52 55 1234 5678"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
            </div>

            {/* ── Onboarding Config ── */}
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide pt-2">Configuration</div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Integration Model</label>
                <select
                  value={form.integration_model}
                  onChange={(e) => setForm({ ...form, integration_model: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  <option value="">— None —</option>
                  {INTEGRATION_MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Linked Merchant Chat</label>
                <select
                  value={form.merchant_channel_id ?? ""}
                  onChange={(e) => setForm({ ...form, merchant_channel_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  <option value="">— None —</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingCard({
  onboarding,
  onClick,
}: {
  onboarding: Onboarding;
  onClick: () => void;
}) {
  const progress = calculateProgress(onboarding.phases);
  const currentPhase = getCurrentPhase(onboarding.phases);
  const age = daysBetween(onboarding.created_at);
  const isOverdue = onboarding.target_date && onboarding.status !== "completed" && new Date(onboarding.target_date) < new Date();

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 cursor-pointer hover:border-violet-200 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">{onboarding.name}</h3>
          <TypeBadge type={onboarding.type} />
          <PriorityBadge priority={onboarding.priority} />
          <StatusBadge status={onboarding.status} />
          {onboarding.integration_model && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700">
              {onboarding.integration_model}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
          {currentPhase.shortName} &mdash; {currentPhase.name}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              progress.percentage === 100 ? "bg-emerald-500" : "bg-violet-500"
            }`}
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-gray-600 w-10 text-right">
          {progress.percentage}%
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-wrap">
        {onboarding.owner && <span>{onboarding.owner}</span>}
        <span>{progress.completed}/{progress.total} items</span>
        <span>{age}d old</span>
        {onboarding.target_date && (
          <span className={isOverdue ? "text-red-500 font-medium" : ""}>
            {isOverdue
              ? `Overdue ${new Date(onboarding.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : `Go-live: ${new Date(onboarding.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          </span>
        )}
        {onboarding.contact_name && <span>{onboarding.contact_name}</span>}
      </div>
    </div>
  );
}

function PhaseSection({
  phase,
  phases,
  isLast,
  isCurrent,
  onToggleItem,
  onRenameItem,
  onRemoveItem,
  onAddItem,
  editingItemId,
  editingLabel,
  setEditingItemId,
  setEditingLabel,
  addingToPhase,
  newItemLabel,
  setAddingToPhase,
  setNewItemLabel,
}: {
  phase: PhaseDefinition;
  phases: PhasesState;
  isLast: boolean;
  isCurrent: boolean;
  onToggleItem: (phaseId: string, itemId: string) => void;
  onRenameItem: (phaseId: string, itemId: string, newLabel: string) => void;
  onRemoveItem: (phaseId: string, itemId: string) => void;
  onAddItem: (phaseId: string, label: string) => void;
  editingItemId: string | null;
  editingLabel: string;
  setEditingItemId: (id: string | null) => void;
  setEditingLabel: (label: string) => void;
  addingToPhase: string | null;
  newItemLabel: string;
  setAddingToPhase: (phaseId: string | null) => void;
  setNewItemLabel: (label: string) => void;
}) {
  const status = getPhaseStatus(phase, phases);
  const phaseData = phases[phase.id] || {};
  const effectiveItems = getEffectiveItems(phase, phaseData);
  const checkedCount = effectiveItems.filter((item) => phaseData[item.id]?.checked).length;

  const [expanded, setExpanded] = useState(isCurrent || status === "in_progress");

  const dotColor =
    status === "completed"
      ? "bg-emerald-500 border-emerald-500"
      : status === "in_progress"
      ? "bg-violet-500 border-violet-500"
      : "bg-gray-200 border-gray-300";

  const lineColor = status === "completed" ? "bg-emerald-200" : "bg-gray-200";

  const countColor =
    status === "completed"
      ? "text-emerald-600 bg-emerald-50"
      : status === "in_progress"
      ? "text-violet-600 bg-violet-50"
      : "text-gray-400 bg-gray-50";

  return (
    <div className="relative pl-8">
      {!isLast && (
        <div className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${lineColor}`} />
      )}

      <div
        className={`absolute left-1.5 top-1.5 w-4 h-4 rounded-full border-2 ${dotColor} ${
          isCurrent && status !== "completed" ? "animate-pulse" : ""
        }`}
      >
        {status === "completed" && (
          <svg className="w-2.5 h-2.5 text-white absolute top-[1px] left-[1px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4}>
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>

      <div className={`pb-6 ${isLast ? "pb-0" : ""}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 text-left group"
        >
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span
            className={`text-sm font-semibold ${
              status === "completed"
                ? "text-emerald-700"
                : status === "in_progress"
                ? "text-gray-900"
                : "text-gray-500"
            }`}
          >
            {phase.shortName} &mdash; {phase.name}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${countColor}`}>
            {checkedCount}/{effectiveItems.length}
          </span>
          <span className="text-[11px] text-gray-400 hidden sm:inline ml-auto mr-2">
            {phase.owner}
          </span>
        </button>

        {phase.isBlocker && status !== "completed" && (
          <div className="mt-2 ml-5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-xs text-amber-700 font-medium">{phase.blockerMessage}</span>
          </div>
        )}

        {expanded && (
          <div className="mt-2 ml-5 space-y-0.5">
            {effectiveItems.map((item) => {
              const itemState = phaseData[item.id];
              const isChecked = itemState?.checked || false;
              const isEditing = editingItemId === `${phase.id}:${item.id}`;

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-1.5 px-2.5 rounded-lg hover:bg-gray-50 group/item transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleItem(phase.id, item.id)}
                    className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 focus:ring-offset-0 cursor-pointer shrink-0"
                  />

                  {isEditing ? (
                    <input
                      type="text"
                      value={editingLabel}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onRenameItem(phase.id, item.id, editingLabel);
                        if (e.key === "Escape") setEditingItemId(null);
                      }}
                      onBlur={() => {
                        if (editingLabel.trim()) onRenameItem(phase.id, item.id, editingLabel);
                        else setEditingItemId(null);
                      }}
                      autoFocus
                      className="flex-1 text-sm px-2 py-0.5 border border-violet-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                    />
                  ) : (
                    <span className={`text-sm flex-1 ${isChecked ? "text-gray-400 line-through" : "text-gray-700"}`}>
                      {item.label}
                    </span>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingItemId(`${phase.id}:${item.id}`);
                          setEditingLabel(item.label);
                        }}
                        className="p-1 text-gray-300 hover:text-violet-600 transition-colors"
                        title="Edit item"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveItem(phase.id, item.id);
                        }}
                        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                        title="Remove item"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {itemState?.checked_at && !isEditing && (
                    <span className="text-[10px] text-gray-300 shrink-0">
                      {new Date(itemState.checked_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              );
            })}

            {addingToPhase === phase.id ? (
              <div className="flex items-center gap-2 py-1.5 px-2.5">
                <svg className="w-4 h-4 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <input
                  type="text"
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newItemLabel.trim()) onAddItem(phase.id, newItemLabel);
                    if (e.key === "Escape") { setAddingToPhase(null); setNewItemLabel(""); }
                  }}
                  autoFocus
                  placeholder="New item..."
                  className="flex-1 text-sm px-2 py-0.5 border border-violet-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
                <button
                  onClick={() => { if (newItemLabel.trim()) onAddItem(phase.id, newItemLabel); }}
                  className="text-xs text-violet-600 font-medium hover:text-violet-800"
                >
                  Add
                </button>
                <button
                  onClick={() => { setAddingToPhase(null); setNewItemLabel(""); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingToPhase(phase.id); setNewItemLabel(""); }}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-violet-600 py-1.5 px-2.5 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add item
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const opt = PRIORITY_OPTIONS.find((p) => p.value === priority);
  if (!opt || opt.value === "normal") return null;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${opt.color}`}>
      {opt.label}
    </span>
  );
}

function TypeBadge({ type }: { type: "merchant" | "partner" }) {
  const style =
    type === "merchant"
      ? "bg-violet-50 text-violet-700"
      : "bg-red-50 text-red-600";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${style}`}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: "not_started" | "in_progress" | "completed" }) {
  const styles: Record<string, string> = {
    not_started: "bg-gray-100 text-gray-500",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
  };
  const labels: Record<string, string> = {
    not_started: "Not Started",
    in_progress: "In Progress",
    completed: "Completed",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${styles[status] || styles.not_started}`}>
      {labels[status] || status}
    </span>
  );
}
