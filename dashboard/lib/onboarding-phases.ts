/**
 * Onboarding phase definitions and progress utilities.
 *
 * This is the single source of truth for the 8 onboarding phases
 * and their 41 checklist items. Imported by both the API routes
 * and the frontend page.
 */

/* ─── Types ─── */

export interface ChecklistItem {
  id: string;
  label: string;
}

export interface PhaseDefinition {
  id: string;
  name: string;
  shortName: string;
  owner: string;
  items: ChecklistItem[];
  isBlocker?: boolean;
  blockerMessage?: string;
}

export interface PhaseItemState {
  checked: boolean;
  checked_at: string; // ISO timestamp
}

export interface CustomItem {
  id: string;
  label: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PhasesState = Record<string, Record<string, any>>;

/* ─── Phase Definitions ─── */

export const ONBOARDING_PHASES: PhaseDefinition[] = [
  {
    id: "phase_1",
    name: "Pre-Integration / KYB",
    shortName: "Phase 1",
    owner: "Geraldine Sprockel",
    items: [
      { id: "kyb_submitted", label: "KYB submitted" },
      { id: "timeline_validated", label: "Target timeline validated and accepted" },
      { id: "legal_docs_validated", label: "Legal documentation validated with Sumsub" },
      { id: "docs_sent_acquirer", label: "Documentation sent to the acquirer" },
      { id: "kyb_approved", label: "KYB approved" },
    ],
  },
  {
    id: "phase_2",
    name: "Sandbox Integration",
    shortName: "Phase 2",
    owner: "Geraldine Sprockel",
    items: [
      { id: "sandbox_credentials", label: "Sandbox credentials delivered" },
      { id: "technical_docs_shared", label: "Technical documentation shared" },
    ],
  },
  {
    id: "phase_3",
    name: "Integration in Progress",
    shortName: "Phase 3",
    owner: "Arturo Torres, Guillermo Quintero",
    items: [
      { id: "integration_type_defined", label: "Integration type defined (API / Checkout / Withdrawals)" },
      { id: "technical_errors_fixed", label: "Technical errors fixed" },
      { id: "status_handling", label: "Proper status handling implemented" },
      { id: "retries_expirations", label: "Retries and expirations validated" },
      { id: "webhooks_callbacks", label: "Webhooks and callbacks working correctly" },
      { id: "integration_stable", label: "Integration stable without critical errors" },
      { id: "certification_checklist", label: "Certification checklist submitted" },
    ],
  },
  {
    id: "phase_4",
    name: "Technical Certification (QA)",
    shortName: "Phase 4",
    owner: "Guillermo Quintero",
    items: [
      { id: "e2e_tests", label: "End-to-end tests executed" },
      { id: "negative_cases", label: "Negative cases validated" },
      { id: "idempotency", label: "Idempotency validated" },
      { id: "basic_security", label: "Basic security validated" },
      { id: "acceptable_performance", label: "Acceptable performance" },
      { id: "technical_cert_approved", label: "Technical certification approved" },
    ],
  },
  {
    id: "phase_4_5",
    name: "Acquirer MID",
    shortName: "Phase 4.5",
    owner: "Geraldine Sprockel",
    isBlocker: true,
    blockerMessage: "Without completing this phase, production deployment is not allowed",
    items: [
      { id: "mid_approved", label: "MID approved" },
      { id: "mid_credentials", label: "MID credentials received and validated" },
    ],
  },
  {
    id: "phase_5",
    name: "Production Configuration",
    shortName: "Phase 5",
    owner: "Guillermo Quintero, Roberto Lomelli",
    items: [
      { id: "prod_account_created", label: "Production account created" },
      { id: "users_access_configured", label: "Users and access configured" },
      { id: "prod_payment_methods", label: "Production payment methods activated" },
      { id: "qa_config_validated", label: "QA configuration validated" },
      { id: "in_fees_configured", label: "IN fees configured" },
      { id: "out_fees_configured", label: "OUT fees configured" },
      { id: "rolling_reserve", label: "Rolling reserve configured" },
      { id: "settlements_configured", label: "Settlements configured" },
    ],
  },
  {
    id: "phase_6",
    name: "Bank Account",
    shortName: "Phase 6",
    owner: "Roberto Lomelli",
    items: [
      { id: "bank_details_received", label: "Bank details received" },
      { id: "bank_details_validated", label: "Bank details validated" },
      { id: "bank_account_registered", label: "Bank account registered" },
      { id: "test_transfer", label: "Test transfer executed" },
      { id: "transfer_confirmed", label: "Transfer confirmed" },
    ],
  },
  {
    id: "phase_7",
    name: "Ongoing Monitoring",
    shortName: "Phase 7",
    owner: "David Contreras",
    items: [
      { id: "daily_monitoring", label: "Daily monitoring activated" },
      { id: "first_txns_reviewed", label: "First transactions reviewed" },
      { id: "approval_rates_reviewed", label: "Approval rates reviewed" },
      { id: "errors_pending_analyzed", label: "Errors and pending issues analyzed" },
      { id: "initial_report_cs", label: "Initial report sent to CS" },
      { id: "stable_operation", label: "Stable operation confirmed" },
    ],
  },
];

/* ─── Per-Onboarding Customization Helpers ─── */

/** Extract metadata keys from phase JSONB data */
export function getPhaseMetadata(phaseData: Record<string, unknown>) {
  return {
    removed: (phaseData._removed as string[]) || [],
    renamed: (phaseData._renamed as Record<string, string>) || {},
    customItems: (phaseData._custom_items as CustomItem[]) || [],
  };
}

/**
 * Resolve the effective item list for a phase, accounting for
 * per-onboarding removals, renames, and custom items.
 */
export function getEffectiveItems(
  phase: PhaseDefinition,
  phaseData: Record<string, unknown>
): ChecklistItem[] {
  const { removed, renamed, customItems } = getPhaseMetadata(phaseData);

  // Start with hardcoded defaults, filter removed, apply renames
  const defaultItems = phase.items
    .filter((item) => !removed.includes(item.id))
    .map((item) => ({
      id: item.id,
      label: renamed[item.id] || item.label,
    }));

  // Append custom items (also filter any removed custom items)
  const custom = customItems.filter((item) => !removed.includes(item.id));

  return [...defaultItems, ...custom];
}

/* ─── Progress Utilities ─── */

/** Calculate overall progress from phases JSONB */
export function calculateProgress(phases: PhasesState): {
  completed: number;
  total: number;
  percentage: number;
} {
  let completed = 0;
  let total = 0;

  for (const phase of ONBOARDING_PHASES) {
    const phaseData = phases[phase.id] || {};
    const effectiveItems = getEffectiveItems(phase, phaseData);
    total += effectiveItems.length;
    for (const item of effectiveItems) {
      if (phaseData[item.id]?.checked) completed++;
    }
  }

  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

/** Get the current phase (first phase not fully completed) */
export function getCurrentPhase(phases: PhasesState): PhaseDefinition {
  for (const phase of ONBOARDING_PHASES) {
    const phaseData = phases[phase.id] || {};
    const effectiveItems = getEffectiveItems(phase, phaseData);
    const allChecked =
      effectiveItems.length > 0 &&
      effectiveItems.every((item) => phaseData[item.id]?.checked);
    if (!allChecked) return phase;
  }
  return ONBOARDING_PHASES[ONBOARDING_PHASES.length - 1];
}

/** Get status for a single phase */
export function getPhaseStatus(
  phase: PhaseDefinition,
  phases: PhasesState
): "not_started" | "in_progress" | "completed" {
  const phaseData = phases[phase.id] || {};
  const effectiveItems = getEffectiveItems(phase, phaseData);

  if (effectiveItems.length === 0) return "completed";

  const checkedCount = effectiveItems.filter(
    (item) => phaseData[item.id]?.checked
  ).length;
  if (checkedCount === 0) return "not_started";
  if (checkedCount === effectiveItems.length) return "completed";
  return "in_progress";
}

/** Determine overall onboarding status */
export function getOverallStatus(
  phases: PhasesState
): "not_started" | "in_progress" | "completed" {
  const { completed, total } = calculateProgress(phases);
  if (completed === 0) return "not_started";
  if (completed === total) return "completed";
  return "in_progress";
}
