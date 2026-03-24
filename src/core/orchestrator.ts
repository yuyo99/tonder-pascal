import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { buildSystemPrompt, buildAmbientSupplement, buildPeopleContext } from "./prompts";
import { getTeamDirectory } from "./tonder-team";
import { toolDefinitions, executeTool, consumePendingAttachments } from "./tools";
import { sanitizeToolOutput, auditResponse } from "./provider-mask";
import { resolveMerchantContext } from "../merchants/context";
import { IncomingMessage } from "../channels/types";
import { MerchantContext } from "../merchants/types";
import { trackInteraction } from "../scheduler/daily-report";
import { findRelevantKnowledge, KnowledgeEntry } from "../knowledge/loader";
import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 60_000 });
const MAX_TOOL_ROUNDS = 5;
const HANDLER_TIMEOUT_MS = 90_000; // 90s max for entire message handling

interface ToolLoopResult {
  answer: string;
  toolCalls: { tool: string; input: Record<string, unknown> }[];
  rounds: number;
  attachments?: { buffer: Buffer; filename: string }[];
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
    logger.warn(
      { channelId: msg.channelId, platform: msg.platform },
      "Message from unmapped channel"
    );
    return { text: "This channel is not configured for Pascal. Please contact Tonder support to set up your account." };
  }

  logger.info(
    { merchant: merchantCtx.businessName, platform: msg.platform, user: msg.userName },
    "Processing merchant question"
  );

  // Step 2: Build merchant-specific system prompt
  let systemPrompt = buildSystemPrompt(merchantCtx);

  // Step 2b: Inject relevant knowledge into system prompt
  const knowledgeMatches = findRelevantKnowledge(msg.text);
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
  const history = await loadConversationHistory(msg.channelId, msg.platform, 5);
  if (history.length > 0) {
    systemPrompt += `\n\n## Conversation History\nYou have access to recent messages in this channel. Use them for context (pronouns like "it", "that transaction", "yesterday's issue" refer to prior messages). Don't repeat information already given unless asked.`;
    logger.info(
      { turns: history.length / 2, merchant: merchantCtx.businessName },
      "Conversation history loaded"
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
    const errMsg = err instanceof Error ? err.message : String(err);
    const errType = err instanceof Error ? err.constructor.name : typeof err;
    logger.error({ err, errType, errMsg, merchant: merchantCtx.businessName }, "Orchestrator error");
    storeErrorFromCatch("orchestrator", err, { merchant: merchantCtx.businessName, platform: msg.platform, channel: msg.channelId, user: msg.userName });

    let answer: string;
    if (errMsg.includes("Handler timeout")) {
      answer = "Sorry, this request took too long. Please try again with a more specific question.";
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
    result = { answer, toolCalls: [], rounds: 0 };
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
  const attachments = consumePendingAttachments();

  const latencyMs = Date.now() - startTime;
  logConversation(merchantCtx, msg, result, latencyMs, error, knowledgeMatches);

  logger.info(
    { hasAttachments: attachments.length > 0, attachmentCount: attachments.length, filenames: attachments.map(a => a.filename), bufferSizes: attachments.map(a => a.buffer?.length ?? 0) },
    "Orchestrator returning response"
  );

  return {
    text: result.answer,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

// ── Conversation logging (fire-and-forget) ──

function logConversation(
  ctx: MerchantContext,
  msg: IncomingMessage,
  result: ToolLoopResult,
  latencyMs: number,
  error?: string,
  knowledgeMatches: KnowledgeEntry[] = []
): void {
  const knowledgeUsed = knowledgeMatches.map((k) => ({
    id: k.id,
    title: k.title,
    category: k.category,
  }));

  pgQuery(
    `INSERT INTO pascal_conversation_log
      (merchant_id, merchant_name, platform, channel_id, user_name, question, answer, tool_calls, rounds, latency_ms, error, knowledge_used)
     VALUES (
       (SELECT id FROM pascal_merchant_channels WHERE platform = $1 AND channel_id = $2 LIMIT 1),
       $3, $1, $2, $4, $5, $6, $7, $8, $9, $10, $11
     )`,
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
  ).catch((err) => {
    logger.warn({ err }, "Failed to log conversation — non-fatal");
  });
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
  history: Anthropic.MessageParam[] = []
): Promise<ToolLoopResult> {
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: question },
  ];

  const toolCalls: { tool: string; input: Record<string, unknown> }[] = [];
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
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
      return { answer, toolCalls, rounds };
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

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: sanitized,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") {
      const answer = textBlocks.map((b) => b.text).join("\n") || "I couldn't generate a response.";
      return { answer, toolCalls, rounds };
    }
  }

  return {
    answer: "I needed too many steps to answer that. Please try a more specific question.",
    toolCalls,
    rounds,
  };
}
