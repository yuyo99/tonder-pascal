"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─── */

interface Person {
  id: string;
  type: "tonder_team" | "merchant_contact";
  name: string;
  role: string;
  company: string;
  slack_user_id: string | null;
  telegram_user_id: string | null;
  email: string;
  domain: string;
  topics: string[];
  escalation_notes: string;
  merchant_channel_id: number | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  merchant_label: string | null;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface MerchantChannel {
  id: number;
  label: string;
  platform: string;
}

type Tab = "team" | "merchants" | "relationships";

const DOMAINS = [
  "payments",
  "integrations",
  "finops",
  "infra",
  "support",
  "engineering",
  "product",
  "sales",
];

const DOMAIN_COLORS: Record<string, string> = {
  payments: "bg-emerald-100 text-emerald-700",
  integrations: "bg-blue-100 text-blue-700",
  finops: "bg-amber-100 text-amber-700",
  infra: "bg-purple-100 text-purple-700",
  support: "bg-rose-100 text-rose-700",
  engineering: "bg-cyan-100 text-cyan-700",
  product: "bg-violet-100 text-violet-700",
  sales: "bg-orange-100 text-orange-700",
};

const emptyForm: Omit<Person, "id" | "is_active" | "created_at" | "updated_at" | "account_manager_name" | "merchant_label"> = {
  type: "tonder_team",
  name: "",
  role: "",
  company: "Tonder",
  slack_user_id: null,
  telegram_user_id: null,
  email: "",
  domain: "",
  topics: [],
  escalation_notes: "",
  merchant_channel_id: null,
  account_manager_id: null,
  notes: "",
};

/* ─── Page ─── */

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [channels, setChannels] = useState<MerchantChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("team");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [topicsInput, setTopicsInput] = useState("");

  const fetchPeople = useCallback(async () => {
    try {
      const res = await fetch("/api/people");
      const data = await res.json();
      setPeople(data.people || []);
    } catch (err) {
      console.error("Failed to fetch people:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/merchants");
      const data = await res.json();
      setChannels(
        (data.merchants || []).map((m: { id: number; label: string; platform: string }) => ({
          id: m.id,
          label: m.label,
          platform: m.platform,
        }))
      );
    } catch (err) {
      console.error("Failed to fetch channels:", err);
    }
  }, []);

  useEffect(() => {
    fetchPeople();
    fetchChannels();
  }, [fetchPeople, fetchChannels]);

  /* ─── Filtering ─── */

  const activePeople = people.filter((p) => p.is_active);
  const teamMembers = activePeople.filter((p) => p.type === "tonder_team");
  const merchantContacts = activePeople.filter((p) => p.type === "merchant_contact");

  const filtered = (tab === "team" ? teamMembers : tab === "merchants" ? merchantContacts : activePeople).filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.company.toLowerCase().includes(search.toLowerCase()) ||
      p.role.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase())
  );

  /* ─── CRUD ─── */

  function openNew(type: "tonder_team" | "merchant_contact") {
    setEditingId(null);
    setForm({ ...emptyForm, type, company: type === "tonder_team" ? "Tonder" : "" });
    setTopicsInput("");
    setShowModal(true);
  }

  function openEdit(person: Person) {
    setEditingId(person.id);
    setForm({
      type: person.type,
      name: person.name,
      role: person.role,
      company: person.company,
      slack_user_id: person.slack_user_id,
      telegram_user_id: person.telegram_user_id,
      email: person.email,
      domain: person.domain,
      topics: person.topics,
      escalation_notes: person.escalation_notes,
      merchant_channel_id: person.merchant_channel_id,
      account_manager_id: person.account_manager_id,
      notes: person.notes,
    });
    setTopicsInput((person.topics || []).join(", "));
    setShowModal(true);
  }

  async function handleSave() {
    const payload = {
      ...form,
      topics: topicsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      merchant_channel_id: form.merchant_channel_id || null,
      account_manager_id: form.account_manager_id || null,
    };

    if (editingId) {
      await fetch(`/api/people/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setShowModal(false);
    fetchPeople();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this person?")) return;
    await fetch(`/api/people/${id}`, { method: "DELETE" });
    fetchPeople();
  }

  /* ─── Stats ─── */

  const stats = [
    { label: "Team Members", value: teamMembers.length, accent: "border-l-violet-500" },
    { label: "Merchant Contacts", value: merchantContacts.length, accent: "border-l-blue-500" },
    {
      label: "Domains Covered",
      value: new Set(teamMembers.map((t) => t.domain).filter(Boolean)).size,
      accent: "border-l-emerald-500",
    },
    {
      label: "Merchants Covered",
      value: new Set(merchantContacts.map((c) => c.company).filter(Boolean)).size,
      accent: "border-l-amber-500",
    },
  ];

  /* ─── Render ─── */

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Team members, merchant contacts, and escalation paths"
        right={
          <button onClick={() => openNew(tab === "merchants" ? "merchant_contact" : "tonder_team")} className="filter-btn active">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add person
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map((s, i) => (
          <div key={s.label} className={`t-card fade-in d${i + 1}`}>
            <p className="text-sm font-medium text-gray-500">{s.label}</p>
            <p className="text-[var(--text-metric)] font-semibold text-gray-900 leading-tight mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
          {([
            { key: "team" as Tab, label: "Tonder Team" },
            { key: "merchants" as Tab, label: "Merchant Contacts" },
            { key: "relationships" as Tab, label: "Relationships" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`t-tab ${tab === t.key ? "active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search people…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-9 w-64 !py-[7px]"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-pascal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === "relationships" ? (
        <RelationshipsView people={activePeople} />
      ) : tab === "team" ? (
        <TeamGrid people={filtered} onEdit={openEdit} onDelete={handleDelete} />
      ) : (
        <ContactsTable people={filtered} onEdit={openEdit} onDelete={handleDelete} />
      )}

      {/* Modal */}
      {showModal && (
        <PersonModal
          form={form}
          setForm={setForm}
          topicsInput={topicsInput}
          setTopicsInput={setTopicsInput}
          editingId={editingId}
          channels={channels}
          teamMembers={teamMembers}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

/* ═══ Sub-Components ═══ */

/* ─── Team Grid ─── */

function TeamGrid({
  people,
  onEdit,
  onDelete,
}: {
  people: Person[];
  onEdit: (p: Person) => void;
  onDelete: (id: string) => void;
}) {
  if (people.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-1">No team members yet</p>
        <p className="text-sm">Add your first Tonder team member to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {people.map((p) => (
        <div
          key={p.id}
          className="t-card !p-5 hover:border-gray-300 transition-colors group"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{p.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{p.role || "No role set"}</p>
            </div>
            {p.domain && (
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  DOMAIN_COLORS[p.domain] || "bg-gray-100 text-gray-600"
                }`}
              >
                {p.domain}
              </span>
            )}
          </div>

          {p.topics && p.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {p.topics.map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-100"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {p.escalation_notes && (
            <p className="text-xs text-gray-400 mb-3 line-clamp-2">{p.escalation_notes}</p>
          )}

          <div className="flex items-center gap-3 text-[11px] text-gray-300">
            {p.email && <span>{p.email}</span>}
            {p.slack_user_id && <span>Slack</span>}
            {p.telegram_user_id && <span>Telegram</span>}
          </div>

          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(p)}
              className="text-xs text-gray-400 hover:text-violet-600 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(p.id)}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Contacts Table ─── */

function ContactsTable({
  people,
  onEdit,
  onDelete,
}: {
  people: Person[];
  onEdit: (p: Person) => void;
  onDelete: (id: string) => void;
}) {
  if (people.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-1">No merchant contacts yet</p>
        <p className="text-sm">Add your first merchant contact to track relationships.</p>
      </div>
    );
  }

  return (
    <div className="t-card t-card-flush overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50/30">
            <th className="text-left text-xs text-gray-400 font-medium px-5 py-3">Name</th>
            <th className="text-left text-xs text-gray-400 font-medium px-5 py-3">Company</th>
            <th className="text-left text-xs text-gray-400 font-medium px-5 py-3">Role</th>
            <th className="text-left text-xs text-gray-400 font-medium px-5 py-3">Account Manager</th>
            <th className="text-left text-xs text-gray-400 font-medium px-5 py-3">Email</th>
            <th className="text-left text-xs text-gray-400 font-medium px-5 py-3">Notes</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {people.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50/40 transition-colors">
              <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{p.name}</td>
              <td className="px-5 py-3.5 text-sm text-gray-600">{p.company || "—"}</td>
              <td className="px-5 py-3.5 text-sm text-gray-500">{p.role || "—"}</td>
              <td className="px-5 py-3.5 text-sm text-gray-500">
                {p.account_manager_name || "—"}
              </td>
              <td className="px-5 py-3.5 text-sm text-gray-400">{p.email || "—"}</td>
              <td className="px-5 py-3.5 text-xs text-gray-400 max-w-[200px] truncate">
                {p.notes || "—"}
              </td>
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onEdit(p)}
                    className="text-xs text-gray-400 hover:text-violet-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(p.id)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    ×
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

/* ─── Relationships View ─── */

function RelationshipsView({ people }: { people: Person[] }) {
  const team = people.filter((p) => p.type === "tonder_team");
  const contacts = people.filter((p) => p.type === "merchant_contact");

  // Group merchant contacts by company
  const byCompany = new Map<string, Person[]>();
  for (const c of contacts) {
    const key = c.company || "Unknown";
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(c);
  }

  if (byCompany.size === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-1">No relationships yet</p>
        <p className="text-sm">Add merchant contacts and assign account managers to see the map.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {[...byCompany.entries()].map(([company, contacts]) => {
        const am = contacts[0]?.account_manager_id
          ? team.find((t) => t.id === contacts[0].account_manager_id)
          : null;

        return (
          <div
            key={company}
            className="t-card !p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">{company}</h3>
              {am && (
                <span className="text-xs text-gray-400">
                  Account Manager:{" "}
                  <span className="text-violet-600 font-medium">{am.name}</span>
                  {am.domain && (
                    <span
                      className={`ml-2 text-[10px] px-2 py-0.5 rounded-full ${
                        DOMAIN_COLORS[am.domain] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {am.domain}
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50/50 border border-gray-50"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-semibold shrink-0">
                    {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400 truncate">{c.role || c.email || "—"}</p>
                  </div>
                </div>
              ))}
            </div>

            {contacts[0]?.notes && (
              <p className="mt-3 text-xs text-gray-400 italic">{contacts[0].notes}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Modal ─── */

function PersonModal({
  form,
  setForm,
  topicsInput,
  setTopicsInput,
  editingId,
  channels,
  teamMembers,
  onSave,
  onClose,
}: {
  form: typeof emptyForm;
  setForm: (f: typeof emptyForm) => void;
  topicsInput: string;
  setTopicsInput: (s: string) => void;
  editingId: string | null;
  channels: MerchantChannel[];
  teamMembers: Person[];
  onSave: () => void;
  onClose: () => void;
}) {
  const isTeam = form.type === "tonder_team";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">
            {editingId ? "Edit Person" : "Add Person"}
          </h2>

          <div className="space-y-4">
            {/* Type selector */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <div className="flex gap-2">
                {(["tonder_team", "merchant_contact"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        type: t,
                        company: t === "tonder_team" ? "Tonder" : form.company,
                      })
                    }
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      form.type === t
                        ? "bg-violet-100 border-violet-300 text-violet-700 font-medium"
                        : "bg-white border-gray-100 text-gray-400 hover:border-gray-200"
                    }`}
                  >
                    {t === "tonder_team" ? "Tonder Team" : "Merchant Contact"}
                  </button>
                ))}
              </div>
            </div>

            {/* Name + Role */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Role</label>
                <input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  placeholder="e.g., FinOps Lead"
                />
              </div>
            </div>

            {/* Company + Email */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Company</label>
                <input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  placeholder={isTeam ? "Tonder" : "Merchant name"}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  placeholder="email@example.com"
                />
              </div>
            </div>

            {/* Team-specific fields */}
            {isTeam && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Domain</label>
                  <select
                    value={form.domain}
                    onChange={(e) => setForm({ ...form, domain: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  >
                    <option value="">— Select —</option>
                    {DOMAINS.map((d) => (
                      <option key={d} value={d}>
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Topics (comma-separated)
                  </label>
                  <input
                    value={topicsInput}
                    onChange={(e) => setTopicsInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                    placeholder="settlements, guardian, 3DS, SPEI"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Escalation Notes</label>
                  <textarea
                    value={form.escalation_notes}
                    onChange={(e) => setForm({ ...form, escalation_notes: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-none"
                    placeholder="When should Pascal escalate to this person?"
                  />
                </div>
              </>
            )}

            {/* Merchant-specific fields */}
            {!isTeam && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Merchant Channel</label>
                  <select
                    value={form.merchant_channel_id ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        merchant_channel_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  >
                    <option value="">— None —</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.label} ({ch.platform})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Account Manager</label>
                  <select
                    value={form.account_manager_id ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        account_manager_id: e.target.value || null,
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  >
                    <option value="">— None —</option>
                    {teamMembers.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name} ({tm.role || tm.domain || "Tonder"})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Slack / Telegram IDs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Slack User ID</label>
                <input
                  value={form.slack_user_id ?? ""}
                  onChange={(e) => setForm({ ...form, slack_user_id: e.target.value || null })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  placeholder="U091BLCSUMC"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Telegram User ID</label>
                <input
                  value={form.telegram_user_id ?? ""}
                  onChange={(e) => setForm({ ...form, telegram_user_id: e.target.value || null })}
                  className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                  placeholder="123456789"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-none"
                placeholder="Historical issues, preferences, context for Pascal..."
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={!form.name.trim()}
              className="px-5 py-2 bg-violet-500 text-white text-sm font-medium rounded-lg hover:bg-violet-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingId ? "Save Changes" : "Add Person"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
