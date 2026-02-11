import { getCollection } from "./connection";
import { DateRange } from "../utils/dates";
import { getMerchantDisplayName } from "../core/provider-mask";

const TX_COLLECTION = "mv_payment_transactions";
const WD_COLLECTION = "usrv-withdrawals-withdrawals";
const SPEI_COLLECTION = "usrv-deposits-spei";
const BIZ_COLLECTION = "business_business";

// Acquirers for card payments (merged into one "Cards" rate)
const CARD_ACQUIRERS = ["kushki", "unlimit", "guardian", "tonder"];
const APM_ACQUIRERS = ["bitso", "stp", "oxxopay", "mercadopago", "safetypay"];
const ALL_RATE_ACQUIRERS = ["kushki", "unlimit", ...APM_ACQUIRERS];
const RATE_STATUSES_LOWER = ["success", "declined", "expired", "pending", "failed"];

// ── Match builders (support single or multi business IDs via $in) ────

function buildTxMatch(dateRange: DateRange, businessIds: number[]): Record<string, unknown> {
  return {
    created: { $gte: dateRange.start, $lte: dateRange.end },
    business_id: businessIds.length === 1 ? businessIds[0] : { $in: businessIds },
  };
}

function buildWdMatch(dateRange: DateRange, businessIdStrs: string[]): Record<string, unknown> {
  return {
    created_at: { $gte: dateRange.start, $lte: dateRange.end },
    business_id: businessIdStrs.length === 1 ? businessIdStrs[0] : { $in: businessIdStrs },
  };
}

function buildSpeiMatch(dateRange: DateRange, businessIdStrs: string[]): Record<string, unknown> {
  return {
    created_at: { $gte: dateRange.start, $lte: dateRange.end },
    business_id: businessIdStrs.length === 1 ? businessIdStrs[0] : { $in: businessIdStrs },
  };
}

// ── Acceptance Rate: Cards vs APMs ──────────────────────────────────

export interface RateBucket {
  category: "cards" | "apm";
  displayName: string;
  successCount: number;
  totalCount: number;
  rateByCount: number;
  successVolume: number;
  totalVolume: number;
  rateByVolume: number;
}

export interface AcceptanceRates {
  cards: RateBucket | null;
  apms: RateBucket[];
}

export async function getAcceptanceRates(
  dateRange: DateRange,
  businessIds: number[]
): Promise<AcceptanceRates> {
  const col = getCollection(TX_COLLECTION);

  const rawResults = await col
    .aggregate([
      {
        $match: {
          created: { $gte: dateRange.start, $lte: dateRange.end },
          business_id: businessIds.length === 1 ? businessIds[0] : { $in: businessIds },
          transaction_type: "PAYMENT",
          $or: [
            { acq: { $in: ALL_RATE_ACQUIRERS } },
            { provider: "guardian" },
          ],
          payment_id: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $addFields: {
          acq: {
            $cond: [{ $eq: ["$provider", "guardian"] }, "guardian", "$acq"],
          },
        },
      },
      { $addFields: { status_lower: { $toLower: "$status" } } },
      { $match: { status_lower: { $in: RATE_STATUSES_LOWER } } },
      { $sort: { created: -1 } },
      {
        $group: {
          _id: "$payment_id",
          status_lower: { $first: "$status_lower" },
          amount: { $first: "$amount" },
          acq: { $first: "$acq" },
        },
      },
      {
        $group: {
          _id: "$acq",
          totalCount: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ["$status_lower", "success"] }, 1, 0] },
          },
          totalVolume: { $sum: "$amount" },
          successVolume: {
            $sum: { $cond: [{ $eq: ["$status_lower", "success"] }, "$amount", 0] },
          },
        },
      },
    ])
    .toArray();

  // Post-process: merge card acquirers, map APMs to display names
  let cards: RateBucket | null = null;
  const apms: RateBucket[] = [];

  for (const row of rawResults) {
    const acq = row._id as string;
    const bucket = {
      successCount: row.successCount as number,
      totalCount: row.totalCount as number,
      successVolume: parseFloat(String(row.successVolume)),
      totalVolume: parseFloat(String(row.totalVolume)),
    };

    if (CARD_ACQUIRERS.includes(acq)) {
      if (!cards) {
        cards = {
          category: "cards",
          displayName: "Cards",
          ...bucket,
          rateByCount: bucket.totalCount > 0 ? (bucket.successCount / bucket.totalCount) * 100 : 0,
          rateByVolume: bucket.totalVolume > 0 ? (bucket.successVolume / bucket.totalVolume) * 100 : 0,
        };
      } else {
        cards.successCount += bucket.successCount;
        cards.totalCount += bucket.totalCount;
        cards.successVolume += bucket.successVolume;
        cards.totalVolume += bucket.totalVolume;
        cards.rateByCount = cards.totalCount > 0 ? (cards.successCount / cards.totalCount) * 100 : 0;
        cards.rateByVolume = cards.totalVolume > 0 ? (cards.successVolume / cards.totalVolume) * 100 : 0;
      }
    } else {
      const displayName = getMerchantDisplayName(acq);
      const rateByCount = bucket.totalCount > 0 ? (bucket.successCount / bucket.totalCount) * 100 : 0;
      const rateByVolume = bucket.totalVolume > 0 ? (bucket.successVolume / bucket.totalVolume) * 100 : 0;
      apms.push({
        category: "apm",
        displayName,
        ...bucket,
        rateByCount,
        rateByVolume,
      });
    }
  }

  return { cards, apms };
}

// ── Transaction Volume ──────────────────────────────────────────────

export async function getTransactionVolume(
  dateRange: DateRange,
  businessIds: number[]
): Promise<{
  totalVolume: number;
  successVolume: number;
  totalCount: number;
  successCount: number;
  avgTicket: number;
  currency: string;
}> {
  const col = getCollection(TX_COLLECTION);
  const match = buildTxMatch(dateRange, businessIds);

  const result = await col
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalVolume: { $sum: "$amount" },
          successVolume: {
            $sum: { $cond: [{ $eq: ["$status", "Success"] }, "$amount", 0] },
          },
          totalCount: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ["$status", "Success"] }, 1, 0] },
          },
        },
      },
    ])
    .toArray();

  if (!result[0] || result[0].totalCount === 0) {
    return { totalVolume: 0, successVolume: 0, totalCount: 0, successCount: 0, avgTicket: 0, currency: "MXN" };
  }

  const r = result[0];
  return {
    totalVolume: r.totalVolume,
    successVolume: r.successVolume,
    totalCount: r.totalCount,
    successCount: r.successCount,
    avgTicket: r.successCount > 0 ? r.successVolume / r.successCount : 0,
    currency: "MXN",
  };
}

// ── Top Declines ────────────────────────────────────────────────────

export async function getTopDeclines(
  dateRange: DateRange,
  businessIds: number[],
  limit: number = 10
): Promise<{ code: string; description: string; count: number }[]> {
  const col = getCollection(TX_COLLECTION);
  const match: Record<string, unknown> = {
    ...buildTxMatch(dateRange, businessIds),
    status: "Declined",
  };

  const result = await col
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            code: { $ifNull: ["$decline_code", "unknown"] },
            description: { $ifNull: ["$decline_description", "No description"] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          code: "$_id.code",
          description: "$_id.description",
          count: 1,
        },
      },
    ])
    .toArray();

  return result as { code: string; description: string; count: number }[];
}

// ── Transactions by Status ──────────────────────────────────────────

export async function getTransactionsByStatus(
  dateRange: DateRange,
  businessIds: number[]
): Promise<{ status: string; count: number; volume: number }[]> {
  const col = getCollection(TX_COLLECTION);
  const match = buildTxMatch(dateRange, businessIds);

  const result = await col
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          volume: { $sum: "$amount" },
        },
      },
      { $sort: { count: -1 } },
      { $project: { _id: 0, status: "$_id", count: 1, volume: 1 } },
    ])
    .toArray();

  return result as { status: string; count: number; volume: number }[];
}

// ── Withdrawal Status ───────────────────────────────────────────────

export async function getWithdrawalStatus(
  dateRange: DateRange,
  businessIdStrs: string[]
): Promise<{
  total: number;
  totalAmount: number;
  byStatus: { status: string; count: number; amount: number }[];
}> {
  const col = getCollection(WD_COLLECTION);
  const match = buildWdMatch(dateRange, businessIdStrs);

  const result = await col
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$monetary_amount.amount" },
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();

  const byStatus = result.map((r) => ({
    status: r._id as string,
    count: r.count as number,
    amount: parseFloat(String(r.amount)) || 0,
  }));

  return {
    total: byStatus.reduce((s, r) => s + r.count, 0),
    totalAmount: byStatus.reduce((s, r) => s + r.amount, 0),
    byStatus,
  };
}

// ── Universal ID Lookup ─────────────────────────────────────────────

export interface LookupResult {
  source: "transaction" | "withdrawal" | "spei_deposit";
  data: Record<string, unknown>;
}

/**
 * Search ALL collections and ALL ID fields for a given identifier.
 * Runs all three searches in parallel and returns the first match(es).
 */
export async function lookupById(
  id: string,
  businessIds: number[],
  businessIdStrs: string[]
): Promise<LookupResult[]> {
  const idAsNumber = parseInt(id, 10);
  const numericId = !isNaN(idAsNumber) ? idAsNumber : null;

  const [txResults, wdResults, speiResults] = await Promise.all([
    findInTransactions(id, numericId, businessIds),
    findInWithdrawals(id, businessIdStrs),
    findInSpeiDeposits(id, numericId, businessIdStrs),
  ]);

  const results: LookupResult[] = [];

  for (const tx of txResults) {
    const acq = (tx.acq as string) || (tx.provider as string) || "unknown";
    results.push({
      source: "transaction",
      data: {
        payment_id: tx.payment_id,
        order_id: tx.order_id,
        transaction_reference: tx.transaction_reference,
        tracking_key: tx.tracking_key,
        status: tx.status,
        amount: tx.amount,
        paymentMethod: getMerchantDisplayName(acq),
        created: tx.created,
        customer_email: tx.customer_email,
        decline_code: tx.decline_code,
        decline_description: tx.decline_description,
        business_name: tx.business_name,
      },
    });
  }

  for (const wd of wdResults) {
    const monetaryAmount = wd.monetary_amount as Record<string, unknown> | undefined;
    const action = wd.action as Record<string, unknown> | undefined;
    results.push({
      source: "withdrawal",
      data: {
        id: wd.id,
        tracking_key: wd.tracking_key,
        status: wd.status,
        amount: parseFloat(String(monetaryAmount?.amount)) || 0,
        currency: (monetaryAmount?.currency as string) || "MXN",
        created_at: wd.created_at,
        paid_at: wd.paid_at,
        failure_reason: action?.reason || null,
      },
    });
  }

  for (const spei of speiResults) {
    results.push({
      source: "spei_deposit",
      data: {
        deposit_id: spei.deposit_id,
        order_id: spei.order_id,
        checkout_id: spei.checkout_id,
        reference: spei.reference,
        clave_rastreo: extractClaveRastreo(spei),
        status: spei.status,
        amount: parseFloat(String(spei.amount)) || 0,
        created_at: spei.created_at,
        paymentMethod: "SPEI",
      },
    });
  }

  return results;
}

async function findInTransactions(
  id: string,
  numericId: number | null,
  businessIds: number[]
): Promise<Record<string, unknown>[]> {
  const col = getCollection(TX_COLLECTION);
  const orConditions: Record<string, unknown>[] = [
    { transaction_reference: id },
    { metadata_order_id: id },
  ];
  if (numericId !== null) {
    orConditions.push({ payment_id: numericId });
    orConditions.push({ order_id: numericId });
  }
  // Also try string match for payment_id/order_id
  orConditions.push({ payment_id: id });
  orConditions.push({ order_id: id });
  orConditions.push({ tracking_key: id });

  const bizFilter = businessIds.length === 1 ? businessIds[0] : { $in: businessIds };
  const results = await col
    .find(
      { business_id: bizFilter, $or: orConditions },
      {
        projection: {
          payment_id: 1, order_id: 1, transaction_reference: 1, tracking_key: 1,
          status: 1, amount: 1, acq: 1, provider: 1,
          created: 1, customer_email: 1, business_name: 1,
          decline_code: 1, decline_description: 1, _id: 0,
        },
        sort: { created: -1 },
        limit: 5,
      }
    )
    .toArray();

  return results as Record<string, unknown>[];
}

async function findInWithdrawals(
  id: string,
  businessIdStrs: string[]
): Promise<Record<string, unknown>[]> {
  const col = getCollection(WD_COLLECTION);
  const bizFilter = businessIdStrs.length === 1 ? businessIdStrs[0] : { $in: businessIdStrs };
  const results = await col
    .find(
      {
        business_id: bizFilter,
        $or: [
          { id: id },
          { orderId: id },
          { tracking_key: id },
        ],
      },
      {
        projection: {
          id: 1, tracking_key: 1, status: 1,
          monetary_amount: 1, created_at: 1, paid_at: 1,
          "action.reason": 1, "action.action": 1, _id: 0,
        },
        sort: { created_at: -1 },
        limit: 5,
      }
    )
    .toArray();

  return results as Record<string, unknown>[];
}

/** Extract clave_rastreo from deeply nested SPEI webhook response */
function extractClaveRastreo(doc: Record<string, unknown>): string | null {
  try {
    const resp = doc.response as Record<string, unknown> | undefined;
    const webhook = resp?.webhook as Record<string, unknown> | undefined;
    const payload = webhook?.payload as Record<string, unknown> | undefined;
    const details = payload?.details as Record<string, unknown> | undefined;
    return (details?.clave_rastreo as string) || null;
  } catch {
    return null;
  }
}

async function findInSpeiDeposits(
  id: string,
  numericId: number | null,
  businessIdStrs: string[]
): Promise<Record<string, unknown>[]> {
  const col = getCollection(SPEI_COLLECTION);
  const orConditions: Record<string, unknown>[] = [
    { deposit_id: id },
    { checkout_id: id },
    { reference: id },
    { transaction_reference: id },
    { provider_reference: id },
  ];
  if (numericId !== null) {
    orConditions.push({ order_id: numericId });
  }
  orConditions.push({ order_id: id });
  orConditions.push({ "response.webhook.payload.details.clave_rastreo": id });

  const bizFilter = businessIdStrs.length === 1 ? businessIdStrs[0] : { $in: businessIdStrs };
  const results = await col
    .find(
      { business_id: bizFilter, $or: orConditions },
      {
        projection: {
          deposit_id: 1, order_id: 1, checkout_id: 1,
          reference: 1, "response.webhook.payload.details.clave_rastreo": 1,
          status: 1, amount: 1,
          created_at: 1, _id: 0,
        },
        sort: { created_at: -1 },
        limit: 5,
      }
    )
    .toArray();

  return results as Record<string, unknown>[];
}

// ── List Recent Transactions ────────────────────────────────────────

export async function listRecentTransactions(
  dateRange: DateRange,
  businessIds: number[],
  status?: string,
  limit: number = 10
): Promise<Record<string, unknown>[]> {
  const col = getCollection(TX_COLLECTION);
  const match: Record<string, unknown> = buildTxMatch(dateRange, businessIds);
  if (status) {
    match.status = { $regex: new RegExp(`^${status}$`, "i") };
  }

  const results = await col
    .find(match, {
      projection: {
        payment_id: 1, order_id: 1, status: 1, amount: 1,
        acq: 1, provider: 1, created: 1, customer_email: 1, _id: 0,
      },
      sort: { created: -1 },
      limit: Math.min(limit, 25),
    })
    .toArray();

  return results.map((r) => ({
    ...r,
    paymentMethod: getMerchantDisplayName(
      (r.acq as string) || (r.provider as string) || "unknown"
    ),
  }));
}

// ── List Recent Withdrawals ─────────────────────────────────────────

export async function listRecentWithdrawals(
  dateRange: DateRange,
  businessIdStrs: string[],
  status?: string,
  limit: number = 10
): Promise<Record<string, unknown>[]> {
  const col = getCollection(WD_COLLECTION);
  const match: Record<string, unknown> = buildWdMatch(dateRange, businessIdStrs);
  if (status) {
    match.status = { $regex: new RegExp(status, "i") };
  }

  const results = await col
    .find(match, {
      projection: {
        id: 1, tracking_key: 1, status: 1,
        monetary_amount: 1, created_at: 1, paid_at: 1, _id: 0,
      },
      sort: { created_at: -1 },
      limit: Math.min(limit, 25),
    })
    .toArray();

  return results.map((r) => ({
    id: r.id,
    tracking_key: r.tracking_key,
    status: r.status,
    amount: parseFloat(String((r.monetary_amount as Record<string, unknown>)?.amount)) || 0,
    currency: (r.monetary_amount as Record<string, unknown>)?.currency || "MXN",
    created_at: r.created_at,
    paid_at: r.paid_at,
  }));
}

// ── SPEI Deposit Lookup ─────────────────────────────────────────────

export async function lookupSpeiDeposits(
  dateRange: DateRange,
  businessIdStrs: string[],
  amount?: number,
  status?: string,
  reference?: string,
  limit: number = 10
): Promise<Record<string, unknown>[]> {
  const col = getCollection(SPEI_COLLECTION);
  const match: Record<string, unknown> = buildSpeiMatch(dateRange, businessIdStrs);
  if (amount) match.amount = amount;
  if (status) match.status = { $regex: new RegExp(status, "i") };
  if (reference) match.reference = { $regex: new RegExp(reference, "i") };

  const results = await col
    .find(match, {
      projection: {
        deposit_id: 1, order_id: 1, checkout_id: 1,
        reference: 1, "response.webhook.payload.details.clave_rastreo": 1,
        status: 1, amount: 1,
        created_at: 1, _id: 0,
      },
      sort: { created_at: -1 },
      limit: Math.min(limit, 25),
    })
    .toArray();

  return results.map((r) => ({
    deposit_id: r.deposit_id,
    order_id: r.order_id,
    checkout_id: r.checkout_id,
    reference: r.reference,
    clave_rastreo: extractClaveRastreo(r as Record<string, unknown>),
    status: r.status,
    amount: parseFloat(String(r.amount)) || 0,
    created_at: r.created_at,
    paymentMethod: "SPEI",
  }));
}

// ── Business List (for startup cache) ───────────────────────────────

export async function loadBusinessList(): Promise<{ id: number; name: string }[]> {
  const col = getCollection(BIZ_COLLECTION);
  const result = await col
    .find({}, { projection: { id: 1, name: 1, _id: 0 } })
    .toArray();
  return result as unknown as { id: number; name: string }[];
}
