import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { buildSystemPrompt } from "./prompts";
import { toolDefinitions, executeTool } from "./tools";
import { sanitizeToolOutput, auditResponse } from "./provider-mask";
import { resolveMerchantContext } from "../merchants/context";
import { MerchantContext } from "../merchants/types";
import { IncomingMessage } from "../channels/types";
import { trackInteraction } from "../scheduler/daily-report";
import { logger } from "../utils/logger";

const client = new Anthropic({ apiKey: config.claude.apiKey });
const MAX_TOOL_ROUNDS = 5;

/**
 * Handle an incoming message from any channel.
 * Returns the response text to send back.
 */
export async function handleIncomingMessage(msg: IncomingMessage): Promise<string> {
  // Step 1: Resolve merchant context
  const merchantCtx = await resolveMerchantContext(msg.channelId, msg.platform);
  if (!merchantCtx) {
    logger.warn(
      { channelId: msg.channelId, platform: msg.platform },
      "Message from unmapped channel"
    );
    return "This channel is not configured for Pascal. Please contact Tonder support to set up your account.";
  }

  logger.info(
    { merchant: merchantCtx.businessName, platform: msg.platform, user: msg.userName },
    "Processing merchant question"
  );

  // Step 2: Build merchant-specific system prompt
  const systemPrompt = buildSystemPrompt(merchantCtx);

  // Step 3: Run Claude tool-use loop
  let answer: string;
  let ticketCreated = false;
  let ticketId: string | undefined;

  try {
    const result = await runToolLoop(msg.text, systemPrompt, merchantCtx);
    answer = result.answer;
    ticketCreated = result.ticketCreated;
    ticketId = result.ticketId;
  } catch (err) {
    logger.error({ err, merchant: merchantCtx.businessName }, "Orchestrator error");
    answer = "I'm sorry, I encountered an error processing your request. Please try again or contact Tonder support.";
  }

  // Step 4: Final audit — catch any leaked provider names
  const leaked = auditResponse(answer);
  if (leaked.length > 0) {
    logger.warn(
      { leaked, merchant: merchantCtx.businessName },
      "Provider names leaked in response — sanitizing"
    );
    answer = sanitizeToolOutput(answer);
  }

  // Step 5: Track interaction for daily report
  trackInteraction({
    merchantName: merchantCtx.businessName,
    question: msg.text,
    answered: !ticketCreated,
    ticketId,
    timestamp: new Date(),
  });

  return answer;
}

interface ToolLoopResult {
  answer: string;
  ticketCreated: boolean;
  ticketId?: string;
}

async function runToolLoop(
  question: string,
  systemPrompt: string,
  merchantCtx: MerchantContext
): Promise<ToolLoopResult> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: question },
  ];

  let rounds = 0;
  let ticketCreated = false;
  let ticketId: string | undefined;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const response = await client.messages.create({
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
      return {
        answer: textBlocks.map((b) => b.text).join("\n") || "I couldn't generate a response.",
        ticketCreated,
        ticketId,
      };
    }

    logger.info(
      { tools: toolBlocks.map((t) => t.name), round: rounds, merchant: merchantCtx.businessName },
      "Pascal requesting tools"
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolBlocks) {
      const rawResult = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        merchantCtx
      );

      // Track if a support ticket was created
      if (toolBlock.name === "create_support_ticket") {
        try {
          const parsed = JSON.parse(rawResult);
          if (parsed.created) {
            ticketCreated = true;
            ticketId = parsed.ticketId;
          }
        } catch {
          // ignore parse errors
        }
      }

      // Sanitize provider names before Claude sees tool output
      const sanitized = sanitizeToolOutput(rawResult);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: sanitized,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") {
      return {
        answer: textBlocks.map((b) => b.text).join("\n") || "I couldn't generate a response.",
        ticketCreated,
        ticketId,
      };
    }
  }

  return {
    answer: "I needed too many steps to answer that. Please try a more specific question.",
    ticketCreated,
    ticketId,
  };
}
