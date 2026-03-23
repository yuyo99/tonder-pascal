/**
 * Ambient triage — lightweight Claude Haiku call to decide if Pascal should respond.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { buildTriagePrompt } from "./triage-prompt";
import { logger } from "../utils/logger";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 15_000 });

const CONFIDENCE_THRESHOLD = 0.85;
const TICKET_CONFIDENCE_THRESHOLD = 0.90;

export type TriageAction = "answer" | "create_ticket" | "silent";
export type TicketTeam = "sos" | "finops" | "int" | null;

export interface TriageResult {
  shouldRespond: boolean;
  confidence: number;
  reason: string;
  action: TriageAction;
  ticketTeam: TicketTeam;
}

const SILENT_RESULT: TriageResult = {
  shouldRespond: false,
  confidence: 0,
  reason: "default silent",
  action: "silent",
  ticketTeam: null,
};

export async function triageMessage(params: {
  message: string;
  senderName: string;
  isTonderTeam: boolean;
  threadContext: string[];
  merchantName: string;
  platform: "slack" | "telegram";
}): Promise<TriageResult> {
  // Quick filters before calling Claude
  if (params.isTonderTeam) {
    logger.debug({ sender: params.senderName }, "Triage: skip — Tonder team member");
    return SILENT_RESULT;
  }

  const trimmed = params.message.trim();
  if (trimmed.length < 10) {
    logger.debug({ text: trimmed }, "Triage: skip — too short");
    return SILENT_RESULT;
  }

  // Build context string from recent messages
  const contextBlock = params.threadContext.length > 0
    ? `\n\n## Recent messages in this thread/channel (newest last):\n${params.threadContext.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : "";

  const systemPrompt = buildTriagePrompt({
    merchantName: params.merchantName,
    senderName: params.senderName,
    isTonderTeam: params.isTonderTeam,
    platform: params.platform,
  });

  const userMessage = `${contextBlock}\n\n## Current message (from ${params.senderName}):\n${params.message}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse JSON from response (may be wrapped in code block)
    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as {
      should_respond: boolean;
      confidence: number;
      reason: string;
      action: TriageAction;
      ticket_team?: TicketTeam;
    };

    const threshold = parsed.action === "create_ticket"
      ? TICKET_CONFIDENCE_THRESHOLD
      : CONFIDENCE_THRESHOLD;

    const shouldRespond = parsed.should_respond && parsed.confidence >= threshold && parsed.action !== "silent";

    const result: TriageResult = {
      shouldRespond,
      confidence: parsed.confidence,
      reason: parsed.reason,
      action: shouldRespond ? parsed.action : "silent",
      ticketTeam: parsed.action === "create_ticket" && shouldRespond ? (parsed.ticket_team ?? null) : null,
    };

    logger.info(
      {
        merchant: params.merchantName,
        sender: params.senderName,
        action: result.action,
        confidence: result.confidence,
        reason: result.reason,
        ticketTeam: result.ticketTeam,
      },
      "Triage decision"
    );

    return result;
  } catch (err) {
    logger.error({ err }, "Triage call failed — defaulting to silent");
    return SILENT_RESULT;
  }
}
