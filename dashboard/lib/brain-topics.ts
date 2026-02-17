/* ─── Brain Topic Classification ─── */

/** Map each Pascal tool name → human-readable topic */
export const TOOL_TO_TOPIC: Record<string, string> = {
  get_acceptance_rate: "Acceptance Rate",
  get_transaction_volume: "Transaction Volume",
  get_top_declines: "Decline Analysis",
  get_transactions_by_status: "Status Breakdown",
  lookup_by_id: "Transaction Lookup",
  list_recent_transactions: "Recent Transactions",
  lookup_spei_deposits: "SPEI Deposits",
  get_withdrawal_status: "Payout Status",
  list_recent_withdrawals: "Recent Payouts",
};

/** Group topics into parent categories */
export const TOPIC_CATEGORIES: Record<string, string> = {
  "Acceptance Rate": "Performance Analytics",
  "Transaction Volume": "Performance Analytics",
  "Decline Analysis": "Performance Analytics",
  "Status Breakdown": "Performance Analytics",
  "Transaction Lookup": "Transaction Lookup",
  "Recent Transactions": "Transaction Lookup",
  "SPEI Deposits": "Deposit / SPEI",
  "Payout Status": "Payouts",
  "Recent Payouts": "Payouts",
  "General Support": "General Support",
};

/** Category → hex color for graph nodes */
export const CATEGORY_COLORS: Record<string, string> = {
  "Performance Analytics": "#8b5cf6",
  "Transaction Lookup": "#3b82f6",
  "Deposit / SPEI": "#10b981",
  Payouts: "#f59e0b",
  "General Support": "#6b7280",
};

export const GENERAL_SUPPORT_TOPIC = "General Support";

/** Convert a raw tool name to a display topic. Handles unknown tools gracefully. */
export function toolToTopic(toolName: string): string {
  return (
    TOOL_TO_TOPIC[toolName] ||
    toolName
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Get category for a topic */
export function topicCategory(topic: string): string {
  return TOPIC_CATEGORIES[topic] || "General Support";
}

/** Get color for a topic */
export function topicColor(topic: string): string {
  return CATEGORY_COLORS[topicCategory(topic)] || "#6b7280";
}
