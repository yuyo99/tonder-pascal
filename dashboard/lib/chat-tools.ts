import Anthropic from "@anthropic-ai/sdk";
import { connectMongo } from "./mongo";
import type { Document } from "mongodb";

/* ─── Blocked aggregation stages (write operations) ─── */
const BLOCKED_STAGES = ["$out", "$merge", "$set", "$unset", "$rename", "$currentOp", "$listSessions"];

const MAX_DOCS = 50;
const QUERY_TIMEOUT_MS = 15_000;

/* ─── Tool definitions for Claude ─── */

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "list_collections",
    description:
      "List all collections available in the MongoDB database. Use this first if you need to discover what data is available.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "get_collection_schema",
    description:
      "Sample documents from a collection to understand its field structure. Returns field names and example values from a few sample documents.",
    input_schema: {
      type: "object" as const,
      properties: {
        collection: {
          type: "string",
          description: "Name of the collection to sample (e.g., 'mv_payment_transactions').",
        },
        sample_size: {
          type: "number",
          description: "Number of documents to sample (default: 3, max: 5).",
        },
      },
      required: ["collection"],
    },
  },
  {
    name: "query_mongodb",
    description:
      "Run a read-only MongoDB query (find or aggregate) on any collection. Results are limited to 50 documents. Use 'find' for simple lookups and 'aggregate' for complex queries with grouping, sorting, etc. All write operations are blocked.",
    input_schema: {
      type: "object" as const,
      properties: {
        collection: {
          type: "string",
          description: "Collection name to query.",
        },
        operation: {
          type: "string",
          enum: ["find", "aggregate"],
          description: "'find' for simple queries with filter/projection, 'aggregate' for pipeline queries.",
        },
        filter: {
          type: "object",
          description:
            "For 'find': MongoDB query filter (e.g., {payment_id: 3718026}). Ignored for 'aggregate'.",
        },
        projection: {
          type: "object",
          description:
            "For 'find': fields to include/exclude (e.g., {payment_id: 1, status: 1, _id: 0}). Ignored for 'aggregate'.",
        },
        sort: {
          type: "object",
          description: "For 'find': sort order (e.g., {created: -1}). Ignored for 'aggregate'.",
        },
        limit: {
          type: "number",
          description: "Max documents to return (default: 20, max: 50).",
        },
        pipeline: {
          type: "array",
          description:
            "For 'aggregate': array of aggregation pipeline stages. Write stages ($out, $merge, etc.) are blocked.",
        },
      },
      required: ["collection", "operation"],
    },
  },
  {
    name: "get_acceptance_rate",
    description:
      "Get acceptance rates for Cards (kushki + unlimit combined) and APMs (one rate per acquirer). Deduplicates by payment_id automatically. Returns both count-based and volume-based rates. Use date_range keywords OR start_date + end_date for custom ranges.",
    input_schema: {
      type: "object" as const,
      properties: {
        business_name: {
          type: "string",
          description: "Business/merchant name (e.g., 'BCGAME', 'Caliente'). Leave empty for all businesses.",
        },
        date_range: {
          type: "string",
          description:
            "Time range keyword: 'today', 'yesterday', 'this week', 'last week', 'this month', 'last month', 'last N days'. Defaults to 'today'.",
        },
        start_date: {
          type: "string",
          description: "Explicit start date ISO format (YYYY-MM-DD). Use with end_date for custom ranges.",
        },
        end_date: {
          type: "string",
          description: "Explicit end date ISO format (YYYY-MM-DD). Use with start_date.",
        },
      },
      required: [] as string[],
    },
  },
];

/* ─── Date range parser ─── */

interface DateRange {
  start: Date;
  end: Date;
}

function parseDateRange(
  dateRange?: string,
  startDate?: string,
  endDate?: string
): DateRange {
  const now = new Date();
  // Convert to Mexico City time for "today" calculations
  const mx = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );

  if (startDate && endDate) {
    const s = new Date(startDate + "T00:00:00-06:00");
    const e = new Date(endDate + "T23:59:59.999-06:00");
    return { start: s, end: e };
  }

  const keyword = (dateRange || "today").toLowerCase().trim();

  const todayStart = new Date(mx);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(mx);
  todayEnd.setHours(23, 59, 59, 999);

  // Offset from Mexico time back to UTC for DB queries
  const offset = now.getTime() - mx.getTime();

  switch (keyword) {
    case "today":
      return {
        start: new Date(todayStart.getTime() + offset),
        end: new Date(todayEnd.getTime() + offset),
      };
    case "yesterday": {
      const ys = new Date(todayStart);
      ys.setDate(ys.getDate() - 1);
      const ye = new Date(todayEnd);
      ye.setDate(ye.getDate() - 1);
      return {
        start: new Date(ys.getTime() + offset),
        end: new Date(ye.getTime() + offset),
      };
    }
    case "this week": {
      const ws = new Date(todayStart);
      ws.setDate(ws.getDate() - ws.getDay()); // Sunday start
      return {
        start: new Date(ws.getTime() + offset),
        end: new Date(todayEnd.getTime() + offset),
      };
    }
    case "last week": {
      const lws = new Date(todayStart);
      lws.setDate(lws.getDate() - lws.getDay() - 7);
      const lwe = new Date(lws);
      lwe.setDate(lwe.getDate() + 6);
      lwe.setHours(23, 59, 59, 999);
      return {
        start: new Date(lws.getTime() + offset),
        end: new Date(lwe.getTime() + offset),
      };
    }
    case "this month": {
      const ms = new Date(mx.getFullYear(), mx.getMonth(), 1);
      return {
        start: new Date(ms.getTime() + offset),
        end: new Date(todayEnd.getTime() + offset),
      };
    }
    case "last month": {
      const lms = new Date(mx.getFullYear(), mx.getMonth() - 1, 1);
      const lme = new Date(mx.getFullYear(), mx.getMonth(), 0, 23, 59, 59, 999);
      return {
        start: new Date(lms.getTime() + offset),
        end: new Date(lme.getTime() + offset),
      };
    }
    default: {
      // "last N days" or "last N hours"
      const daysMatch = keyword.match(/last\s+(\d+)\s+days?/);
      if (daysMatch) {
        const n = parseInt(daysMatch[1]);
        const s = new Date(todayStart);
        s.setDate(s.getDate() - n + 1);
        return {
          start: new Date(s.getTime() + offset),
          end: new Date(todayEnd.getTime() + offset),
        };
      }
      const hoursMatch = keyword.match(/last\s+(\d+)\s+hours?/);
      if (hoursMatch) {
        const n = parseInt(hoursMatch[1]);
        return {
          start: new Date(now.getTime() - n * 60 * 60 * 1000),
          end: now,
        };
      }
      // Default to today
      return {
        start: new Date(todayStart.getTime() + offset),
        end: new Date(todayEnd.getTime() + offset),
      };
    }
  }
}

/* ─── Tool execution ─── */

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "list_collections":
        return await execListCollections();
      case "get_collection_schema":
        return await execGetSchema(input);
      case "query_mongodb":
        return await execQueryMongodb(input);
      case "get_acceptance_rate":
        return await execAcceptanceRate(input);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: msg });
  }
}

/* ─── list_collections ─── */

async function execListCollections(): Promise<string> {
  const db = await connectMongo();
  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).sort();
  return JSON.stringify({ collections: names, count: names.length });
}

/* ─── get_collection_schema ─── */

async function execGetSchema(input: Record<string, unknown>): Promise<string> {
  const db = await connectMongo();
  const collName = input.collection as string;
  const sampleSize = Math.min((input.sample_size as number) || 3, 5);

  const col = db.collection(collName);
  const docs = await col
    .find({})
    .sort({ _id: -1 })
    .limit(sampleSize)
    .toArray();

  if (docs.length === 0) {
    return JSON.stringify({ collection: collName, message: "Collection is empty", fields: [] });
  }

  // Collect all unique field paths
  const fieldSet = new Set<string>();
  for (const doc of docs) {
    collectFields(doc, "", fieldSet);
  }

  // Return fields + one sample doc (truncated)
  const sample = JSON.parse(JSON.stringify(docs[0]));
  return JSON.stringify({
    collection: collName,
    documentCount: await col.estimatedDocumentCount(),
    fields: Array.from(fieldSet).sort(),
    sampleDocument: sample,
  });
}

function collectFields(obj: Document, prefix: string, fields: Set<string>) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    fields.add(path);
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      // Don't recurse into _id or very deep objects
      if (key !== "_id" && path.split(".").length < 4) {
        collectFields(value as Document, path, fields);
      }
    }
  }
}

/* ─── query_mongodb ─── */

async function execQueryMongodb(input: Record<string, unknown>): Promise<string> {
  const db = await connectMongo();
  const collName = input.collection as string;
  const operation = input.operation as string;
  const limit = Math.min((input.limit as number) || 20, MAX_DOCS);

  const col = db.collection(collName);

  if (operation === "find") {
    const filter = (input.filter as Document) || {};
    const projection = (input.projection as Document) || {};
    const sort = (input.sort as Document) || {};

    const cursor = col.find(filter);
    if (Object.keys(projection).length > 0) cursor.project(projection);
    if (Object.keys(sort).length > 0) cursor.sort(sort);
    cursor.limit(limit);
    cursor.maxTimeMS(QUERY_TIMEOUT_MS);

    const docs = await cursor.toArray();
    return JSON.stringify({
      operation: "find",
      collection: collName,
      count: docs.length,
      results: docs,
    });
  }

  if (operation === "aggregate") {
    const pipeline = (input.pipeline as Document[]) || [];

    // Security: block write stages
    for (const stage of pipeline) {
      const stageKeys = Object.keys(stage);
      for (const key of stageKeys) {
        if (BLOCKED_STAGES.includes(key)) {
          return JSON.stringify({
            error: `Blocked stage: ${key}. Only read-only operations are allowed.`,
          });
        }
      }
    }

    // Add $limit if not present
    const hasLimit = pipeline.some((s) => "$limit" in s);
    if (!hasLimit) {
      pipeline.push({ $limit: limit });
    }

    const docs = await col
      .aggregate(pipeline, { maxTimeMS: QUERY_TIMEOUT_MS })
      .toArray();

    return JSON.stringify({
      operation: "aggregate",
      collection: collName,
      count: docs.length,
      results: docs,
    });
  }

  return JSON.stringify({ error: `Unknown operation: ${operation}. Use 'find' or 'aggregate'.` });
}

/* ─── get_acceptance_rate (ported from Slack bot) ─── */

const CARD_ACQUIRERS = ["kushki", "unlimit", "guardian"];
const APM_ACQUIRERS = ["bitso", "stp", "oxxopay", "mercadopago", "safetypay"];
const ALL_RATE_ACQUIRERS = ["kushki", "unlimit", ...APM_ACQUIRERS];
const RATE_STATUSES_LOWER = ["success", "declined", "expired", "pending", "failed"];

async function execAcceptanceRate(input: Record<string, unknown>): Promise<string> {
  const db = await connectMongo();
  const col = db.collection("mv_payment_transactions");

  const dateRange = parseDateRange(
    input.date_range as string | undefined,
    input.start_date as string | undefined,
    input.end_date as string | undefined
  );

  // Resolve business name to ID if provided
  let businessId: number | undefined;
  const businessName = input.business_name as string | undefined;
  if (businessName) {
    const bizCol = db.collection("business_business");
    const biz = await bizCol.findOne({
      name: { $regex: new RegExp(businessName, "i") },
    });
    if (biz) {
      businessId = biz.id as number;
    } else {
      // List available businesses
      const allBiz = await bizCol
        .find({ is_active: true })
        .project({ name: 1, _id: 0 })
        .toArray();
      return JSON.stringify({
        error: `Business "${businessName}" not found.`,
        availableBusinesses: allBiz.map((b) => b.name),
      });
    }
  }

  const matchFilter: Record<string, unknown> = {
    created: { $gte: dateRange.start, $lte: dateRange.end },
    transaction_type: "PAYMENT",
    $or: [
      { acq: { $in: ALL_RATE_ACQUIRERS } },
      { provider: "guardian" },
    ],
    payment_id: { $exists: true, $nin: [null, ""] },
  };
  if (businessId) matchFilter.business_id = businessId;

  const rawResults = await col
    .aggregate(
      [
        { $match: matchFilter },
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
            business_id: { $first: "$business_id" },
            business_name: { $first: "$business_name" },
          },
        },
        {
          $group: {
            _id: {
              business_id: "$business_id",
              business_name: "$business_name",
              acq: "$acq",
            },
            totalCount: { $sum: 1 },
            successCount: {
              $sum: { $cond: [{ $eq: ["$status_lower", "success"] }, 1, 0] },
            },
            totalVolume: { $sum: "$amount" },
            successVolume: {
              $sum: {
                $cond: [{ $eq: ["$status_lower", "success"] }, "$amount", 0],
              },
            },
          },
        },
        {
          $addFields: {
            rateByCount: {
              $cond: [
                { $gt: ["$totalCount", 0] },
                { $multiply: [{ $divide: ["$successCount", "$totalCount"] }, 100] },
                0,
              ],
            },
            rateByVolume: {
              $cond: [
                { $gt: ["$totalVolume", 0] },
                { $multiply: [{ $divide: ["$successVolume", "$totalVolume"] }, 100] },
                0,
              ],
            },
          },
        },
        { $sort: { "_id.business_id": 1, "_id.acq": 1 } },
      ],
      { maxTimeMS: QUERY_TIMEOUT_MS }
    )
    .toArray();

  // Post-process: group into Cards vs APMs per business
  const businessMap = new Map<
    number,
    {
      businessId: number;
      businessName: string;
      cards: { successCount: number; totalCount: number; rateByCount: number; successVolume: number; totalVolume: number; rateByVolume: number } | null;
      apms: { acquirer: string; successCount: number; totalCount: number; rateByCount: number; successVolume: number; totalVolume: number; rateByVolume: number }[];
    }
  >();

  for (const row of rawResults) {
    const bizId = (row._id as Record<string, unknown>).business_id as number;
    const bizName =
      ((row._id as Record<string, unknown>).business_name as string) || "Unknown";
    const acq = (row._id as Record<string, unknown>).acq as string;

    if (!businessMap.has(bizId)) {
      businessMap.set(bizId, {
        businessId: bizId,
        businessName: bizName,
        cards: null,
        apms: [],
      });
    }
    const entry = businessMap.get(bizId)!;

    const bucket = {
      acquirer: acq,
      successCount: row.successCount as number,
      totalCount: row.totalCount as number,
      rateByCount: parseFloat(String(row.rateByCount)),
      successVolume: parseFloat(String(row.successVolume)),
      totalVolume: parseFloat(String(row.totalVolume)),
      rateByVolume: parseFloat(String(row.rateByVolume)),
    };

    if (CARD_ACQUIRERS.includes(acq)) {
      if (!entry.cards) {
        entry.cards = { ...bucket };
      } else {
        entry.cards.successCount += bucket.successCount;
        entry.cards.totalCount += bucket.totalCount;
        entry.cards.successVolume += bucket.successVolume;
        entry.cards.totalVolume += bucket.totalVolume;
        entry.cards.rateByCount =
          entry.cards.totalCount > 0
            ? (entry.cards.successCount / entry.cards.totalCount) * 100
            : 0;
        entry.cards.rateByVolume =
          entry.cards.totalVolume > 0
            ? (entry.cards.successVolume / entry.cards.totalVolume) * 100
            : 0;
      }
    } else {
      entry.apms.push(bucket);
    }
  }

  const results = Array.from(businessMap.values()).map((b) => ({
    ...b,
    cards: b.cards
      ? {
          ...b.cards,
          rateByCount: Math.round(b.cards.rateByCount * 10) / 10,
          rateByVolume: Math.round(b.cards.rateByVolume * 10) / 10,
          successVolume: Math.round(b.cards.successVolume * 100) / 100,
          totalVolume: Math.round(b.cards.totalVolume * 100) / 100,
        }
      : null,
    apms: b.apms.map((a) => ({
      ...a,
      rateByCount: Math.round(a.rateByCount * 10) / 10,
      rateByVolume: Math.round(a.rateByVolume * 10) / 10,
      successVolume: Math.round(a.successVolume * 100) / 100,
      totalVolume: Math.round(a.totalVolume * 100) / 100,
    })),
  }));

  return JSON.stringify({
    dateRange: {
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString(),
    },
    businesses: results,
  });
}
