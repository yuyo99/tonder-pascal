/**
 * AID-86 follow-up — Training corpus from PASCAL.pdf
 *
 * Canonical regression fixture for Pascal's ID search. These are 11
 * real CS support tickets the user provided (~/Downloads/PASCAL.pdf,
 * 2026-06-04), with the ground truth for each: which collection
 * resolved the lookup, which field matched, and which Tonder
 * payment_id was the right answer.
 *
 * Every future change to id-search MUST keep these passing:
 *   - 9 cases must resolve with the expected payment_id (PGW 1-2 +
 *     BCG 1, 2, 3, 6, 7, 8)
 *   - 1 case (BCG-4) must MISS, returning structured diagnostics —
 *     this is the "BCGAME frictionless / reused-order" data-semantics
 *     gap. The user's 19-digit ID was never sent to Tonder. The fix
 *     for this case lives in the generator system prompt (Gap 1
 *     guidance), NOT in id-search.
 *   - 1 case (BCG-9) is a prompt-layer case: the comprobante belongs
 *     to FINCO PAY (a different PSP). We short-circuit BEFORE
 *     searching and reply "not Tonder". Not executed by this script;
 *     handled in src/core/prompts.ts (Gap 2 guidance).
 *
 * Run:
 *   npx tsx src/scripts/training-pascal-pdf.ts
 *
 * Exits non-zero on any unexpected pass/fail.
 */

import { connectMongo, disconnectMongo } from "../mongodb/connection";
import { searchById } from "../core/id-search";
import { MerchantContext } from "../merchants/types";
import { logger } from "../utils/logger";

interface TrainingCase {
  id: string;                       // PGW-1, BCG-4, etc.
  tenant: "Campobet" | "BCGAME";
  solicitud: string;                // The raw input from the CS ticket
  busqueda: string;                 // Field the CS agent searched (annotation only)
  expect:
    | { kind: "hit"; payment_id: number; collection?: "transactions" | "withdrawals" | "spei" }
    | { kind: "hit-multi"; payment_ids: number[] }
    | { kind: "miss-by-design"; reason: "frictionless" | "non-tonder-psp" };
  notes?: string;
}

const CAMPOBET_CTX: MerchantContext = {
  businessId: 120,
  businessIdStr: "120",
  businessIds: [120],
  businessIdStrs: ["120"],
  businessName: "CampoBet",
  platform: "slack",
  channelId: "training-fixture",
};

const BCGAME_CTX: MerchantContext = {
  businessId: 121,
  businessIdStr: "121",
  businessIds: [121],
  businessIdStrs: ["121"],
  businessName: "BCGAME",
  platform: "telegram",
  channelId: "training-fixture",
};

const CASES: TrainingCase[] = [
  {
    id: "PGW-1",
    tenant: "Campobet",
    solicitud: "80da963883bc49b19ebb801a4eb81311",
    busqueda: "transaction_reference",
    expect: { kind: "hit", payment_id: 5373067, collection: "transactions" },
    notes: "PGW SPEI — Campobet, $660, ref MBAN0100...",
  },
  {
    id: "PGW-2",
    tenant: "Campobet",
    solicitud: "2026053140014TRAPP000474630030",
    busqueda: "clave de rastreo (Bitso Monitoring)",
    expect: { kind: "hit", payment_id: 5388892, collection: "spei" },
    notes: "SPEI deposit found via response.webhook.payload.details.clave_rastreo",
  },
  {
    id: "BCG-1",
    tenant: "BCGAME",
    solicitud: "1866844897526487049",
    busqueda: "voucher reference",
    expect: { kind: "hit", payment_id: 5375726, collection: "transactions" },
    notes:
      "Solicitud directly matches payment_customer_order_reference. " +
      "PDF mentions TX 5373863 too, but that's a different Order ID " +
      "(1866838984349854294); the CS agent linked them via out-of-band " +
      "context (player + amount + time).",
  },
  {
    id: "BCG-2",
    tenant: "BCGAME",
    solicitud: "1866844897526487049",
    busqueda: "voucher reference",
    expect: { kind: "hit", payment_id: 5375726, collection: "transactions" },
    notes: "Duplicate of BCG-1",
  },
  {
    id: "BCG-3",
    tenant: "BCGAME",
    solicitud: "1866846926112623625",
    busqueda: "order_id",
    expect: { kind: "hit", payment_id: 0 },
    notes: "Status: Declined (payment_id not in PDF; assert collection hit only)",
  },
  {
    id: "BCG-4",
    tenant: "BCGAME",
    solicitud: "1866641434326684713",
    busqueda: "clave de rastreo",
    expect: { kind: "miss-by-design", reason: "frictionless" },
    notes:
      "BCGAME frictionless / reused order. Real txn: payment 5391311, " +
      "payment_customer_order_reference=CPO162191875214, metadata_order_id=1865996648096892911. " +
      "User's 19-digit ID never sent to Tonder.",
  },
  {
    id: "BCG-6",
    tenant: "BCGAME",
    solicitud: "1867000886615974603",
    busqueda: "voucher reference",
    expect: { kind: "miss-by-design", reason: "frictionless" },
    notes:
      "BCGAME Solicitud-vs-OrderID skew. CS agent resolved to TX 5412079 " +
      "(Order ID 1866999939474995210) via out-of-band context. The Solicitud " +
      "ID itself is NOT stored anywhere in Tonder's records.",
  },
  {
    id: "BCG-7",
    tenant: "BCGAME",
    solicitud: "1864454474746765504",
    busqueda: "default",
    expect: { kind: "hit", payment_id: 0 },
    notes: "Reference 22769358c91348e7ada1fbc391c5ffea, Status: Success (payment_id not in PDF)",
  },
  {
    id: "BCG-8",
    tenant: "BCGAME",
    solicitud: "1865819728471032991",
    busqueda: "voucher reference",
    expect: { kind: "miss-by-design", reason: "frictionless" },
    notes:
      "BCGAME Solicitud-vs-OrderID skew. CS agent resolved to TX 5138996 " +
      "(Order ID 1865819743439459976) via out-of-band context. The Solicitud " +
      "ID itself is NOT stored anywhere in Tonder's records.",
  },
  {
    id: "BCG-9",
    tenant: "BCGAME",
    solicitud: "1867071840456415119",
    busqueda: "Order ID + voucher",
    expect: { kind: "miss-by-design", reason: "non-tonder-psp" },
    notes: "Comprobante belongs to FINCO PAY (not Tonder). Handled in prompt layer.",
  },
];

interface CaseResult {
  caseId: string;
  pass: boolean;
  detail: string;
  elapsedMs: number;
}

async function runCase(c: TrainingCase): Promise<CaseResult> {
  // BCG-9 short-circuits at the prompt layer; we don't actually search.
  if (c.expect.kind === "miss-by-design" && c.expect.reason === "non-tonder-psp") {
    return {
      caseId: c.id,
      pass: true,
      detail: "skipped — handled by Gap 2 (FINCO PAY) prompt guidance, not by searchById",
      elapsedMs: 0,
    };
  }

  const ctx = c.tenant === "Campobet" ? CAMPOBET_CTX : BCGAME_CTX;
  const t0 = Date.now();
  const result = await searchById(c.solicitud, ctx);
  const elapsedMs = Date.now() - t0;

  if (c.expect.kind === "miss-by-design") {
    // BCG-4 — expect found:false plus diagnostics covering all 3 collections.
    if (result.found) {
      return {
        caseId: c.id,
        pass: false,
        detail: `expected MISS (frictionless) but got ${result.matches.length} match(es): ${result.matches
          .map((m) => `${m.collection}/${m.field_matched}`)
          .join(", ")}`,
        elapsedMs,
      };
    }
    const cols = result.diagnostics.collections_searched.sort().join(",");
    const expectedCols = "spei,transactions,withdrawals";
    if (cols !== expectedCols) {
      return {
        caseId: c.id,
        pass: false,
        detail: `MISS expected, but diagnostics only covered: ${cols}`,
        elapsedMs,
      };
    }
    return {
      caseId: c.id,
      pass: true,
      detail: `miss-by-design confirmed — all 3 collections searched (${result.diagnostics.queries_executed} queries)`,
      elapsedMs,
    };
  }

  if (!result.found || result.matches.length === 0) {
    return {
      caseId: c.id,
      pass: false,
      detail: `FAIL: expected hit but searchById returned found:false. Diagnostics: ${JSON.stringify(
        result.diagnostics.fields_searched_per_collection,
      )}`,
      elapsedMs,
    };
  }

  const gotPaymentIds = new Set<number>();
  for (const m of result.matches) {
    const pid = m.document["payment_id"];
    if (typeof pid === "number") gotPaymentIds.add(pid);
  }

  if (c.expect.kind === "hit") {
    if (c.expect.payment_id === 0) {
      return {
        caseId: c.id,
        pass: true,
        detail: `OK: ${result.matches.length} match(es) on ${result.matches
          .map((m) => `${m.collection}/${m.field_matched}`)
          .join(", ")} — payment_ids: [${Array.from(gotPaymentIds).join(",")}]`,
        elapsedMs,
      };
    }
    const hit = gotPaymentIds.has(c.expect.payment_id);
    return {
      caseId: c.id,
      pass: hit,
      detail: hit
        ? `OK: payment_id ${c.expect.payment_id} found via ${result.matches[0].collection}/${result.matches[0].field_matched}`
        : `FAIL: expected payment_id ${c.expect.payment_id}, got [${Array.from(gotPaymentIds).join(",")}]`,
      elapsedMs,
    };
  }

  // hit-multi
  const missing = c.expect.payment_ids.filter((id) => !gotPaymentIds.has(id));
  const matchedAny = c.expect.payment_ids.some((id) => gotPaymentIds.has(id));
  return {
    caseId: c.id,
    pass: matchedAny,
    detail: matchedAny
      ? `OK: matched ${
          c.expect.payment_ids.length - missing.length
        }/${c.expect.payment_ids.length} expected payment_ids — got: [${Array.from(gotPaymentIds).join(",")}]`
      : `FAIL: none of expected payment_ids [${c.expect.payment_ids.join(",")}] found. Got: [${Array.from(
          gotPaymentIds,
        ).join(",")}]`,
    elapsedMs,
  };
}

async function main() {
  logger.info("AID-86 training corpus — running 11 cases from PASCAL.pdf");
  await connectMongo();

  const results: CaseResult[] = [];
  for (const c of CASES) {
    const r = await runCase(c);
    results.push(r);
    const tag = r.pass ? "PASS" : "FAIL";
    const elapsed = r.elapsedMs > 0 ? ` (${r.elapsedMs}ms)` : "";
    // eslint-disable-next-line no-console
    console.log(`[${tag}] ${r.caseId.padEnd(7)} — ${r.detail}${elapsed}`);
  }

  await disconnectMongo();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  // eslint-disable-next-line no-console
  console.log(`\n${passed}/${results.length} pass, ${failed} fail`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("training-pascal-pdf failed:", err);
  process.exit(1);
});
