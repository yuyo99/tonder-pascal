import * as Sentry from "@sentry/node";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { buildSystemPrompt, buildAmbientSupplement, buildPeopleContext } from "./prompts";
import { getTeamDirectory } from "./tonder-team";
import { toolDefinitions, executeTool, consumePendingAttachments } from "./tools";
import { sanitizeToolOutput, auditResponse } from "./provider-mask";
import { resolveMerchantContext } from "../merchants/context";
import { getChannelIndex } from "../merchants/config-store";
import { IncomingMessage } from "../channels/types";
import { MerchantContext } from "../merchants/types";
import { trackInteraction } from "../scheduler/daily-report";
import { findRelevantKnowledge, KnowledgeEntry } from "../knowledge/loader";
import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";
import { evaluateAndRecord } from "../monitoring/self-qa";
import { loadActiveRules, shouldRespond, logRuleApplication } from "./rules";
import { refineQuery, bareIdShortCircuit } from "./refine";
import { validateResponse, safeFallbackResponse, type Violation } from "./validate";
import { loadActiveProcedures, matchProcedure, renderProcedureSection, logProcedureDispatch } from "./procedures";
import { loadMerchantProfile } from "./merchant-profile";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 120_000 });
const MAX_TOOL_ROUNDS = 10;
const HANDLER_TIMEOUT_MS = 300_000; // 5 min max — bulk queries (54 IDs) need time

/**
 * AID-84: wall-clock budget for the tool loop. Tighter than the
 * 5-minute HANDLER_TIMEOUT_MS so a runaway loop can't dominate Slack
 * UX. With the channel adapters' progress-edit pattern (👀 reaction +
 * 15s / 45s / 90s edits) this gives the user clear progressive signal
 * and a clean "I'll follow up" outcome at the wall.
 *
 * Per the AID-84 spec, even a healthy compound query rarely needs
 * more than ~90s; 120s is a tight envelope with 30s of headroom.
 */
const DEFAULT_TOOL_LOOP_BUDGET_MS = 120_000;

interface ToolLoopResult {
  answer: string;
  toolCalls: { tool: string; input: Record<string, unknown> }[];
  /** Sanitized tool outputs in call order — used by Phase 5 validation (AID-81). */
  toolOutputs: string[];
  rounds: number;
  attachments?: { buffer: Buffer; filename: string }[];
  /** AID-84: true if the loop returned early because budgetMs elapsed. */
  budgetExhausted?: boolean;
}

/**
 * Handle an incoming message from any channel.
 * Returns the response text and optional file attachments.
 */
export async function handleIncomingMessage(msg: IncomingMessage): Promise<import("../channels/types").MessageResponse> {
  const startTime = Date.now();

  // Step 1: Resolve merchant context
  const merchantCtx = await resolveMerchantContext(msg.channelId, msg.platform);
  if (!merchantCtx) {
    const index = getChannelIndex();
    const knownKeys = Array.from(index.keys()).slice(0, 30);
    logger.warn(
      { channelId: msg.channelId, platform: msg.platform, indexSize: index.size, knownKeys },
      "Message from unmapped channel"
    );
    return { text: `⚠️ Channel not configured. Debug: looking for key "${msg.platform}:${msg.channelId}" in ${index.size} entries: ${knownKeys.join(", ")}` };
  }

  logger.info(
    { merchant: merchantCtx.businessName, platform: msg.platform, user: msg.userName },
    "Processing merchant question"
  );

  // ── Phase 0 — Gate (Pascal Model 2 / AID-82) + Profile (AID-73) ───────
  // Load active rules + merchant profile in parallel — both feed the system
  // prompt at Phase 4. Both fail open: rules → empty array, profile → null.
  const [activeRules, merchantProfile] = await Promise.all([
    loadActiveRules({
      businessId: merchantCtx.businessId ?? undefined,
      channelId: msg.channelId,
      botId: msg.botId,
    }),
    merchantCtx.businessId ? loadMerchantProfile(merchantCtx.businessId) : Promise.resolve(null),
  ]);

  const gate = await shouldRespond(
    {
      businessId: merchantCtx.businessId ?? undefined,
      channelId: msg.channelId,
      botId: msg.botId,
    },
    {
      text: msg.text,
      mentions: msg.mentions,
      isReplyToPascal: msg.isReplyToPascal,
    },
    activeRules,
  );

  if (!gate.allow) {
    if (gate.blockedByRuleId) {
      // Synthetic conversation id — blocked messages never get a full
      // conversation_log row, but we still record the gate application.
      const syntheticConvId = `gate:${msg.platform}:${msg.channelId}:${Date.now()}`;
      logRuleApplication(gate.blockedByRuleId, syntheticConvId, "gate", "blocked");
    }
    logger.info(
      {
        channelId: msg.channelId,
        merchant: merchantCtx.businessName,
        ruleId: gate.blockedByRuleId,
        reason: gate.reason,
      },
      "Phase 0 gate: pipeline short-circuited"
    );
    return { text: "" }; // adapters skip sending when text is empty
  }

  // ── Phase 1 — Refine query (Pascal Model 2 / AID-77) ──────────────────
  // Haiku preprocessor: classifies intent, expands shorthand, extracts IDs.
  // Failure mode is passthrough (use original text). Two downstream uses:
  //   1. canonical_query feeds knowledge retrieval (better recall on shorthand)
  //   2. bare_id intent + single ID → short-circuit to direct lookup, no Sonnet
  const refined = await refineQuery(msg.text);
  logger.info(
    {
      intent: refined.intent,
      ids: refined.ids,
      confidence: refined.confidence,
      passthrough: refined.passthrough,
      profileLoaded: !!merchantProfile,
      merchant: merchantCtx.businessName,
    },
    "Phase 1: query refined",
  );

  // Bare-ID short-circuit — skip the multi-round Sonnet tool loop entirely.
  // Calls lookup_by_id directly, formats the result through one Haiku pass,
  // returns. ~10x faster + cheaper than the full pipeline for partner-bot-
  // style deposit-ticket queries.
  const shortCircuitId = bareIdShortCircuit(refined);
  if (shortCircuitId) {
    const shortCircuitResult = await tryBareIdShortCircuit(
      shortCircuitId,
      merchantCtx,
      msg,
      startTime,
    );
    if (shortCircuitResult) return shortCircuitResult;
    // Falls through to the normal pipeline on any failure (lookup error,
    // formatting error, empty results — Sonnet will handle it instead).
  }

  // ── Phase 4a — Procedure dispatch (Pascal Model 2 / AID-79) ──────────
  // Look for a matching playbook to inject into the system prompt. At most
  // one procedure fires per message — most-specific scope wins.
  const procedures = await loadActiveProcedures({
    businessId: merchantCtx.businessId ?? undefined,
    channelId: msg.channelId,
  });
  const matchedProcedure = matchProcedure(
    procedures,
    refined.passthrough ? undefined : refined.intent,
    refined.canonical_query || msg.text,
  );
  if (matchedProcedure) {
    logger.info(
      {
        procedure: matchedProcedure.name,
        procedureId: matchedProcedure.id,
        intent: refined.intent,
        merchant: merchantCtx.businessName,
      },
      "Phase 4a: procedure dispatched",
    );
    logProcedureDispatch(matchedProcedure.id);
  }

  // Step 2: Build merchant-specific system prompt (profile + rules + procedure)
  let systemPrompt = buildSystemPrompt(merchantCtx, activeRules, merchantProfile);
  if (matchedProcedure) {
    systemPrompt += renderProcedureSection(matchedProcedure);
  }

  // Step 2b: Inject relevant knowledge into system prompt (semantic search + keyword fallback).
  // Uses the refined canonical_query when available — shorthand expansion gives
  // semantic search a much cleaner target.
  const knowledgeQuery = refined.passthrough ? msg.text : refined.canonical_query;
  const knowledgeMatches = await findRelevantKnowledge(knowledgeQuery, merchantCtx.businessId || undefined);
  if (knowledgeMatches.length > 0) {
    const knowledgeSection = knowledgeMatches
      .map((k) => {
        let entry = `### ${k.title}\n${k.content}`;
        if (k.action) entry += `\n**Recommended action:** ${k.action}`;
        return entry;
      })
      .join("\n\n");
    systemPrompt += `\n\n## Relevant Knowledge\nUse the following knowledge to help answer the merchant's question:\n\n${knowledgeSection}`;
    logger.info(
      { count: knowledgeMatches.length, titles: knowledgeMatches.map((k) => k.title), merchant: merchantCtx.businessName },
      "Knowledge injected into prompt"
    );
  }

  // Step 2c: Inject people/team context
  try {
    const teamDirectory = await getTeamDirectory();
    if (teamDirectory.length > 0) {
      systemPrompt += buildPeopleContext(teamDirectory);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load team directory for prompt — non-fatal");
  }

  // Step 2d: Inject ambient mode supplement if applicable
  if (msg.ambient) {
    systemPrompt += buildAmbientSupplement(msg.threadContext ?? []);
  }

  // Step 2e: Load conversation history for multi-turn context
  // BC Game: stateless lookups — no history loading to prevent hallucinated answers
  // mixing with fresh tool data. Each query is an independent transaction lookup.
  const STATELESS_CHAT_IDS = ["-1002589749469", "-1003575792934"];
  const skipHistory = STATELESS_CHAT_IDS.includes(msg.channelId);
  const history = skipHistory
    ? []
    : await loadConversationHistory(msg.channelId, msg.platform, 5);
  if (history.length > 0) {
    systemPrompt += `\n\n## Conversation History\nYou have access to recent messages in this channel. Use them for context (pronouns like "it", "that transaction", "yesterday's issue" refer to prior messages). Don't repeat information already given unless asked.\n\n**CRITICAL:** Historical answers may be OUTDATED. When current tool results differ from history, ALWAYS use current tool results. Transaction data (order_id, payment_id, amount, status, date) must come EXCLUSIVELY from the most recent tool call — never from memory of prior turns.`;
    logger.info(
      { turns: history.length / 2, merchant: merchantCtx.businessName },
      "Conversation history loaded"
    );
  } else if (skipHistory) {
    logger.info(
      { chatId: msg.channelId, merchant: merchantCtx.businessName },
      "Stateless channel — history skipped"
    );
  }

  // Step 3: Run Claude tool-use loop
  let result: ToolLoopResult;
  let error: string | undefined;

  try {
    result = await Promise.race([
      runToolLoop(msg.text, systemPrompt, merchantCtx, history),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Handler timeout: response took too long")), HANDLER_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    Sentry.captureException(err, { tags: { merchant: merchantCtx.businessName, platform: msg.platform } });
    const errMsg = err instanceof Error ? err.message : String(err);
    const errType = err instanceof Error ? err.constructor.name : typeof err;
    logger.error({ err, errType, errMsg, merchant: merchantCtx.businessName }, "Orchestrator error");
    storeErrorFromCatch("orchestrator", err, { merchant: merchantCtx.businessName, platform: msg.platform, channel: msg.channelId, user: msg.userName });

    let answer: string;
    if (errMsg.includes("Handler timeout")) {
      answer = "This query is taking longer than expected — for large lookups this may take a few minutes. Please try again and I'll do my best.";
    } else if (errMsg.includes("authentication") || errMsg.includes("api_key") || errMsg.includes("401")) {
      answer = "I'm experiencing an authentication issue. Please contact Tonder support.";
    } else if (errMsg.includes("rate_limit") || errMsg.includes("429")) {
      answer = "I'm receiving too many requests right now. Please try again in a moment.";
    } else if (errMsg.includes("MongoDB") || errMsg.includes("not connected")) {
      answer = "I'm having trouble accessing the database. Please try again in a moment.";
    } else if (errMsg.includes("model") || errMsg.includes("not_found")) {
      answer = "I'm experiencing a configuration issue. Please contact Tonder support.";
    } else {
      answer = `I'm sorry, I encountered an error processing your request. (${errType}: ${errMsg.slice(0, 100)}). Please try again or contact Tonder support.`;
    }

    error = `${errType}: ${errMsg.slice(0, 500)}`;
    result = { answer, toolCalls: [], toolOutputs: [], rounds: 0 };
  }

  // Step 4: Final audit — catch any leaked provider names
  const leaked = auditResponse(result.answer);
  if (leaked.length > 0) {
    logger.warn(
      { leaked, merchant: merchantCtx.businessName },
      "Provider names leaked in response — sanitizing"
    );
    result.answer = sanitizeToolOutput(result.answer);
  }

  // ── Phase 5 — Pre-send validation (Pascal Model 2 / AID-81) ──────────
  // Three checks against the draft: scope leaks, fabricated numbers,
  // hard-rule output constraints. Never blocks message delivery on its own
  // errors — only on a confirmed critical violation.
  let validationViolations: Violation[] = [];
  if (result.answer && !error) {
    try {
      const validation = await validateResponse({
        draft: result.answer,
        toolOutputs: result.toolOutputs,
        originalMessage: msg.text,
        businessIds: merchantCtx.businessIds ?? [],
        activeRules,
      });
      validationViolations = validation.violations;

      if (validation.violations.length > 0) {
        logger.warn(
          {
            merchant: merchantCtx.businessName,
            violations: validation.violations.map((v) => ({
              type: v.type,
              severity: v.severity,
              details: v.details,
            })),
          },
          "Phase 5 validation: violations detected",
        );
      }

      if (validation.blocked) {
        const fallback = safeFallbackResponse(validation.violations);
        logger.warn(
          {
            merchant: merchantCtx.businessName,
            blockedDraft: result.answer.slice(0, 200),
            violations: validation.violations,
          },
          "Phase 5 validation: BLOCKED — replacing draft with safe fallback",
        );
        result.answer = fallback;
      }
    } catch (err) {
      // Validator failures never block the merchant from getting an answer.
      logger.warn({ err }, "validateResponse threw — passing draft through");
    }
  }

  // Step 5: Track interaction for daily report (in-memory)
  trackInteraction({
    merchantName: merchantCtx.businessName,
    question: msg.text,
    answered: !error,
    timestamp: new Date(),
    ambient: msg.ambient,
  });

  // Step 6: Update knowledge hit counts (fire-and-forget)
  if (knowledgeMatches.length > 0) {
    const ids = knowledgeMatches.map((k) => k.id);
    pgQuery(
      `UPDATE pascal_knowledge_base SET hit_count = hit_count + 1 WHERE id = ANY($1::uuid[])`,
      [ids]
    ).catch((err) => {
      logger.warn({ err }, "Failed to update knowledge hit counts — non-fatal");
    });
  }

  // Step 7: Persist conversation to Postgres (fire-and-forget)
  // Consume any file attachments generated by tools (e.g. PDF receipts)
  logger.info({ toolsCalled: result.toolCalls.map(t => t.tool), hasReceiptTool: result.toolCalls.some(t => t.tool === "generate_refund_receipt") }, "About to consume pending attachments");
  const attachments = consumePendingAttachments();

  const latencyMs = Date.now() - startTime;
  const conversationId = await logConversation(merchantCtx, msg, result, latencyMs, error, knowledgeMatches);

  logger.info(
    { hasAttachments: attachments.length > 0, attachmentCount: attachments.length, filenames: attachments.map(a => a.filename), bufferSizes: attachments.map(a => a.buffer?.length ?? 0) },
    "Orchestrator returning response"
  );

  // Self-QA: evaluate and record (fire-and-forget). Validation failures are
  // appended to failureReason so /monitoring → self-QA surfaces them.
  const validationReason = validationViolations.length > 0
    ? `validation:${validationViolations.map((v) => `${v.severity}:${v.type}`).join(",")}`
    : null;
  const combinedFailure = [error ? String(error) : null, validationReason]
    .filter(Boolean)
    .join(" | ") || null;

  evaluateAndRecord({
    platform: msg.platform,
    channelId: msg.channelId,
    merchantName: merchantCtx?.businessName ?? null,
    businessId: merchantCtx ? String(merchantCtx.businessId) : null,
    messageType: msg.ambient ? "ambient" : "mention",
    latencyMs,
    responded: !!result.answer,
    fallbackUsed: !!error || validationViolations.some((v) => v.severity === "critical"),
    failureReason: combinedFailure,
    rawInput: msg.text?.slice(0, 2000) ?? "",
    toolsCalled: result.toolCalls.map((t) => t.tool),
    rounds: result.rounds,
    conversationId: conversationId ?? undefined,
  }).catch((err) => logger.warn({ err }, "Self-QA fire-and-forget failed"));

  return {
    text: result.answer,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

// ── Bare-ID short-circuit (Pascal Model 2 / AID-77) ──────────────────────
//
// Called when refineQuery classified the message as a bare-ID lookup with
// high confidence. Bypasses the multi-round Sonnet tool loop:
//   1. Run lookup_by_id directly via executeTool
//   2. Format the JSON result through a single Haiku call
//   3. Return that as the response
//
// Returns null on any failure — the orchestrator then falls through to the
// normal Sonnet path, so the short-circuit is purely a fast path, never a
// regression risk.

async function tryBareIdShortCircuit(
  id: string,
  merchantCtx: MerchantContext,
  msg: IncomingMessage,
  startTime: number,
): Promise<import("../channels/types").MessageResponse | null> {
  try {
    const lookupJson = await executeTool("lookup_by_id", { id }, merchantCtx);

    // executeTool's contract is "return a JSON string". Parse + check that
    // we got at least one result; empty → fall through to Sonnet, which can
    // explain the miss conversationally.
    let parsed: unknown;
    try {
      parsed = JSON.parse(lookupJson);
    } catch {
      return null;
    }
    const results = (parsed as { results?: unknown[] }).results ?? [];
    if (!Array.isArray(results) || results.length === 0) return null;

    // Format the lookup JSON into a merchant-facing reply via one Haiku call.
    const formatted = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `You are Pascal, ${merchantCtx.businessName}'s payment-data assistant. You will be given a JSON result from a transaction lookup. Format it into a short, clear response in the merchant's language (default Spanish). Show: status, payment_id (if any), order_id, amount + currency, payment method, created date. Mask internal acquirer names per the standard rules (kushki → Cards, bitso → SPEI, oxxopay → Oxxopay, etc.). NEVER invent fields not in the JSON. If multiple results exist, list each briefly.`,
      messages: [
        {
          role: "user",
          content: `Original question: "${msg.text.trim()}"\n\nLookup result JSON:\n${lookupJson}`,
        },
      ],
    });

    const answer = formatted.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!answer) return null;

    const latencyMs = Date.now() - startTime;
    logger.info(
      { id, merchant: merchantCtx.businessName, latencyMs },
      "Bare-ID short-circuit: success",
    );

    // Log to pascal_conversation_log so the conversation is still tracked.
    // The tool input carries `fast_path: true` so analytics can distinguish
    // short-circuit lookups from full Sonnet tool loops downstream.
    const conversationId = await logConversation(
      merchantCtx,
      msg,
      {
        answer,
        toolCalls: [{ tool: "lookup_by_id", input: { id, fast_path: true } }],
        toolOutputs: [lookupJson],
        rounds: 0,
      },
      latencyMs,
      undefined,
      [],
    );
    // Fire-and-forget self-QA for the fast path too (same shape as the
    // full-pipeline call above — fields aligned with monitoring/self-qa.ts).
    evaluateAndRecord({
      platform: msg.platform,
      channelId: msg.channelId,
      merchantName: merchantCtx.businessName,
      businessId: String(merchantCtx.businessId),
      messageType: "deposit_ticket",
      latencyMs,
      responded: true,
      fallbackUsed: false,
      failureReason: null,
      rawInput: msg.text?.slice(0, 2000) ?? "",
      toolsCalled: ["lookup_by_id"],
      rounds: 0,
      conversationId: conversationId ?? undefined,
    }).catch((err) => logger.warn({ err }, "Self-QA fire-and-forget failed (fast path)"));

    return { text: answer };
  } catch (err) {
    logger.warn({ err, id }, "Bare-ID short-circuit: failed, falling through to Sonnet");
    return null;
  }
}

// ── Conversation logging (fire-and-forget) ──

async function logConversation(
  ctx: MerchantContext,
  msg: IncomingMessage,
  result: ToolLoopResult,
  latencyMs: number,
  error?: string,
  knowledgeMatches: KnowledgeEntry[] = []
): Promise<string | null> {
  const knowledgeUsed = knowledgeMatches.map((k) => ({
    id: k.id,
    title: k.title,
    category: k.category,
  }));

  try {
    const res = await pgQuery(
      `INSERT INTO pascal_conversation_log
        (merchant_id, merchant_name, platform, channel_id, user_name, question, answer, tool_calls, rounds, latency_ms, error, knowledge_used)
       VALUES (
         (SELECT id FROM pascal_merchant_channels WHERE platform = $1 AND channel_id = $2 LIMIT 1),
         $3, $1, $2, $4, $5, $6, $7, $8, $9, $10, $11
       )
       RETURNING id`,
      [
        ctx.platform,
        ctx.channelId,
        ctx.businessName,
        msg.userName || null,
        msg.text,
        result.answer,
        JSON.stringify(result.toolCalls),
        result.rounds,
        latencyMs,
        error || null,
        JSON.stringify(knowledgeUsed),
      ]
    );
    return res.rows[0]?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "Failed to log conversation — non-fatal");
    return null;
  }
}

// ── Retry wrapper for transient Claude API errors ──

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("rate_limit") || msg.includes("429") || msg.includes("500") ||
           msg.includes("overloaded") || msg.includes("timeout") || msg.includes("ECONNRESET");
  }
  return false;
}

async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
  retries = 1
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (retries > 0 && isRetryable(err)) {
      logger.warn({ err }, "Claude API transient error — retrying in 2s");
      await new Promise((r) => setTimeout(r, 2000));
      return callClaude(params, retries - 1);
    }
    throw err;
  }
}

async function loadConversationHistory(
  channelId: string,
  platform: string,
  limit: number = 5
): Promise<Anthropic.MessageParam[]> {
  try {
    const result = await pgQuery(
      `SELECT question, answer FROM pascal_conversation_log
       WHERE channel_id = $1 AND platform = $2 AND error IS NULL
       ORDER BY created_at DESC LIMIT $3`,
      [channelId, platform, limit]
    );
    const rows = result.rows.reverse(); // newest-first → chronological
    const messages: Anthropic.MessageParam[] = [];
    for (const row of rows) {
      messages.push({ role: "user", content: row.question });
      messages.push({ role: "assistant", content: row.answer });
    }
    return messages;
  } catch (err) {
    logger.warn({ err }, "Failed to load conversation history — non-fatal");
    return [];
  }
}

async function runToolLoop(
  question: string,
  systemPrompt: string,
  merchantCtx: MerchantContext,
  history: Anthropic.MessageParam[] = [],
  opts: { budgetMs?: number } = {}
): Promise<ToolLoopResult> {
  const budgetMs = opts.budgetMs ?? DEFAULT_TOOL_LOOP_BUDGET_MS;
  const loopStartedAt = Date.now();
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: question },
  ];

  const toolCalls: { tool: string; input: Record<string, unknown> }[] = [];
  const toolOutputs: string[] = [];
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    // AID-84: wall-clock budget check at the top of every round.
    // Avoids paying for an inference + tool roundtrip we already
    // know will land past the budget. Channel adapters surface this
    // as a "taking longer than expected" message + follow-up reply.
    const elapsed = Date.now() - loopStartedAt;
    if (elapsed > budgetMs) {
      logger.warn(
        {
          elapsed,
          budgetMs,
          rounds,
          merchant: merchantCtx.businessName,
          toolsCalled: toolCalls.map((t) => t.tool),
        },
        "Tool loop budget exhausted — returning timeout fallback"
      );
      return {
        answer:
          "This one is taking longer than usual on my end. I'll keep working on it and follow up shortly — feel free to rephrase if you have a more specific question.",
        toolCalls,
        toolOutputs,
        rounds,
        budgetExhausted: true,
      };
    }

    rounds++;

    const response = await callClaude({
      model: config.claude.model,
      max_tokens: 2048,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolBlocks.length === 0) {
      const answer = textBlocks.map((b) => b.text).join("\n") || "I couldn't generate a response.";
      return { answer, toolCalls, toolOutputs, rounds };
    }

    logger.info(
      { tools: toolBlocks.map((t) => t.name), round: rounds, merchant: merchantCtx.businessName },
      "Pascal requesting tools"
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolBlocks) {
      const input = toolBlock.input as Record<string, unknown>;
      toolCalls.push({ tool: toolBlock.name, input });

      const rawResult = await executeTool(toolBlock.name, input, merchantCtx);
      const sanitized = sanitizeToolOutput(rawResult);
      toolOutputs.push(sanitized);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: sanitized,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") {
      const answer = textBlocks.map((b) => b.text).join("\n") || "I couldn't generate a response.";
      return { answer, toolCalls, toolOutputs, rounds };
    }
  }

  return {
    answer: "I needed too many steps to answer that. Please try a more specific question.",
    toolCalls,
    toolOutputs,
    rounds,
  };
}
