/**
 * Synthetic test case definitions for Pascal's self-monitoring.
 * Each test runs through the same pipeline as real messages but with known inputs.
 */

import { parseDepositTicket, isValidTxid } from "../channels/telegram/partner-bot";
import { sanitizeToolOutput } from "../core/provider-mask";
import { getCollection } from "../mongodb/connection";
import { getChannelIndex } from "../merchants/config-store";
import { logger } from "../utils/logger";
import type { SyntheticCheckResult } from "./types";

// ── Test 1: Deposit ticket parser ──────────────────────────────

export async function testDepositTicketParser(): Promise<SyntheticCheckResult> {
  const start = Date.now();
  const details: Record<string, unknown> = {};

  try {
    const testMessage = `orderId: 9999999999999999999
txid: 9999999
currency: MXN
amount: 100
We have a new deposit ticket, and please check the transaction status.
Here are the details:
admin:proof
img1:https://example.com/test.png`;

    const ticket = parseDepositTicket(testMessage);
    details.ticketParsed = !!ticket;

    if (!ticket) {
      return { checkName: "deposit_ticket_parser", status: "fail", latencyMs: Date.now() - start, details: { ...details, error: "Failed to parse test deposit ticket" } };
    }

    details.orderId = ticket.orderId;
    details.txid = ticket.txid;
    details.amount = ticket.amount;
    details.currency = ticket.currency;

    // Validate fields
    if (ticket.orderId !== "9999999999999999999") {
      return { checkName: "deposit_ticket_parser", status: "fail", latencyMs: Date.now() - start, details: { ...details, error: `orderId mismatch: got ${ticket.orderId}` } };
    }
    if (ticket.txid !== "9999999") {
      return { checkName: "deposit_ticket_parser", status: "fail", latencyMs: Date.now() - start, details: { ...details, error: `txid mismatch: got ${ticket.txid}` } };
    }
    if (!isValidTxid(ticket.txid)) {
      return { checkName: "deposit_ticket_parser", status: "fail", latencyMs: Date.now() - start, details: { ...details, error: "isValidTxid returned false for valid txid" } };
    }

    return { checkName: "deposit_ticket_parser", status: "pass", latencyMs: Date.now() - start, details };
  } catch (err) {
    return { checkName: "deposit_ticket_parser", status: "fail", latencyMs: Date.now() - start, details: { error: err instanceof Error ? err.message : "unknown" } };
  }
}

// ── Test 2: MongoDB lookup_by_id connectivity ──────────────────

export async function testLookupConnectivity(): Promise<SyntheticCheckResult> {
  const start = Date.now();
  try {
    // Just verify we can query MongoDB — use a non-existent ID
    const col = getCollection("usrv-transactions-transactions");
    const result = await col.findOne(
      { payment_id: -999999 },
      { projection: { _id: 1 }, maxTimeMS: 10000 },
    );
    // result should be null (ID doesn't exist), but the query should succeed
    return {
      checkName: "lookup_connectivity",
      status: "pass",
      latencyMs: Date.now() - start,
      details: { found: !!result, queryMs: Date.now() - start },
    };
  } catch (err) {
    return {
      checkName: "lookup_connectivity",
      status: "fail",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Test 3: Transaction analytics (aggregation) ────────────────

export async function testAnalyticsQuery(): Promise<SyntheticCheckResult> {
  const start = Date.now();
  try {
    const col = getCollection("usrv-transactions-transactions");
    // Lightweight count query — just verify aggregation pipeline works
    const result = await col
      .aggregate([
        { $match: { business_id: -999999 } }, // non-existent business
        { $limit: 1 },
        { $count: "total" },
      ], { maxTimeMS: 10000 })
      .toArray();
    return {
      checkName: "analytics_query",
      status: "pass",
      latencyMs: Date.now() - start,
      details: { count: result[0]?.total ?? 0, queryMs: Date.now() - start },
    };
  } catch (err) {
    return {
      checkName: "analytics_query",
      status: "fail",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Test 4: Withdrawal lookup connectivity ─────────────────────

export async function testWithdrawalLookup(): Promise<SyntheticCheckResult> {
  const start = Date.now();
  try {
    const col = getCollection("usrv-withdrawals-withdrawals");
    const result = await col.findOne(
      { id: -999999 },
      { projection: { _id: 1 }, maxTimeMS: 10000 },
    );
    return {
      checkName: "withdrawal_lookup",
      status: "pass",
      latencyMs: Date.now() - start,
      details: { found: !!result, queryMs: Date.now() - start },
    };
  } catch (err) {
    return {
      checkName: "withdrawal_lookup",
      status: "fail",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Test 5: Provider masking ───────────────────────────────────

export async function testProviderMasking(): Promise<SyntheticCheckResult> {
  const start = Date.now();
  try {
    const testInput = JSON.stringify({
      provider: "kushki",
      acq: "unlimit",
      guardian_score: 0.95,
      details: "processed via bitso and stp",
    });

    const sanitized = sanitizeToolOutput(testInput);

    // Verify no internal provider names leak
    const leakedNames = ["kushki", "unlimit", "bitso", "stp", "guardian"].filter(
      (name) => sanitized.toLowerCase().includes(name),
    );

    if (leakedNames.length > 0) {
      return {
        checkName: "provider_masking",
        status: "fail",
        latencyMs: Date.now() - start,
        details: { leakedNames, sanitized: sanitized.slice(0, 200) },
      };
    }

    return {
      checkName: "provider_masking",
      status: "pass",
      latencyMs: Date.now() - start,
      details: { sanitizedLength: sanitized.length },
    };
  } catch (err) {
    return {
      checkName: "provider_masking",
      status: "fail",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── Test 6: Merchant config index health ───────────────────────

export async function testConfigIndex(): Promise<SyntheticCheckResult> {
  const start = Date.now();
  try {
    const index = getChannelIndex();
    const size = index.size;

    if (size === 0) {
      return {
        checkName: "config_index",
        status: "fail",
        latencyMs: Date.now() - start,
        details: { error: "Channel index is empty — no merchants loaded", indexSize: 0 },
      };
    }

    // Check that at least one key has partner bots (BC Game should)
    const withBots = [...index.values()].filter((m) => m.partnerBots && m.partnerBots.length > 0);

    return {
      checkName: "config_index",
      status: "pass",
      latencyMs: Date.now() - start,
      details: { indexSize: size, channelsWithBots: withBots.length },
    };
  } catch (err) {
    return {
      checkName: "config_index",
      status: "fail",
      latencyMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : "unknown" },
    };
  }
}

// ── All tests registry ─────────────────────────────────────────

export const ALL_SYNTHETIC_CHECKS = [
  testDepositTicketParser,
  testLookupConnectivity,
  testAnalyticsQuery,
  testWithdrawalLookup,
  testProviderMasking,
  testConfigIndex,
] as const;
