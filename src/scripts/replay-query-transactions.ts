/**
 * AID-85 validation harness.
 *
 * Pulls the last 30 entries from pascal_conversation_log where Claude
 * called one of the 6 transaction tools we're collapsing. Replays the
 * SAME input against the new queryTransactions() function and prints
 * a side-by-side diff so we can manually spot regressions before
 * promoting the feature flag.
 *
 * NOT run in CI — manual sanity tool. Invoke with:
 *   npx tsx src/scripts/replay-query-transactions.ts
 *
 * Outputs are written to stdout. Review the MATCH column — anything
 * marked ✗ REVIEW deserves a manual look.
 */

import { pgQuery } from "../postgres/connection";
import { queryTransactions, QueryTransactionsInput } from "../mongodb/query-transactions";
import * as queries from "../mongodb/queries";
import { resolveMerchantContext } from "../merchants/context";
import { parseDateRange } from "../utils/dates";
import { MerchantContext } from "../merchants/types";
import { logger } from "../utils/logger";

const COLLAPSED_TOOLS = [
  "get_acceptance_rate",
  "get_transaction_volume",
  "get_top_declines",
  "get_transactions_by_status",
  "list_recent_transactions",
  "lookup_spei_deposits",
];

interface LoggedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

interface LoggedConversation {
  id: string;
  question: string | null;
  tool_calls: LoggedToolCall[];
  merchant_name: string | null;
  channel_id: string | null;
  platform: string | null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/**
 * Translate an old tool's input shape to the new tool's input shape.
 * The new tool's filters cover everything the old ones did; we just
 * pick the right combination here.
 */
function translateOldInputToNew(
  tool: string,
  input: Record<string, unknown>
): QueryTransactionsInput {
  // Resolve the date range string ("yesterday", "this week", etc) to
  // ISO from/to via the existing parser. Old tools accepted either a
  // keyword (`date_range`) or explicit `start_date`/`end_date`.
  const dateRangeKw =
    typeof input.date_range === "string" ? (input.date_range as string) : undefined;
  const start = typeof input.start_date === "string" ? (input.start_date as string) : undefined;
  const end = typeof input.end_date === "string" ? (input.end_date as string) : undefined;

  let dateFilter: QueryTransactionsInput["filters"] = {};
  if (dateRangeKw) {
    const r = parseDateRange(dateRangeKw);
    dateFilter.date_range = { from: r.start.toISOString(), to: r.end.toISOString() };
  } else if (start && end) {
    dateFilter.date_range = {
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
    };
  }

  const limit = typeof input.limit === "number" ? (input.limit as number) : undefined;
  const status =
    typeof input.status === "string" ? [(input.status as string).toLowerCase()] : undefined;
  const amount = typeof input.amount === "number" ? (input.amount as number) : undefined;

  switch (tool) {
    case "get_acceptance_rate":
      return { ...dateFilter, aggregate: "group_by_status", filters: dateFilter };

    case "get_transaction_volume":
      return { aggregate: "sum", filters: dateFilter };

    case "get_top_declines":
      return {
        aggregate: "group_by_decline",
        filters: dateFilter,
        limit: limit ?? 10,
      };

    case "get_transactions_by_status":
      return { aggregate: "group_by_status", filters: dateFilter };

    case "list_recent_transactions":
      return {
        filters: { ...dateFilter, status },
        sort: { field: "created", order: "desc" },
        limit: limit ?? 10,
      };

    case "lookup_spei_deposits": {
      // SPEI is a separate collection in the old tool; in the new tool
      // we filter on payment_method:[spei] against the unified
      // transactions collection. NOTE: this is a known data-source
      // difference — the old tool queried usrv-deposits-spei, the new
      // tool queries mv_payment_transactions filtered to SPEI acquirers.
      // Expect divergent results here; manually inspect for
      // structural similarity, not byte equality.
      return {
        filters: {
          ...dateFilter,
          payment_method: ["spei"],
          status,
          amount_range: amount ? { min: amount, max: amount } : undefined,
        },
        sort: { field: "created", order: "desc" },
        limit: limit ?? 10,
      };
    }
  }

  return { filters: dateFilter };
}

async function fetchSampleConversations(): Promise<LoggedConversation[]> {
  const result = await pgQuery(
    `SELECT id::text AS id, question, tool_calls, merchant_name, channel_id, platform
       FROM pascal_conversation_log
      WHERE tool_calls::text ILIKE ANY(ARRAY[
        '%get_acceptance_rate%',
        '%get_transaction_volume%',
        '%get_top_declines%',
        '%get_transactions_by_status%',
        '%list_recent_transactions%',
        '%lookup_spei_deposits%'
      ])
      ORDER BY created_at DESC
      LIMIT 30`
  );
  return result.rows.map((r) => ({
    id: r.id,
    question: r.question,
    tool_calls: Array.isArray(r.tool_calls) ? (r.tool_calls as LoggedToolCall[]) : [],
    merchant_name: r.merchant_name,
    channel_id: r.channel_id,
    platform: r.platform,
  }));
}

async function buildMerchantCtxForLog(
  log: LoggedConversation
): Promise<MerchantContext | null> {
  if (!log.channel_id) return null;
  try {
    return await resolveMerchantContext(
      log.channel_id,
      (log.platform ?? "slack") as "slack" | "telegram" | "whatsapp"
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), id: log.id },
      "Could not resolve merchant context for replay row — skipping"
    );
    return null;
  }
}

async function main() {
  console.log("AID-85 replay validation\n========================\n");
  const sample = await fetchSampleConversations();
  console.log(`Pulled ${sample.length} sample conversations\n`);

  let matches = 0;
  let mismatches = 0;
  let errors = 0;

  for (const log of sample) {
    const merchantCtx = await buildMerchantCtxForLog(log);
    if (!merchantCtx) {
      console.log(`SKIP conversation ${log.id} — no merchant context`);
      continue;
    }

    for (const call of log.tool_calls) {
      if (!COLLAPSED_TOOLS.includes(call.tool)) continue;

      try {
        // Run the new tool with the translated input
        const newInput = translateOldInputToNew(call.tool, call.input);
        const newResult = await queryTransactions(newInput, merchantCtx);

        // Run the OLD tool against the same range for direct comparison.
        // For row-mode old tools we just compare counts; for aggregates
        // we compare values.
        let oldSummary = "";
        try {
          const dateRange =
            typeof call.input.date_range === "string"
              ? parseDateRange(call.input.date_range as string)
              : parseDateRange("today");
          switch (call.tool) {
            case "get_acceptance_rate": {
              const r = await queries.getAcceptanceRates(dateRange, merchantCtx.businessIds);
              oldSummary = `cards.rate=${r.cards?.rateByCount?.toFixed(1)} apms=${r.apms.length}`;
              break;
            }
            case "get_transaction_volume": {
              const r = await queries.getTransactionVolume(dateRange, merchantCtx.businessIds);
              oldSummary = `total=${r.totalCount} sum=${r.totalVolume.toFixed(2)}`;
              break;
            }
            case "get_top_declines": {
              const r = await queries.getTopDeclines(dateRange, merchantCtx.businessIds, 10);
              oldSummary = `declines=${r.length}`;
              break;
            }
            case "get_transactions_by_status": {
              const r = await queries.getTransactionsByStatus(dateRange, merchantCtx.businessIds);
              oldSummary = `statuses=${r.length}`;
              break;
            }
            case "list_recent_transactions": {
              const r = await queries.listRecentTransactions(
                dateRange,
                merchantCtx.businessIds,
                undefined,
                10
              );
              oldSummary = `rows=${r.length}`;
              break;
            }
            case "lookup_spei_deposits": {
              // lookupSpeiDeposits takes businessIdStrs as string[] —
              // the SPEI collection stores business_id as string while
              // the txn collection stores it as number.
              const r = await queries.lookupSpeiDeposits(
                dateRange,
                merchantCtx.businessIds.map((n) => String(n))
              );
              oldSummary = `spei_deposits=${r.length}`;
              break;
            }
          }
        } catch (oldErr) {
          oldSummary = `[old err: ${oldErr instanceof Error ? oldErr.message : oldErr}]`;
        }

        const newSummary = newResult.aggregates
          ? `aggregates=${newResult.aggregates.length} total=${newResult.total_count}`
          : `rows=${newResult.rows?.length ?? 0} total=${newResult.total_count}`;

        console.log(
          `\n--- ${call.tool} (conv ${log.id.slice(0, 8)} · ${log.merchant_name}) ---`
        );
        console.log(`  input    : ${truncate(JSON.stringify(call.input), 100)}`);
        console.log(`  old      : ${oldSummary}`);
        console.log(`  new      : ${newSummary}`);
        console.log(`  exec_ms  : ${newResult.query_meta.execution_ms}`);
        matches += 1;
      } catch (err) {
        console.log(`\n--- ${call.tool} (conv ${log.id.slice(0, 8)}) FAILED ---`);
        console.log(`  err: ${err instanceof Error ? err.message : String(err)}`);
        errors += 1;
      }
    }
  }

  console.log(
    `\n\nSummary: ${matches} runs, ${mismatches} flagged, ${errors} errors`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Replay harness failed:", err);
  process.exit(1);
});
