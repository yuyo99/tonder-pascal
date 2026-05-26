import * as Sentry from "@sentry/node";
import Anthropic from "@anthropic-ai/sdk";
import { parseDateRange, buildDateRange, DateRange } from "../utils/dates";
import { MerchantContext } from "../merchants/types";
import * as queries from "../mongodb/queries";
import {
  queryTransactions,
  QueryTransactionsInput,
} from "../mongodb/query-transactions";
import { generateRefundReceipt } from "./receipt-generator";
import { config } from "../config";

import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";
import { createTeamTicket } from "../linear/client";

/**
 * AID-85 — unified `query_transactions` tool definition. Registered
 * conditionally based on `config.pascal.unifiedQueryEnabled` so we
 * can ship behind a flag and remove the 6 old tools in a follow-up
 * PR after a 7-day soak.
 */
const QUERY_TRANSACTIONS_TOOL: Anthropic.Tool = {
  name: "query_transactions",
  description:
    "Query transaction records with composable filters and aggregations. " +
    "Use this for ANY filtered or compound transaction question — it " +
    "replaces get_acceptance_rate, get_top_declines, get_transaction_volume, " +
    "get_transactions_by_status, list_recent_transactions, and lookup_spei_deposits. " +
    "One tool call covers what would otherwise require 2-3 sequential rounds.\n\n" +
    "Examples:\n" +
    '- "Show failed SPEI deposits over 5k from yesterday" →\n' +
    '  filters: { status: ["declined"], payment_method: ["spei"], ' +
    "amount_range: { min: 5000 }, date_range: { from: ISO_yesterday_start, to: ISO_yesterday_end } }\n" +
    '- "What\'s our acceptance rate this week?" →\n' +
    '  aggregate: "group_by_status", filters: { date_range: { from, to } }\n' +
    '- "Top decline reasons" →\n' +
    '  aggregate: "group_by_decline" (already implies status: declined)\n' +
    '- "Transactions for customer@example.com last 7 days" →\n' +
    '  filters: { search: "customer@example.com", date_range: { from, to } }\n\n' +
    "IMPORTANT: payment_method takes EXTERNAL labels only (cards, spei, " +
    "oxxopay, cash_voucher, mercadopago) — never internal acquirer names. " +
    "date_range requires ISO 8601 timestamps (not keywords like 'yesterday'). " +
    "If you don't know exact ISO timestamps, omit date_range and the query " +
    "returns recent records by default.",
  input_schema: {
    type: "object" as const,
    properties: {
      filters: {
        type: "object" as const,
        description: "Filter conditions. All are AND-combined.",
        properties: {
          status: {
            type: "array" as const,
            items: {
              type: "string" as const,
              enum: [
                "approved",
                "success",
                "declined",
                "pending",
                "refunded",
                "reversed",
                "expired",
                "failed",
              ],
            },
            description: "Transaction statuses to include. Case-insensitive.",
          },
          payment_method: {
            type: "array" as const,
            items: {
              type: "string" as const,
              enum: [
                "cards",
                "spei",
                "oxxopay",
                "cash_voucher",
                "mercadopago",
              ],
            },
            description:
              "Payment method labels to include. Use these external labels only.",
          },
          date_range: {
            type: "object" as const,
            properties: {
              from: { type: "string" as const, description: "ISO 8601 timestamp" },
              to: { type: "string" as const, description: "ISO 8601 timestamp" },
            },
            required: ["from", "to"] as string[],
          },
          amount_range: {
            type: "object" as const,
            properties: {
              min: { type: "number" as const },
              max: { type: "number" as const },
            },
          },
          search: {
            type: "string" as const,
            description:
              "Fuzzy match across payment_id, order_id, customer_email, payment_customer_order_reference, transaction_reference, tracking_key. Natively handles BC Game's customer_order_id.",
          },
          decline_reason: {
            type: "string" as const,
            description:
              "Case-insensitive partial match on the decline description.",
          },
        },
      },
      aggregate: {
        type: "string" as const,
        enum: [
          "count",
          "sum",
          "group_by_status",
          "group_by_method",
          "group_by_decline",
          "group_by_day",
        ],
        description:
          "Aggregation mode. Omit to return rows. group_by_decline implicitly filters to declined transactions.",
      },
      sort: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const, enum: ["created", "amount"] },
          order: { type: "string" as const, enum: ["asc", "desc"] },
        },
      },
      limit: {
        type: "number" as const,
        description:
          "Number of rows to return. Default 20, max 100. Ignored when aggregate is set.",
      },
      offset: {
        type: "number" as const,
        description: "Pagination offset. Default 0.",
      },
    },
    required: [] as string[],
  },
};

// Pending file attachments from tool execution (keyed by receipt ID)
const pendingAttachments = new Map<string, { buffer: Buffer; filename: string }>();
let receiptCounter = 0;

export function consumePendingAttachments(): { buffer: Buffer; filename: string }[] {
  const attachments = [...pendingAttachments.values()];
  pendingAttachments.clear();
  return attachments;
}

// Shared date parameter definitions
const dateParams = {
  date_range: {
    type: "string" as const,
    description:
      "Time range keyword: 'today', 'yesterday', 'this week', 'last week', 'this month', 'last month', 'this weekend', 'last weekend', 'last N days', 'last N hours'. Defaults to 'today'.",
  },
  start_date: {
    type: "string" as const,
    description: "Explicit start date in ISO format (YYYY-MM-DD). Must be used together with end_date.",
  },
  end_date: {
    type: "string" as const,
    description: "Explicit end date in ISO format (YYYY-MM-DD). Must be used together with start_date.",
  },
};

export const toolDefinitions: Anthropic.Tool[] = [
  // AID-85: register the unified tool FIRST so Claude evaluates it
  // before the 6 narrower tools. Behind a feature flag for safety —
  // when off, Claude sees exactly the 9-tool surface that existed
  // before this commit.
  ...(config.pascal.unifiedQueryEnabled ? [QUERY_TRANSACTIONS_TOOL] : []),
  // TODO(AID-85 follow-up): remove the 6 below after the 7-day soak.
  {
    name: "get_acceptance_rate",
    description:
      "Get acceptance rates split into Cards and alternative payment methods (SPEI, Cash Vouchers, etc.). Returns both count-based and volume-based rates. Formula: Success / (Success + Pending + Expired + Failed + Declined).",
    input_schema: {
      type: "object" as const,
      properties: { ...dateParams },
      required: [] as string[],
    },
  },
  {
    name: "get_transaction_volume",
    description:
      "Get transaction volume (total amount) and count. Returns total volume, success volume, counts, and average ticket size.",
    input_schema: {
      type: "object" as const,
      properties: { ...dateParams },
      required: [] as string[],
    },
  },
  {
    name: "get_top_declines",
    description:
      "Get the top decline reasons/codes ranked by frequency. Useful for understanding why transactions are failing.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number" as const,
          description: "Number of top decline reasons to return (default 10).",
        },
        ...dateParams,
      },
      required: [] as string[],
    },
  },
  {
    name: "get_transactions_by_status",
    description:
      "Get transaction breakdown by status (Success, Declined, Pending, etc.) with count and volume for each.",
    input_schema: {
      type: "object" as const,
      properties: { ...dateParams },
      required: [] as string[],
    },
  },
  {
    name: "get_withdrawal_status",
    description:
      "Get withdrawal/payout status summary: total count, total amount, and breakdown by status (paid, pending, failed, etc.).",
    input_schema: {
      type: "object" as const,
      properties: { ...dateParams },
      required: [] as string[],
    },
  },
  {
    name: "lookup_by_id",
    description:
      "Universal ID lookup — search across ALL systems (deposits, withdrawals, SPEI transfers) using ANY identifier. Accepts payment IDs, order IDs, transaction references, tracking keys, UUIDs, bank references, etc. Always try this tool when a merchant provides any ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string" as const,
          description: "The identifier to search for (any format: number, UUID, reference code, etc.)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "lookup_spei_deposits",
    description:
      "Search SPEI (bank transfer) deposits by date range, amount, status, or bank reference.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number" as const, description: "Exact amount to search for." },
        status: { type: "string" as const, description: "Filter by status." },
        reference: { type: "string" as const, description: "Bank reference to search for." },
        limit: { type: "number" as const, description: "Number of results (default 10, max 25)." },
        ...dateParams,
      },
      required: [] as string[],
    },
  },
  {
    name: "list_recent_transactions",
    description:
      "List the most recent transactions with optional status filter. Returns payment ID, order ID, status, amount, payment method, and date.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string" as const, description: "Filter by status (e.g., 'Success', 'Declined')." },
        limit: { type: "number" as const, description: "Number of transactions to return (default 10, max 25)." },
        ...dateParams,
      },
      required: [] as string[],
    },
  },
  {
    name: "list_recent_withdrawals",
    description:
      "List the most recent withdrawals/payouts with optional status filter.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string" as const, description: "Filter by status." },
        limit: { type: "number" as const, description: "Number of withdrawals to return (default 10, max 25)." },
        ...dateParams,
      },
      required: [] as string[],
    },
  },
  {
    name: "generate_refund_receipt",
    description:
      "Generate a PDF refund receipt for a transaction. Use lookup_by_id FIRST to get the transaction details, then call this tool with the data. The PDF will be automatically sent as a file attachment in the channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        payment_id: { type: "string" as const, description: "Transaction/payment ID" },
        order_id: { type: "string" as const, description: "Order ID" },
        amount: { type: "number" as const, description: "Refund amount" },
        currency: { type: "string" as const, description: "Currency code (default MXN)" },
        status: { type: "string" as const, description: "Transaction status" },
        payment_method: { type: "string" as const, description: "Payment method display name" },
        customer_email: { type: "string" as const, description: "Customer email" },
        created_at: { type: "string" as const, description: "Transaction creation date" },
      },
      required: ["payment_id", "amount", "status"] as string[],
    },
  },
  {
    name: "create_internal_ticket",
    description:
      "Create an internal support ticket routed to the correct Tonder team. Use when the merchant needs human help (account config, IP whitelisting, billing, MID requests, etc.). The merchant will NOT see the ticket ID — just tell them the team will respond shortly.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const, description: "Short ticket title summarizing the request" },
        description: { type: "string" as const, description: "Full context including the merchant's message and any relevant details" },
        team: { type: "string" as const, enum: ["int", "sos", "finops"], description: "Team to route to: 'int' for integrations/API/SDK, 'sos' for support/general, 'finops' for settlements/billing/payouts" },
        priority: { type: "number" as const, enum: [1, 2, 3, 4], description: "1=Urgent 2=High 3=Normal 4=Low (default 3)" },
      },
      required: ["title", "description", "team"] as string[],
    },
  },
];

// Tool input types
interface ToolInput {
  date_range?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  id?: string;
  status?: string;
  amount?: number;
  reference?: string;
  // Receipt fields
  payment_id?: string;
  order_id?: string;
  currency?: string;
  payment_method?: string;
  customer_email?: string;
  created_at?: string;
  // Ticket fields
  title?: string;
  description?: string;
  team?: "int" | "sos" | "finops";
  priority?: number;
}

function resolveDateRange(input: ToolInput): DateRange {
  if (input.start_date && input.end_date) {
    return buildDateRange(input.start_date, input.end_date);
  }
  return parseDateRange(input.date_range || "today");
}

export async function executeTool(
  toolName: string,
  input: ToolInput,
  merchantCtx: MerchantContext
): Promise<string> {
  try {
    const dateRange = resolveDateRange(input);

    switch (toolName) {
      // AID-85 — unified transaction query. Replaces the 6 cases below
      // (kept registered behind the flag during the 7-day soak).
      case "query_transactions": {
        // The input shape matches QueryTransactionsInput. The new tool
        // takes its OWN date_range under filters.date_range (ISO from/to),
        // NOT the legacy keyword string — so don't call resolveDateRange
        // here. Cast through unknown because ToolInput is the legacy
        // shape; the new tool has a richer schema.
        const txInput = input as unknown as QueryTransactionsInput;
        const result = await queryTransactions(txInput, merchantCtx);
        return JSON.stringify({
          ...result,
          merchant: merchantCtx.businessName,
        });
      }

      case "get_acceptance_rate": {
        const result = await queries.getAcceptanceRates(dateRange, merchantCtx.businessIds);
        return JSON.stringify({
          cards: result.cards
            ? {
                displayName: result.cards.displayName,
                rateByCount: Math.round(result.cards.rateByCount * 10) / 10,
                rateByVolume: Math.round(result.cards.rateByVolume * 10) / 10,
                successCount: result.cards.successCount,
                totalCount: result.cards.totalCount,
                successVolume: Math.round(result.cards.successVolume * 100) / 100,
                totalVolume: Math.round(result.cards.totalVolume * 100) / 100,
              }
            : null,
          apms: result.apms.map((a) => ({
            displayName: a.displayName,
            rateByCount: Math.round(a.rateByCount * 10) / 10,
            rateByVolume: Math.round(a.rateByVolume * 10) / 10,
            successCount: a.successCount,
            totalCount: a.totalCount,
            successVolume: Math.round(a.successVolume * 100) / 100,
            totalVolume: Math.round(a.totalVolume * 100) / 100,
          })),
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "get_transaction_volume": {
        const result = await queries.getTransactionVolume(dateRange, merchantCtx.businessIds);
        return JSON.stringify({
          ...result,
          totalVolume: Math.round(result.totalVolume * 100) / 100,
          successVolume: Math.round(result.successVolume * 100) / 100,
          avgTicket: Math.round(result.avgTicket * 100) / 100,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "get_top_declines": {
        const result = await queries.getTopDeclines(
          dateRange,
          merchantCtx.businessIds,
          input.limit || 10
        );
        return JSON.stringify({
          declines: result,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "get_transactions_by_status": {
        const result = await queries.getTransactionsByStatus(dateRange, merchantCtx.businessIds);
        return JSON.stringify({
          statuses: result,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "get_withdrawal_status": {
        const result = await queries.getWithdrawalStatus(dateRange, merchantCtx.businessIdStrs);
        return JSON.stringify({
          ...result,
          totalAmount: Math.round(result.totalAmount * 100) / 100,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "lookup_by_id": {
        if (!input.id) return "Error: id is required";
        const results = await queries.lookupById(
          input.id,
          merchantCtx.businessIds,
          merchantCtx.businessIdStrs
        );
        if (results.length === 0) {
          return JSON.stringify({
            found: false,
            message: `No transaction, withdrawal, or SPEI deposit found with ID "${input.id}" for ${merchantCtx.businessName}.`,
          });
        }
        return JSON.stringify({ found: true, results });
      }

      case "lookup_spei_deposits": {
        const result = await queries.lookupSpeiDeposits(
          dateRange,
          merchantCtx.businessIdStrs,
          input.amount,
          input.status,
          input.reference,
          input.limit || 10
        );
        return JSON.stringify({
          deposits: result,
          count: result.length,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "list_recent_transactions": {
        const result = await queries.listRecentTransactions(
          dateRange,
          merchantCtx.businessIds,
          input.status,
          input.limit || 10
        );
        return JSON.stringify({
          transactions: result,
          count: result.length,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "list_recent_withdrawals": {
        const result = await queries.listRecentWithdrawals(
          dateRange,
          merchantCtx.businessIdStrs,
          input.status,
          input.limit || 10
        );
        return JSON.stringify({
          withdrawals: result,
          count: result.length,
          dateRange: dateRange.label,
          merchant: merchantCtx.businessName,
        });
      }

      case "generate_refund_receipt": {
        logger.info({ payment_id: input.payment_id, amount: input.amount, status: input.status }, "generate_refund_receipt called");
        if (!input.payment_id || !input.amount || !input.status) {
          logger.warn({ input }, "generate_refund_receipt missing required fields");
          return "Error: payment_id, amount, and status are required";
        }
        const pdfBuffer = await generateRefundReceipt({
          paymentId: input.payment_id,
          orderId: input.order_id,
          amount: input.amount,
          currency: input.currency || "MXN",
          status: input.status,
          paymentMethod: input.payment_method,
          customerEmail: input.customer_email,
          merchantName: merchantCtx.businessName,
          createdAt: input.created_at || new Date().toISOString(),
        });
        const receiptId = `receipt_${++receiptCounter}`;
        const filename = `refund_receipt_${input.payment_id.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
        pendingAttachments.set(receiptId, { buffer: pdfBuffer, filename });
        logger.info({ receiptId, filename, bufferSize: pdfBuffer.length, pendingCount: pendingAttachments.size, merchant: merchantCtx.businessName }, "Refund receipt PDF generated and stored in pendingAttachments");
        return JSON.stringify({
          success: true,
          receiptId,
          filename,
          message: "PDF receipt generated and will be sent as a file attachment.",
        });
      }

      case "create_internal_ticket": {
        if (!input.title || !input.description || !input.team) {
          return "Error: title, description, and team are required";
        }
        const ticket = await createTeamTicket({
          team: input.team,
          title: input.title,
          description: `**Merchant:** ${merchantCtx.businessName}\n**Channel:** ${merchantCtx.channelId}\n**Platform:** ${merchantCtx.platform}\n\n---\n\n${input.description}`,
          priority: input.priority ?? 3,
          merchantCtx,
        });
        logger.info({ ticket: ticket.identifier, team: input.team, merchant: merchantCtx.businessName }, "Internal ticket auto-created");
        return JSON.stringify({
          success: true,
          message: "Ticket created. Tell the merchant the team will respond shortly. Do NOT share the ticket ID or URL with the merchant.",
        });
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { tool: toolName, merchant: merchantCtx.businessName } });
    logger.error({ err, toolName, input }, "Tool execution failed");
    storeErrorFromCatch("tool", err, { tool: toolName, merchant: merchantCtx.businessName, input: JSON.stringify(input).slice(0, 500) });
    return `Error executing ${toolName}: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
