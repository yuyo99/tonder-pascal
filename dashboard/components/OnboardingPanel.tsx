"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ONBOARDING_PHASES,
  PRIORITY_OPTIONS,
  INTEGRATION_MODELS,
  INTEGRATION_TYPES,
  FEATURES,
  calculateProgressForTeam,
  getCurrentPhaseForTeam,
  getTeamPhases,
  getPhaseStatus,
  getOverallStatus,
  getEffectiveItems,
  TEAM_LABELS,
  type PhasesState,
  type PhaseDefinition,
  type CustomItem,
  type TeamKey,
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
  integration_types: string[];
  features: string[];
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
  integration_types: [] as string[],
  features: [] as string[],
};

type FormData = typeof emptyForm;

/* ─── Helpers ─── */

function daysBetween(a: string | null | undefined, b: Date = new Date()): number {
  if (!a) return 0;
  const d = new Date(a).getTime();
  if (isNaN(d)) return 0;
  return Math.floor((b.getTime() - d) / 86400000);
}

function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr).getTime();
  if (isNaN(d)) return 0;
  return Math.ceil((d - Date.now()) / 86400000);
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/* ─── SVG Progress Ring ─── */

function ProgressRing({ percentage, size = 80 }: { percentage: number; size?: number }) {
  const strokeWidth = 3.5;
  const radius = (36 - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = percentage === 100 ? "text-emerald-500" : "text-violet-500";

  return (
    <svg viewBox="0 0 36 36" width={size} height={size} className="shrink-0">
      <circle
        cx="18" cy="18" r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-gray-100"
      />
      <circle
        cx="18" cy="18" r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={`${color} transition-all duration-700`}
        transform="rotate(-90 18 18)"
      />
      <text
        x="18" y="18"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-gray-900 text-[8px] font-semibold"
      >
        {percentage}%
      </text>
    </svg>
  );
}

/* ─── Panel Component ─── */

export default function OnboardingPanel({ team }: { team: TeamKey }) {
  const teamPhases = getTeamPhases(team);
  const teamLabel = TEAM_LABELS[team];

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
        list.sort((a, b) => calculateProgressForTeam(b.phases, team).percentage - calculateProgressForTeam(a.phases, team).percentage);
        break;
      case "priority":
        list.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
        break;
      default: // created_desc
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [onboardings, sortBy, team]);

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
      integration_types: ob.integration_types || [],
      features: ob.features || [],
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

    // Global status — stays global for DB consistency
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
          <p className="text-gray-400">Onboarding not found</p>
          <button
            onClick={() => setSelectedId(null)}
            className="mt-3 text-sm text-violet-600 hover:text-violet-800"
          >
            Go back
          </button>
        </div>
      );
    }

    const progress = calculateProgressForTeam(detail.phases, team);
    const currentPhase = getCurrentPhaseForTeam(detail.phases, team);
    const age = daysBetween(detail.created_at);
    const targetDays = detail.target_date ? daysUntil(detail.target_date) : null;
    const isOverdue = targetDays !== null && targetDays < 0 && detail.status !== "completed";

    // Build activity timeline from checked_at timestamps (scoped to team phases)
    const activityEvents: { date: string; label: string }[] = [];
    activityEvents.push({ date: detail.created_at, label: "Onboarding created" });
    for (const phase of teamPhases) {
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
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors mt-1"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-semibold text-gray-900">{detail.name}</h1>
                <TypeBadge type={detail.type} />
                <PriorityBadge priority={detail.priority} />
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-400 flex-wrap">
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
              className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
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
                  className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(detail.id)}
                className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-600 border border-red-100 rounded-lg hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* Left column — Progress + Phases + Activity */}
          <div className="flex-1 min-w-0">
            {/* Progress Ring Section */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 mb-8">
              <div className="flex items-center gap-5">
                <ProgressRing percentage={progress.percentage} size={80} />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-700">{teamLabel.name} Progress</span>
                    <StatusBadge status={detail.status} />
                  </div>
                  <p className="text-sm text-gray-400">
                    {progress.completed} of {progress.total} items complete
                  </p>
                  <p className="text-xs text-gray-300 mt-1">
                    Current phase: {currentPhase.shortName} &mdash; {currentPhase.name}
                  </p>
                </div>
              </div>
            </div>

            {/* Phase Timeline (scoped to team) */}
            <div className="space-y-0 mb-8">
              {teamPhases.map((phase, phaseIndex) => (
                <PhaseSection
                  key={phase.id}
                  phase={phase}
                  phases={detail.phases}
                  isLast={phaseIndex === teamPhases.length - 1}
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
              <div className="mb-8">
                <h3 className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-4">Activity</h3>
                <div className="relative max-h-72 overflow-y-auto">
                  {activityEvents.slice(0, 20).map((ev, i) => (
                    <div key={i} className="relative flex items-start gap-3 pb-4 last:pb-0">
                      {/* Connecting line */}
                      {i < Math.min(activityEvents.length - 1, 19) && (
                        <div className="absolute left-[5px] top-3 bottom-0 w-px bg-gray-100" />
                      )}
                      {/* Dot */}
                      <div className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 ${
                        i === 0 ? "bg-violet-400" : "bg-gray-200"
                      }`} />
                      {/* Content */}
                      <div>
                        <p className="text-sm text-gray-600 leading-tight">{ev.label}</p>
                        <p className="text-[11px] text-gray-300 mt-0.5">
                          {new Date(ev.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {" "}
                          {new Date(ev.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column — Sidebar cards */}
          <div className="w-80 shrink-0 space-y-5">
            {/* Overview card */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-4">Overview</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Owner</span>
                  <span className="text-gray-700 font-medium">{detail.owner || "\u2014"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Age</span>
                  <span className="text-gray-700 font-medium">{age} days</span>
                </div>
                {detail.target_date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Target date</span>
                    <span className={`font-medium ${isOverdue ? "text-red-500" : "text-gray-700"}`}>
                      {new Date(detail.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}
                {detail.merchant_channel_id && (
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-400">Merchant chat</span>
                    <Link
                      href={`/merchants/${detail.merchant_channel_id}`}
                      className="text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
                    >
                      {detail.merchant_channel_label || `#${detail.merchant_channel_id}`}
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Contact card */}
            {(detail.contact_name || detail.contact_email || detail.contact_phone) && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-4">Contact</h3>
                <div className="space-y-3">
                  {detail.contact_name && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Name</span>
                      <span className="text-gray-700 font-medium">{detail.contact_name}</span>
                    </div>
                  )}
                  {detail.contact_email && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Email</span>
                      <a href={`mailto:${detail.contact_email}`} className="text-violet-600 hover:text-violet-800 font-medium">
                        {detail.contact_email}
                      </a>
                    </div>
                  )}
                  {detail.contact_phone && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Phone</span>
                      <span className="text-gray-700 font-medium">{detail.contact_phone}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Configuration card */}
            {(detail.integration_model || (detail.integration_types?.length ?? 0) > 0 || (detail.features?.length ?? 0) > 0) && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-4">Configuration</h3>
                <div className="space-y-3">
                  {detail.integration_model && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Model</span>
                      <span className="text-gray-700 font-medium">{detail.integration_model}</span>
                    </div>
                  )}
                  {(detail.integration_types?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-sm text-gray-400 mb-1.5">Types</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.integration_types.map((t) => (
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(detail.features?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-sm text-gray-400 mb-1.5">Features</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.features.map((f) => (
                          <span key={f} className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes card */}
            {detail.notes && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-3">Notes</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{detail.notes}</p>
              </div>
            )}
          </div>
        </div>

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
          <h1 className="text-2xl font-semibold text-gray-900">{teamLabel.name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {teamLabel.description}
          </p>
        </div>
        {team === "cs" && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Onboarding
          </button>
        )}
      </div>

      {/* Stats — 4 cards with left accent */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 border-l-2 border-l-violet-500 p-5">
          <p className="text-xs text-gray-400 mb-1">Active</p>
          <p className="text-3xl font-semibold text-gray-900">{activeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 border-l-2 border-l-emerald-500 p-5">
          <p className="text-xs text-gray-400 mb-1">Completed</p>
          <p className="text-3xl font-semibold text-gray-900">{doneCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 border-l-2 border-l-red-500 p-5">
          <p className="text-xs text-gray-400 mb-1">Overdue</p>
          <p className={`text-3xl font-semibold ${overdueCount > 0 ? "text-red-600" : "text-gray-900"}`}>{overdueCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 border-l-2 border-l-gray-300 p-5">
          <p className="text-xs text-gray-400 mb-1">Avg Days</p>
          <p className="text-3xl font-semibold text-gray-900">{avgDays}</p>
        </div>
      </div>

      {/* Filters — single horizontal row */}
      <div className="flex items-center gap-3 mb-5">
        {/* Search with magnifying glass */}
        <div className="relative w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 placeholder:text-gray-300"
          />
        </div>

        <div className="flex-1" />

        {/* Status segmented control */}
        <div className="flex bg-gray-100/80 rounded-lg p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === tab.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Priority segmented control */}
        <div className="flex bg-gray-100/80 rounded-lg p-0.5">
          {PRIORITY_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setPriorityFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                priorityFilter === tab.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 bg-white text-gray-600"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50 bg-gray-50/30">
                  <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wider font-medium">Merchant</th>
                  <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wider font-medium">Status</th>
                  <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wider font-medium min-w-[140px]">Progress</th>
                  <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wider font-medium">Phase</th>
                  <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wider font-medium">Go-live</th>
                  <th className="px-5 py-3 text-right text-xs text-gray-400 uppercase tracking-wider font-medium">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedOnboardings.map((ob) => {
                  const progress = calculateProgressForTeam(ob.phases, team);
                  const currentPhase = getCurrentPhaseForTeam(ob.phases, team);
                  const age = daysBetween(ob.created_at);
                  const isOverdue = ob.target_date && ob.status !== "completed" && new Date(ob.target_date) < new Date();
                  const isCompleted = ob.status === "completed";

                  return (
                    <tr
                      key={ob.id}
                      onClick={() => setSelectedId(ob.id)}
                      className="hover:bg-gray-50/40 transition-colors cursor-pointer"
                    >
                      {/* Merchant (combined: name + badges + owner) */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          {/* Overdue / completed color bar */}
                          <div className={`w-1 h-8 rounded-full shrink-0 ${
                            isOverdue ? "bg-red-400" : isCompleted ? "bg-emerald-400" : "bg-transparent"
                          }`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-gray-900 truncate max-w-[200px]">{ob.name}</span>
                              <TypeBadge type={ob.type} />
                              <PriorityBadge priority={ob.priority} />
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">
                              {ob.owner || "\u2014"}
                              {ob.integration_model ? ` \u00B7 ${ob.integration_model}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <StatusBadge status={ob.status} />
                      </td>

                      {/* Progress */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[60px]">
                            <div
                              className={`h-full rounded-full transition-all ${
                                progress.percentage === 100 ? "bg-emerald-500" : "bg-violet-500"
                              }`}
                              style={{ width: `${progress.percentage}%` }}
                            />
                          </div>
                          <span className={`text-xs font-medium tabular-nums w-8 text-right ${
                            progress.percentage === 100 ? "text-emerald-600" : "text-gray-500"
                          }`}>
                            {progress.percentage}%
                          </span>
                        </div>
                      </td>

                      {/* Phase */}
                      <td className="px-5 py-4">
                        <span className="text-xs text-gray-500 whitespace-nowrap">{currentPhase.shortName}</span>
                      </td>

                      {/* Go-live */}
                      <td className="px-5 py-4">
                        {ob.target_date ? (
                          <span className={`text-xs whitespace-nowrap ${isOverdue ? "text-red-500 font-medium" : "text-gray-500"}`}>
                            {new Date(ob.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">&mdash;</span>
                        )}
                      </td>

                      {/* Age */}
                      <td className="px-5 py-4 text-right">
                        <span className="text-xs text-gray-400 tabular-nums">{age}d</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">Basic Info</div>

            {/* Name */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Merchant / Partner Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Nuvigo Pay"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
              />
            </div>

            {/* Type + Priority row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as "merchant" | "partner" })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  <option value="merchant">Merchant</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
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
                <label className="block text-xs text-gray-400 mb-1">Owner</label>
                <input
                  type="text"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  placeholder="e.g. Geraldine Sprockel"
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Target Go-Live</label>
                <input
                  type="date"
                  value={form.target_date}
                  onChange={(e) => setForm({ ...form, target_date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Any additional context..."
                className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-y"
              />
            </div>

            {/* ── Contact Info ── */}
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider pt-2">Contact Info</div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Contact Name</label>
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                placeholder="e.g. John Doe"
                className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  placeholder="john@company.com"
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  placeholder="+52 55 1234 5678"
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                />
              </div>
            </div>

            {/* ── Onboarding Config ── */}
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider pt-2">Configuration</div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Integration Model</label>
                <select
                  value={form.integration_model}
                  onChange={(e) => setForm({ ...form, integration_model: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  <option value="">— None —</option>
                  {INTEGRATION_MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Linked Merchant Chat</label>
                <select
                  value={form.merchant_channel_id ?? ""}
                  onChange={(e) => setForm({ ...form, merchant_channel_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                >
                  <option value="">— None —</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Integration Types (multi-select chips) ── */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">Integration Types</label>
              <div className="flex flex-wrap gap-2">
                {INTEGRATION_TYPES.map((t) => {
                  const selected = form.integration_types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const next = selected
                          ? form.integration_types.filter((x) => x !== t)
                          : [...form.integration_types, t];
                        setForm({ ...form, integration_types: next });
                      }}
                      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                        selected
                          ? "bg-violet-100 border-violet-300 text-violet-700 font-medium"
                          : "bg-white border-gray-100 text-gray-400 hover:border-gray-200 hover:text-gray-600"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Features (multi-select chips) ── */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">Features</label>
              <div className="flex flex-wrap gap-2">
                {FEATURES.map((f) => {
                  const selected = form.features.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        const next = selected
                          ? form.features.filter((x) => x !== f)
                          : [...form.features, f];
                        setForm({ ...form, features: next });
                      }}
                      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                        selected
                          ? "bg-emerald-100 border-emerald-300 text-emerald-700 font-medium"
                          : "bg-white border-gray-100 text-gray-400 hover:border-gray-200 hover:text-gray-600"
                      }`}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
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

  return (
    <div className="relative pl-8">
      {/* Connecting line */}
      {!isLast && (
        <div className={`absolute left-[11px] top-6 bottom-0 w-px ${
          status === "completed" ? "bg-emerald-300" : "bg-gray-200"
        }`} />
      )}

      {/* Phase dot */}
      <div className="absolute left-1 top-1">
        {status === "completed" ? (
          /* Completed: emerald filled with checkmark */
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}>
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : status === "in_progress" ? (
          /* Active: violet ring with inner dot */
          <div className="w-5 h-5 rounded-full border-2 border-violet-500 bg-white flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-violet-500" />
          </div>
        ) : (
          /* Pending: hollow gray */
          <div className="w-5 h-5 rounded-full border-2 border-gray-200 bg-white" />
        )}
      </div>

      <div className={`pb-6 ${isLast ? "pb-0" : ""} ${isCurrent && status !== "completed" ? "bg-violet-50/40 -mx-3 px-3 rounded-lg" : ""}`}>
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
                : "text-gray-400"
            }`}
          >
            {phase.shortName} &mdash; {phase.name}
          </span>
          <span className="text-xs text-gray-400 tabular-nums">
            {checkedCount}/{effectiveItems.length}
          </span>
          <span className="text-[11px] text-gray-300 hidden sm:inline ml-auto mr-2">
            {phase.owner}
          </span>
        </button>

        {phase.isBlocker && status !== "completed" && (
          <div className="mt-2 ml-5 p-2.5 bg-amber-50 border border-amber-100 rounded-lg flex items-center gap-2">
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
                    <span className={`text-sm flex-1 ${isChecked ? "text-gray-300 line-through" : "text-gray-700"}`}>
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
                className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-violet-600 py-1.5 px-2.5 transition-colors"
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

/* ─── Badge Components ─── */

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal" || !priority) return null;
  const colors: Record<string, string> = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    low: "bg-blue-400",
  };
  const labels: Record<string, string> = {
    urgent: "Urgent",
    high: "High",
    low: "Low",
  };
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 font-medium">
      <span className={`w-1.5 h-1.5 rounded-sm ${colors[priority] || "bg-gray-300"}`} />
      {labels[priority] || priority}
    </span>
  );
}

function TypeBadge({ type }: { type: "merchant" | "partner" }) {
  const style =
    type === "merchant"
      ? "bg-gray-100 text-gray-500"
      : "bg-rose-50 text-rose-500";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${style}`}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: "not_started" | "in_progress" | "completed" }) {
  const dots: Record<string, string> = {
    not_started: "bg-gray-300",
    in_progress: "bg-blue-500",
    completed: "bg-emerald-500",
  };
  const labels: Record<string, string> = {
    not_started: "Not Started",
    in_progress: "In Progress",
    completed: "Completed",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status] || dots.not_started}`} />
      {labels[status] || status}
    </span>
  );
}
