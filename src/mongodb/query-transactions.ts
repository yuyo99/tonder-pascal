import { getCollection } from "./connection";
import {
  getMerchantDisplayName,
  paymentMethodsToAcqs,
} from "../core/provider-mask";
import { MerchantContext } from "../merchants/types";
import { logger } from "../utils/logger";

/**
 * AID-85 — unified transaction query tool.
 *
 * Replaces six single-purpose tools (get_acceptance_rate,
 * get_transaction_volume, get_top_declines, get_transactions_by_status,
 * list_recent_transactions, lookup_spei_deposits) with one composable
 * function that builds a MongoDB aggregation pipeline from a rich
 * filter/aggregate/sort/limit input.
 *
 * Provider masking is enforced at the query level (acq → display name
 * via $switch in $group stages) so internal acquirer codes never enter
 * Claude's context. The final JSON.stringify also runs through
 * sanitizeToolOutput() in the executeTool dispatcher as a safety net.
 *
 * The data source is the same MongoDB `mv_payment_transactions`
 * collection the existing 6 tools use — no data migration, same
 * freshness.
 */

const TX_COLLECTION = "mv_payment_transactions";

// Status values in MongoDB are mixed-case ("Success" vs "SUCCESS" vs
// "declined"). Per the project memory, every query must normalize via
// $toLower. The canonical set we accept from Claude is the lowercase
// list below.
const KNOWN_STATUSES = [
  "approved",
  "success", // alias for approved
  "declined",
  "pending",
  "refunded",
  "reversed",
  "expired",
  "failed",
] as const;

/* ─── Input / output types ──────────────────────────────────────── */

export interface QueryTransactionsInput {
  filters?: {
    status?: string[];           // canonical lowercase from KNOWN_STATUSES
    payment_method?: string[];   // "cards" | "spei" | "oxxopay" | "cash_voucher" | "mercadopago"
    date_range?: { from: string; to: string };  // ISO 8601
    amount_range?: { min?: number; max?: number };
    search?: string;             // fuzzy match across IDs + email + reference + txid
    decline_reason?: string;     // case-insensitive partial match on decline_description
    currency?: string;           // ISO 4217 — defaults to MXN, currently informational only
  };
  aggregate?:
    | "count"
    | "sum"
    | "group_by_status"
    | "group_by_method"
    | "group_by_decline"
    | "group_by_day";
  sort?: { field: "created" | "amount"; order: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

export interface SanitizedTransaction {
  payment_id: number | string;
  order_id: number | string | null;
  status: string;
  amount: number;
  currency?: string;
  created: string;
  customer_email?: string;
  payment_method: string;  // already mapped via getMerchantDisplayName
  decline_code?: string;
  decline_description?: string;
  reference?: string;
}

export interface AggregateBucket {
  /** Key — what was grouped on (status / method / decline reason / day) */
  key: string;
  count: number;
  /** Aggregated amount across the bucket; absent for count-only aggregates */
  total_amount?: number;
  /** Mean amount across the bucket; absent for count-only aggregates */
  avg_amount?: number;
}

export interface QueryTransactionsOutput {
  rows?: SanitizedTransaction[];
  aggregates?: AggregateBucket[];
  total_count: number;
  query_meta: {
    business_ids: number[];
    applied_filters: QueryTransactionsInput["filters"];
    truncated: boolean;
    execution_ms: number;
  };
}

/* ─── Helpers ───────────────────────────────────────────────────── */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Coerce + clamp limit, with default fallback. */
function safeLimit(input?: number): number {
  if (!input || input < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(input));
}

/** Build the $match document from the input filters + merchant scope. */
function buildMatch(
  filters: QueryTransactionsInput["filters"] | undefined,
  merchantCtx: MerchantContext
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    business_id:
      merchantCtx.businessIds.length === 1
        ? merchantCtx.businessIds[0]
        : { $in: merchantCtx.businessIds },
  };
  // Note: only getAcceptanceRates filters by transaction_type=PAYMENT
  // because acceptance rate cares specifically about deposit attempts.
  // The other 5 tools we're collapsing don't apply that filter, so the
  // unified tool follows the broader convention. Acceptance-rate-style
  // group_by_status still works correctly without it because the
  // status field IS the discriminator we group by.

  const f = filters ?? {};

  // Date range — `created` (NOT `created_at`) is the canonical txn field
  if (f.date_range) {
    match.created = {
      $gte: new Date(f.date_range.from),
      $lte: new Date(f.date_range.to),
    };
  }

  // Amount range
  if (f.amount_range) {
    const amt: Record<string, number> = {};
    if (f.amount_range.min != null) amt.$gte = f.amount_range.min;
    if (f.amount_range.max != null) amt.$lte = f.amount_range.max;
    if (Object.keys(amt).length > 0) match.amount = amt;
  }

  // Payment method → acquirer codes
  // Also handle the legacy "guardian" provider field (some card txns
  // are tagged via provider:guardian instead of acq:guardian).
  if (f.payment_method && f.payment_method.length > 0) {
    const acqs = paymentMethodsToAcqs(f.payment_method);
    if (acqs.length > 0) {
      // If cards are requested, also accept provider:guardian (legacy
      // tagging used by the existing getAcceptanceRates query).
      const wantsCards = f.payment_method.some(
        (m) => m.toLowerCase() === "cards"
      );
      if (wantsCards) {
        match.$or = [{ acq: { $in: acqs } }, { provider: "guardian" }];
      } else {
        match.acq = { $in: acqs };
      }
    }
  }

  // Decline reason — partial match
  if (f.decline_reason) {
    match.decline_description = { $regex: f.decline_reason, $options: "i" };
  }

  // Search — covers payment_id, order_id, customer_email, references
  // and txid. Uses $or with a regex per field. The existing
  // lookupById() function in queries.ts does the same shape at scale,
  // so we know it works.
  if (f.search && f.search.trim().length > 0) {
    const term = f.search.trim();
    // Numeric ID search needs special handling since payment_id is a
    // number field — coerce the term to a number when possible and use
    // $eq alongside the string regex fallback.
    const asNum = Number(term);
    const searchOr: Record<string, unknown>[] = [
      { customer_email: { $regex: term, $options: "i" } },
      { payment_customer_order_reference: { $regex: term, $options: "i" } },
      { transaction_reference: { $regex: term, $options: "i" } },
      { tracking_key: { $regex: term, $options: "i" } },
    ];
    if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
      searchOr.push({ payment_id: asNum });
      searchOr.push({ order_id: asNum });
    }
    // If a $or for payment_method already exists, merge into $and so
    // both constraints apply (Mongo can't have two top-level $or).
    if (match.$or) {
      match.$and = [{ $or: match.$or }, { $or: searchOr }];
      delete match.$or;
    } else {
      match.$or = searchOr;
    }
  }

  // Status — normalize to lowercase then regex (handles both Success
  // and SUCCESS in the source data, per the project memory).
  if (f.status && f.status.length > 0) {
    const validStatuses = f.status
      .map((s) => s.toLowerCase())
      .filter((s) =>
        (KNOWN_STATUSES as readonly string[]).includes(s)
      );
    if (validStatuses.length > 0) {
      // Use a regex that matches case-insensitively on the status field
      const pattern = validStatuses.join("|");
      match.status = { $regex: `^(${pattern})$`, $options: "i" };
    }
  }

  return match;
}

/**
 * Coerce a Mongo numeric field to a plain JS number.
 *
 * MongoDB can store numbers as Decimal128 (financial precision),
 * Long, or plain Number. The BSON driver returns Decimal128 as an
 * object with `.toString()`, which fails a `typeof === "number"`
 * check and would silently default to 0 in the sanitized output.
 * `parseFloat(String(...))` round-trips all three representations
 * to the correct numeric value (same pattern used in the project's
 * other Mongo helpers — see memory note re: Decimal128).
 */
function coerceNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (v == null) return fallback;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/** Convert one MongoDB row to a sanitized transaction (acq → display). */
function sanitizeRow(row: Record<string, unknown>): SanitizedTransaction {
  // Some records use `provider: "guardian"` instead of `acq: "guardian"`
  const acqRaw =
    typeof row.acq === "string" && row.acq
      ? (row.acq as string)
      : typeof row.provider === "string"
        ? (row.provider as string)
        : "";
  const paymentMethod = acqRaw ? getMerchantDisplayName(acqRaw) : "unknown";

  return {
    payment_id: (row.payment_id as number | string) ?? "",
    order_id: (row.order_id as number | string | null) ?? null,
    status: String(row.status ?? ""),
    amount: coerceNumber(row.amount),
    currency: typeof row.currency === "string" ? (row.currency as string) : undefined,
    created:
      row.created instanceof Date
        ? row.created.toISOString()
        : typeof row.created === "string"
          ? row.created
          : "",
    customer_email:
      typeof row.customer_email === "string" ? (row.customer_email as string) : undefined,
    payment_method: paymentMethod,
    decline_code:
      typeof row.decline_code === "string" ? (row.decline_code as string) : undefined,
    decline_description:
      typeof row.decline_description === "string"
        ? (row.decline_description as string)
        : undefined,
    reference:
      typeof row.payment_customer_order_reference === "string"
        ? (row.payment_customer_order_reference as string)
        : undefined,
  };
}

/* ─── Aggregate-mode pipeline stages ────────────────────────────── */

/**
 * Build the $group / post-group stages for an aggregate mode.
 * Returns the pipeline tail that follows the initial $match.
 */
function buildAggregatePipeline(
  mode: NonNullable<QueryTransactionsInput["aggregate"]>
): Record<string, unknown>[] {
  switch (mode) {
    case "count":
      return [{ $count: "total" }];

    case "sum":
      return [
        {
          $group: {
            _id: null,
            sum: { $sum: "$amount" },
            count: { $sum: 1 },
            avg: { $avg: "$amount" },
          },
        },
      ];

    case "group_by_status":
      return [
        {
          $group: {
            _id: { $toLower: "$status" },
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            avg_amount: { $avg: "$amount" },
          },
        },
        { $sort: { count: -1 } },
      ];

    case "group_by_method":
      // Map acq → display name INSIDE the group expression so the
      // bucket key is already the merchant-facing label. Claude never
      // sees raw acq codes.
      return [
        {
          $addFields: {
            _payment_method: {
              $switch: {
                branches: [
                  { case: { $in: ["$acq", ["kushki", "unlimit", "guardian", "tonder"]] }, then: "Cards" },
                  { case: { $in: ["$acq", ["bitso", "stp"]] }, then: "SPEI" },
                  { case: { $eq: ["$acq", "oxxopay"] }, then: "Oxxopay" },
                  { case: { $eq: ["$acq", "safetypay"] }, then: "Cash Vouchers" },
                  { case: { $eq: ["$acq", "mercadopago"] }, then: "MercadoPago" },
                  // provider:guardian → Cards (legacy card tagging)
                  { case: { $eq: ["$provider", "guardian"] }, then: "Cards" },
                ],
                default: "other",
              },
            },
          },
        },
        {
          $group: {
            _id: "$_payment_method",
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            avg_amount: { $avg: "$amount" },
          },
        },
        { $sort: { count: -1 } },
      ];

    case "group_by_decline":
      return [
        { $addFields: { status_lower: { $toLower: "$status" } } },
        { $match: { status_lower: "declined" } },
        {
          $group: {
            _id: {
              code: "$decline_code",
              description: "$decline_description",
            },
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
          },
        },
        { $sort: { count: -1 } },
      ];

    case "group_by_day":
      return [
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$created" } },
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            avg_amount: { $avg: "$amount" },
          },
        },
        { $sort: { _id: 1 } },
      ];
  }
}

/** Shape the raw aggregate stage output into the public AggregateBucket[]. */
function shapeAggregates(
  mode: NonNullable<QueryTransactionsInput["aggregate"]>,
  raw: Record<string, unknown>[]
): AggregateBucket[] {
  if (mode === "count") {
    const total = raw[0]?.total as number | undefined;
    return [{ key: "total", count: total ?? 0 }];
  }
  if (mode === "sum") {
    const r = raw[0] ?? {};
    return [
      {
        key: "total",
        count: (r.count as number) ?? 0,
        total_amount: round2((r.sum as number) ?? 0),
        avg_amount: round2((r.avg as number) ?? 0),
      },
    ];
  }
  if (mode === "group_by_decline") {
    return raw.map((r) => {
      const id = r._id as { code?: string; description?: string } | null;
      return {
        key:
          id?.description ||
          id?.code ||
          "unknown",
        count: (r.count as number) ?? 0,
        total_amount: round2((r.total_amount as number) ?? 0),
      };
    });
  }
  // group_by_status / group_by_method / group_by_day all share shape
  return raw.map((r) => ({
    key: String(r._id ?? "unknown"),
    count: (r.count as number) ?? 0,
    total_amount: round2((r.total_amount as number) ?? 0),
    avg_amount:
      typeof r.avg_amount === "number" ? round2(r.avg_amount as number) : undefined,
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ─── Public entrypoint ─────────────────────────────────────────── */

export async function queryTransactions(
  input: QueryTransactionsInput,
  merchantCtx: MerchantContext
): Promise<QueryTransactionsOutput> {
  const startedAt = Date.now();
  const col = getCollection(TX_COLLECTION);

  const matchDoc = buildMatch(input.filters, merchantCtx);
  const limit = safeLimit(input.limit);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  // Build the data branch of the pipeline based on aggregate vs rows
  const dataBranch: Record<string, unknown>[] = input.aggregate
    ? buildAggregatePipeline(input.aggregate)
    : [
        // Row mode — sort, skip, limit, then sanitize at the JS layer
        {
          $sort: {
            [input.sort?.field ?? "created"]: input.sort?.order === "asc" ? 1 : -1,
          },
        },
        { $skip: offset },
        { $limit: limit },
      ];

  // Wrap in $facet so we get the result set AND the total count in
  // ONE roundtrip. The count branch is a simple $count after the
  // shared $match.
  const pipeline: Record<string, unknown>[] = [
    { $match: matchDoc },
    {
      $facet: {
        data: dataBranch,
        count: [{ $count: "total" }],
      },
    },
  ];

  let raw: Array<{ data: Record<string, unknown>[]; count: { total?: number }[] }>;
  try {
    raw = (await col.aggregate(pipeline).toArray()) as typeof raw;
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        merchant: merchantCtx.businessName,
        filters: input.filters,
        aggregate: input.aggregate,
      },
      "query_transactions: MongoDB aggregation failed"
    );
    throw err;
  }

  const facetResult = raw[0] ?? { data: [], count: [] };
  const totalCount = facetResult.count[0]?.total ?? 0;
  const dataRaw = facetResult.data ?? [];
  const executionMs = Date.now() - startedAt;

  const out: QueryTransactionsOutput = {
    total_count: totalCount,
    query_meta: {
      business_ids: merchantCtx.businessIds,
      applied_filters: input.filters,
      truncated: !input.aggregate && totalCount > offset + dataRaw.length,
      execution_ms: executionMs,
    },
  };

  if (input.aggregate) {
    out.aggregates = shapeAggregates(input.aggregate, dataRaw);
  } else {
    out.rows = dataRaw.map(sanitizeRow);
  }

  logger.info(
    {
      merchant: merchantCtx.businessName,
      aggregate: input.aggregate,
      filterCount: Object.keys(input.filters ?? {}).length,
      totalCount,
      returnedRows: out.rows?.length ?? out.aggregates?.length ?? 0,
      executionMs,
    },
    "query_transactions executed"
  );

  return out;
}
