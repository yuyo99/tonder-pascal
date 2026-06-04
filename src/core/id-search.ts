/**
 * AID-86 — Unified ID Search
 *
 * Single source of truth for resolving a precise ID into a matching
 * record across MongoDB's three Pascal-relevant collections:
 *   • mv_payment_transactions
 *   • usrv-withdrawals-withdrawals
 *   • usrv-deposits-spei
 *
 * Replaces three pre-existing inconsistent code paths:
 *   1. queries.ts:lookupById (now wraps this module)
 *   2. query-transactions.ts:queryTransactions.search (now restricted
 *      to filtered list searches, NOT primary ID resolution)
 *   3. queries.ts:directDepositLookup (Telegram partner-bot — TODO
 *      migrate in a follow-up; left intact for now)
 *
 * Key fixes over the previous code paths:
 *
 *   • Input normalization — trim, strip operational prefixes
 *     (WD/TX/DEP/REF/ID + space/dash/colon), generate every variant
 *     a downstream search might need.
 *   • Safe-integer boundary — BC Game IDs are 19 digits and exceed
 *     Number.MAX_SAFE_INTEGER. parseInt() silently loses precision;
 *     we explicitly reject these as numbers and search them only as
 *     strings against payment_customer_order_reference and
 *     metadata_order_id.
 *   • Cross-collection coverage — every search hits all three
 *     collections in parallel by default. The previous
 *     query_transactions search filter only hit transactions, which
 *     was the #1 false-negative source after AID-79b's planner
 *     started preferring that tool.
 *   • Structured diagnostics on miss — returns exactly which fields
 *     in which collections were searched, with what variants, against
 *     which business_ids, over what date range. Pascal can then say
 *     "I searched X across Y but didn't find Z, want me to expand
 *     the date range?" rather than a flat "not found".
 *
 * Sanitization: every returned document goes through provider-mask
 * before reaching Claude. Internal acquirer names (kushki, unlimit,
 * bitso, stp, safetypay, guardian) never enter the model's context.
 */

import type { Collection, Document } from "mongodb";
import { getCollection } from "../mongodb/connection";
import { MerchantContext } from "../merchants/types";
import { getMerchantDisplayName } from "./provider-mask";
import { logger } from "../utils/logger";

const TX_COLLECTION = "mv_payment_transactions";
const WD_COLLECTION = "usrv-withdrawals-withdrawals";
const SPEI_COLLECTION = "usrv-deposits-spei";

// Default search window. Covers the vast majority of "where is this
// transaction" questions (CS rarely asks about records older than 90
// days). If we miss, the diagnostic block tells Sonnet to suggest
// expanding the range.
const DEFAULT_DATE_RANGE_DAYS = 90;

const PREFIX_REGEX = /^(WD|TX|DEP|REF|ID)[\s\-:]+(.+)$/i;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;

/* ─── Types ─────────────────────────────────────────────────────── */

export type CollectionKey = "transactions" | "withdrawals" | "spei";

export interface IdSearchOptions {
  /** Restrict the search to specific collections. Default: all three. */
  collections?: CollectionKey[];
  /**
   * Override the date range. Default: last 90 days (uses `created` for
   * transactions, `created_at` for withdrawals + SPEI deposits).
   */
  dateRange?: { from: Date; to: Date };
  /**
   * Future flag: search across ALL merchants (not just merchantCtx).
   * Kept here for the API contract; not implemented in v1 — always
   * scoped to merchantCtx.businessIds.
   */
  expandToAllMerchants?: boolean;
  /** Per-collection result limit. Default: 5. */
  limit?: number;
}

export interface NormalizedId {
  raw: string;
  trimmed: string;
  lower: string;
  detected_prefix: "WD" | "TX" | "DEP" | "REF" | "ID" | null;
  /** Input with the detected prefix stripped; equals `trimmed` when no prefix. */
  without_prefix: string;
  /** Coerced to a JS number — null when input isn't all-digits or exceeds safe int. */
  as_number: number | null;
  is_uuid: boolean;
  is_email: boolean;
  is_object_id: boolean;
  /** True when input is all-digits but the number would lose precision. */
  exceeds_safe_int: boolean;
}

export interface IdMatch {
  collection: CollectionKey;
  /** Which field in the document matched (e.g. "payment_customer_order_reference"). */
  field_matched: string;
  /** Which normalized variant was matched (e.g. "1234" after stripping "WD"). */
  variant_matched: string;
  /** The matching document, with provider names already masked. */
  document: Record<string, unknown>;
}

export interface IdSearchDiagnostics {
  input_raw: string;
  input_normalized: string;
  detected_prefix: NormalizedId["detected_prefix"];
  variants_tried: {
    raw: string;
    trimmed: string;
    without_prefix: string;
    as_number: number | null;
    is_uuid: boolean;
    is_email: boolean;
    is_object_id: boolean;
    exceeds_safe_int: boolean;
  };
  collections_searched: CollectionKey[];
  fields_searched_per_collection: Record<CollectionKey, string[]>;
  business_ids: number[];
  date_range: { from: string; to: string };
  elapsed_ms: number;
  queries_executed: number;
}

export interface IdSearchResult {
  found: boolean;
  matches: IdMatch[];
  diagnostics: IdSearchDiagnostics;
}

/* ─── Normalization ──────────────────────────────────────────────── */

/**
 * Pure function. Produces every variant a downstream search needs.
 * No DB calls. Called once per searchById invocation.
 */
export function normalizeIdInput(raw: string): NormalizedId {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  const prefixMatch = trimmed.match(PREFIX_REGEX);
  const detected_prefix = prefixMatch
    ? (prefixMatch[1].toUpperCase() as NormalizedId["detected_prefix"])
    : null;
  const without_prefix = prefixMatch ? prefixMatch[2].trim() : trimmed;

  const allDigits = /^\d+$/.test(without_prefix);
  let as_number: number | null = null;
  let exceeds_safe_int = false;
  if (allDigits) {
    const n = Number(without_prefix);
    if (Number.isSafeInteger(n)) {
      as_number = n;
    } else {
      exceeds_safe_int = true;
    }
  }

  return {
    raw,
    trimmed,
    lower,
    detected_prefix,
    without_prefix,
    as_number,
    is_uuid: UUID_REGEX.test(without_prefix),
    is_email: EMAIL_REGEX.test(without_prefix),
    is_object_id: OBJECT_ID_REGEX.test(without_prefix),
    exceeds_safe_int,
  };
}

/* ─── Per-collection search adapters ─────────────────────────────── */

interface AdapterContext {
  normalized: NormalizedId;
  merchantCtx: MerchantContext;
  dateRange: { from: Date; to: Date };
  limit: number;
}

/**
 * mv_payment_transactions — searches:
 *   payment_id (number + string), order_id (number + string),
 *   payment_customer_order_reference (string),
 *   metadata_order_id (string),
 *   transaction_reference (string),
 *   tracking_key (string — kept even though sparse),
 *   customer_email (case-insensitive — only when input is an email).
 *
 * For 19+ digit numeric inputs (BC Game): restricts to
 * payment_customer_order_reference + metadata_order_id (the only places
 * those IDs live) to avoid expensive false-match searches on shorter
 * numeric fields.
 */
async function searchTransactionsAdapter(
  ctx: AdapterContext,
): Promise<{ matches: IdMatch[]; fields_searched: string[] }> {
  const col = getCollection(TX_COLLECTION);
  const { normalized, merchantCtx, dateRange, limit } = ctx;

  const orConditions: Record<string, unknown>[] = [];
  const fields_searched: string[] = [];

  if (normalized.exceeds_safe_int) {
    // BC Game-style 19-digit string. Only search the two fields where
    // these IDs are actually stored. Sort oldest-first (original txn,
    // not retry).
    orConditions.push({ payment_customer_order_reference: normalized.without_prefix });
    orConditions.push({ metadata_order_id: normalized.without_prefix });
    fields_searched.push("payment_customer_order_reference", "metadata_order_id");
  } else {
    // Standard fan-out across all canonical fields.
    orConditions.push({ payment_customer_order_reference: normalized.without_prefix });
    orConditions.push({ metadata_order_id: normalized.without_prefix });
    orConditions.push({ transaction_reference: normalized.without_prefix });
    orConditions.push({ tracking_key: normalized.without_prefix });
    fields_searched.push(
      "payment_customer_order_reference",
      "metadata_order_id",
      "transaction_reference",
      "tracking_key",
    );

    if (normalized.as_number !== null) {
      orConditions.push({ payment_id: normalized.as_number });
      orConditions.push({ order_id: normalized.as_number });
      fields_searched.push("payment_id (numeric)", "order_id (numeric)");
    } else {
      // Non-numeric string — also try string-typed payment_id/order_id
      // for rare records that store them as strings.
      orConditions.push({ payment_id: normalized.without_prefix });
      orConditions.push({ order_id: normalized.without_prefix });
      fields_searched.push("payment_id (string)", "order_id (string)");
    }

    if (normalized.is_email) {
      orConditions.push({
        customer_email: { $regex: `^${escapeRegex(normalized.without_prefix)}$`, $options: "i" },
      });
      fields_searched.push("customer_email (case-insensitive)");
    }
  }

  const businessIdFilter = scopedBusinessIdFilter(merchantCtx.businessIds);

  const raw = await col
    .find(
      {
        business_id: businessIdFilter,
        created: { $gte: dateRange.from, $lte: dateRange.to },
        $or: orConditions,
      },
      {
        projection: {
          payment_id: 1,
          order_id: 1,
          transaction_reference: 1,
          tracking_key: 1,
          payment_customer_order_reference: 1,
          metadata_order_id: 1,
          status: 1,
          amount: 1,
          acq: 1,
          provider: 1,
          created: 1,
          customer_email: 1,
          business_name: 1,
          decline_code: 1,
          decline_description: 1,
          _id: 0,
        },
        sort: { created: normalized.exceeds_safe_int ? 1 : -1 },
        limit,
      },
    )
    .toArray();

  const matches = raw.map((doc) =>
    buildTransactionMatch(doc as Record<string, unknown>, normalized),
  );
  return { matches, fields_searched };
}

/**
 * usrv-withdrawals-withdrawals — searches:
 *   id (UUID string), tracking_key (string), metadata.orderId (nested),
 *   metadata.order_id (nested alternate spelling), _id (ObjectId when
 *   input matches the 24-hex pattern).
 *
 * Notable: top-level `orderId` is NOT searched. Live data sampling
 * confirmed that field never appears at the top level — only inside
 * metadata. Searching top-level orderId was dead code in the old
 * findInWithdrawals.
 */
async function searchWithdrawalsAdapter(
  ctx: AdapterContext,
): Promise<{ matches: IdMatch[]; fields_searched: string[] }> {
  const col = getCollection(WD_COLLECTION);
  const { normalized, merchantCtx, dateRange, limit } = ctx;

  const orConditions: Record<string, unknown>[] = [
    { id: normalized.without_prefix },
    { tracking_key: normalized.without_prefix },
    { "metadata.orderId": normalized.without_prefix },
    { "metadata.order_id": normalized.without_prefix },
  ];
  const fields_searched = [
    "id",
    "tracking_key",
    "metadata.orderId",
    "metadata.order_id",
  ];

  // _id is a Mongo ObjectId — only attempt if the input matches that
  // pattern; otherwise the search would throw a cast error.
  if (normalized.is_object_id) {
    try {
      const { ObjectId } = await import("mongodb");
      orConditions.push({ _id: new ObjectId(normalized.without_prefix) });
      fields_searched.push("_id (ObjectId)");
    } catch {
      // ObjectId construction failed despite regex — skip silently.
    }
  }

  // Withdrawals store business_id as a STRING. Use the str array.
  const businessIdFilter = scopedBusinessIdFilter(
    merchantCtx.businessIdStrs,
  );

  const raw = await col
    .find(
      {
        business_id: businessIdFilter,
        created_at: { $gte: dateRange.from, $lte: dateRange.to },
        $or: orConditions,
      },
      {
        projection: {
          id: 1,
          tracking_key: 1,
          status: 1,
          monetary_amount: 1,
          created_at: 1,
          paid_at: 1,
          "action.reason": 1,
          "action.action": 1,
          "metadata.orderId": 1,
          "metadata.order_id": 1,
          _id: 0,
        },
        sort: { created_at: -1 },
        limit,
      },
    )
    .toArray();

  const matches = raw.map((doc) =>
    buildWithdrawalMatch(doc as Record<string, unknown>, normalized),
  );
  return { matches, fields_searched };
}

/**
 * usrv-deposits-spei — searches:
 *   deposit_id (UUID), checkout_id (UUID), reference (string),
 *   transaction_reference (string), provider_reference (string),
 *   metadata.orderId (nested string), payment_id (numeric — links to
 *   transactions), order_id (numeric),
 *   response.webhook.payload.details.clave_rastreo (deeply nested,
 *   SPEI bank tracking).
 */
async function searchSpeiAdapter(
  ctx: AdapterContext,
): Promise<{ matches: IdMatch[]; fields_searched: string[] }> {
  const col = getCollection(SPEI_COLLECTION);
  const { normalized, merchantCtx, dateRange, limit } = ctx;

  const orConditions: Record<string, unknown>[] = [
    { deposit_id: normalized.without_prefix },
    { checkout_id: normalized.without_prefix },
    { reference: normalized.without_prefix },
    { transaction_reference: normalized.without_prefix },
    { provider_reference: normalized.without_prefix },
    { "metadata.orderId": normalized.without_prefix },
    { "response.webhook.payload.details.clave_rastreo": normalized.without_prefix },
  ];
  const fields_searched = [
    "deposit_id",
    "checkout_id",
    "reference",
    "transaction_reference",
    "provider_reference",
    "metadata.orderId",
    "response.webhook.payload.details.clave_rastreo",
  ];

  if (normalized.as_number !== null) {
    orConditions.push({ payment_id: normalized.as_number });
    orConditions.push({ order_id: normalized.as_number });
    fields_searched.push("payment_id (numeric)", "order_id (numeric)");
  }

  const businessIdFilter = scopedBusinessIdFilter(merchantCtx.businessIdStrs);

  const raw = await col
    .find(
      {
        business_id: businessIdFilter,
        created_at: { $gte: dateRange.from, $lte: dateRange.to },
        $or: orConditions,
      },
      {
        projection: {
          deposit_id: 1,
          checkout_id: 1,
          reference: 1,
          transaction_reference: 1,
          provider_reference: 1,
          payment_id: 1,
          order_id: 1,
          status: 1,
          amount: 1,
          created_at: 1,
          paid_at: 1,
          "metadata.orderId": 1,
          "response.webhook.payload.details.clave_rastreo": 1,
          _id: 0,
        },
        sort: { created_at: -1 },
        limit,
      },
    )
    .toArray();

  const matches = raw.map((doc) =>
    buildSpeiMatch(doc as Record<string, unknown>, normalized),
  );
  return { matches, fields_searched };
}

/* ─── Per-doc → IdMatch builders (with provider masking) ────────── */

function buildTransactionMatch(
  doc: Record<string, unknown>,
  normalized: NormalizedId,
): IdMatch {
  const acq = (doc.acq as string) || (doc.provider as string) || "unknown";
  return {
    collection: "transactions",
    field_matched: detectMatchedField(doc, normalized, TX_FIELD_PRIORITY),
    variant_matched: normalized.without_prefix,
    document: {
      payment_id: doc.payment_id,
      order_id: doc.order_id,
      payment_customer_order_reference: doc.payment_customer_order_reference,
      metadata_order_id: doc.metadata_order_id,
      transaction_reference: doc.transaction_reference,
      tracking_key: doc.tracking_key,
      status: doc.status,
      amount: doc.amount,
      payment_method: getMerchantDisplayName(acq),
      created: doc.created,
      customer_email: doc.customer_email,
      decline_code: doc.decline_code,
      decline_description: doc.decline_description,
      business_name: doc.business_name,
    },
  };
}

function buildWithdrawalMatch(
  doc: Record<string, unknown>,
  normalized: NormalizedId,
): IdMatch {
  const monetary = doc.monetary_amount as Record<string, unknown> | undefined;
  const action = doc.action as Record<string, unknown> | undefined;
  return {
    collection: "withdrawals",
    field_matched: detectMatchedField(doc, normalized, WD_FIELD_PRIORITY),
    variant_matched: normalized.without_prefix,
    document: {
      id: doc.id,
      tracking_key: doc.tracking_key,
      status: doc.status,
      amount: parseFloat(String(monetary?.amount)) || 0,
      currency: (monetary?.currency as string) || "MXN",
      created_at: doc.created_at,
      paid_at: doc.paid_at,
      failure_reason: action?.reason ?? null,
    },
  };
}

function buildSpeiMatch(
  doc: Record<string, unknown>,
  normalized: NormalizedId,
): IdMatch {
  return {
    collection: "spei",
    field_matched: detectMatchedField(doc, normalized, SPEI_FIELD_PRIORITY),
    variant_matched: normalized.without_prefix,
    document: {
      deposit_id: doc.deposit_id,
      checkout_id: doc.checkout_id,
      payment_id: doc.payment_id,
      order_id: doc.order_id,
      reference: doc.reference,
      provider_reference: doc.provider_reference,
      transaction_reference: doc.transaction_reference,
      clave_rastreo: extractClaveRastreo(doc),
      metadata_order_id:
        ((doc.metadata as Record<string, unknown>)?.orderId as string) ?? null,
      status: doc.status,
      amount: parseFloat(String(doc.amount)) || 0,
      created_at: doc.created_at,
      paid_at: doc.paid_at,
      payment_method: "SPEI",
    },
  };
}

// Field-priority lists used by detectMatchedField — first matching
// field wins (useful for debugging which $or branch hit).
const TX_FIELD_PRIORITY: string[] = [
  "payment_id",
  "order_id",
  "payment_customer_order_reference",
  "metadata_order_id",
  "transaction_reference",
  "tracking_key",
  "customer_email",
];
const WD_FIELD_PRIORITY: string[] = [
  "id",
  "tracking_key",
  "metadata.orderId",
  "metadata.order_id",
];
const SPEI_FIELD_PRIORITY: string[] = [
  "deposit_id",
  "checkout_id",
  "reference",
  "transaction_reference",
  "provider_reference",
  "metadata.orderId",
  "payment_id",
  "order_id",
];

/**
 * Walk the field priority list and find which field's stored value
 * equals the normalized input. Best-effort — used for telemetry; if
 * we can't determine which field matched, returns "unknown".
 */
function detectMatchedField(
  doc: Record<string, unknown>,
  normalized: NormalizedId,
  priority: string[],
): string {
  for (const field of priority) {
    const val = getNestedField(doc, field);
    if (val == null) continue;
    if (typeof val === "number" && normalized.as_number === val) return field;
    if (typeof val === "string") {
      if (val === normalized.without_prefix) return field;
      if (val.toLowerCase() === normalized.lower) return field;
    }
  }
  return "unknown";
}

function getNestedField(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function extractClaveRastreo(doc: Record<string, unknown>): string | null {
  try {
    const r = doc.response as Record<string, unknown> | undefined;
    const w = r?.webhook as Record<string, unknown> | undefined;
    const p = w?.payload as Record<string, unknown> | undefined;
    const d = p?.details as Record<string, unknown> | undefined;
    return (d?.clave_rastreo as string) || null;
  } catch {
    return null;
  }
}

/* ─── Public entrypoint ──────────────────────────────────────────── */

export async function searchById(
  rawInput: string,
  merchantCtx: MerchantContext,
  opts: IdSearchOptions = {},
): Promise<IdSearchResult> {
  const startedAt = Date.now();
  const normalized = normalizeIdInput(rawInput);

  const collections = opts.collections ?? ["transactions", "withdrawals", "spei"];
  const limit = opts.limit ?? 5;
  const dateRange = opts.dateRange ?? defaultDateRange();

  const ctx: AdapterContext = {
    normalized,
    merchantCtx,
    dateRange,
    limit,
  };

  // Empty / too-short inputs short-circuit with diagnostics.
  if (!normalized.trimmed || normalized.without_prefix.length < 3) {
    return emptyResult(normalized, collections, merchantCtx, dateRange, startedAt, "input too short");
  }

  // Run adapters in parallel; each returns its match list + the
  // fields it searched (for the diagnostics block).
  const results = await Promise.allSettled(
    collections.map((c) => {
      if (c === "transactions") return searchTransactionsAdapter(ctx);
      if (c === "withdrawals") return searchWithdrawalsAdapter(ctx);
      return searchSpeiAdapter(ctx);
    }),
  );

  const matches: IdMatch[] = [];
  const fields_searched_per_collection: Record<string, string[]> = {
    transactions: [],
    withdrawals: [],
    spei: [],
  };
  let queriesExecuted = 0;

  for (let i = 0; i < collections.length; i++) {
    const c = collections[i];
    const r = results[i];
    queriesExecuted += 1;
    if (r.status === "fulfilled") {
      matches.push(...r.value.matches);
      fields_searched_per_collection[c] = r.value.fields_searched;
    } else {
      logger.warn(
        { err: r.reason, collection: c, input: rawInput },
        "id-search: adapter failed",
      );
      fields_searched_per_collection[c] = ["(failed)"];
    }
  }

  const elapsed_ms = Date.now() - startedAt;
  const found = matches.length > 0;

  const diagnostics: IdSearchDiagnostics = {
    input_raw: rawInput,
    input_normalized: normalized.without_prefix,
    detected_prefix: normalized.detected_prefix,
    variants_tried: {
      raw: normalized.raw,
      trimmed: normalized.trimmed,
      without_prefix: normalized.without_prefix,
      as_number: normalized.as_number,
      is_uuid: normalized.is_uuid,
      is_email: normalized.is_email,
      is_object_id: normalized.is_object_id,
      exceeds_safe_int: normalized.exceeds_safe_int,
    },
    collections_searched: collections,
    fields_searched_per_collection: fields_searched_per_collection as Record<
      CollectionKey,
      string[]
    >,
    business_ids: merchantCtx.businessIds,
    date_range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    },
    elapsed_ms,
    queries_executed: queriesExecuted,
  };

  logger.info(
    {
      input: rawInput,
      normalized: normalized.without_prefix,
      prefix: normalized.detected_prefix,
      merchant: merchantCtx.businessName,
      found,
      match_count: matches.length,
      collections,
      elapsed_ms,
    },
    found ? "id-search: hit" : "id-search: miss",
  );

  return { found, matches, diagnostics };
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultDateRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getTime() - DEFAULT_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from, to: now };
}

function scopedBusinessIdFilter<T>(ids: T[]): T | { $in: T[] } {
  return ids.length === 1 ? ids[0] : { $in: ids };
}

function emptyResult(
  normalized: NormalizedId,
  collections: CollectionKey[],
  merchantCtx: MerchantContext,
  dateRange: { from: Date; to: Date },
  startedAt: number,
  reason: string,
): IdSearchResult {
  logger.info(
    { input: normalized.raw, reason, merchant: merchantCtx.businessName },
    "id-search: skipped (precondition failed)",
  );
  return {
    found: false,
    matches: [],
    diagnostics: {
      input_raw: normalized.raw,
      input_normalized: normalized.without_prefix,
      detected_prefix: normalized.detected_prefix,
      variants_tried: {
        raw: normalized.raw,
        trimmed: normalized.trimmed,
        without_prefix: normalized.without_prefix,
        as_number: normalized.as_number,
        is_uuid: normalized.is_uuid,
        is_email: normalized.is_email,
        is_object_id: normalized.is_object_id,
        exceeds_safe_int: normalized.exceeds_safe_int,
      },
      collections_searched: collections,
      fields_searched_per_collection: collections.reduce(
        (acc, c) => ({ ...acc, [c]: [`(skipped: ${reason})`] }),
        {} as Record<CollectionKey, string[]>,
      ),
      business_ids: merchantCtx.businessIds,
      date_range: {
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      },
      elapsed_ms: Date.now() - startedAt,
      queries_executed: 0,
    },
  };
}

// eslint suppression: Collection import kept for downstream module
// consumers that may want to introspect the raw type.
type _CollectionsUsed = Collection<Document>;
void (null as unknown as _CollectionsUsed);
