/**
 * Feedback Learning Handler
 *
 * When Pascal is @mentioned with trigger words (feedback, learn, add this, etc.),
 * this module extracts structured knowledge using Claude and saves it to
 * pascal_knowledge_base for future use.
 */

import Anthropic from "@anthropic-ai/sdk";
import { WebClient } from "@slack/web-api";
import { config } from "../config";
import { pgQuery } from "../postgres/connection";
import { loadKnowledgeBase } from "./loader";
import { logger } from "../utils/logger";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 30_000 });

const EXTRACTION_PROMPT = `You are a knowledge extraction assistant for Pascal, a payment processing AI assistant.

Extract structured knowledge from the following team feedback message. The knowledge will be stored and used to improve Pascal's responses to merchants.

Return ONLY a JSON object (no markdown fences, no explanation) with these fields:
- "category": topic area (e.g., "transactions", "withdrawals", "onboarding", "chargebacks", "settlements", "general", "integration", "guardian")
- "match_pattern": comma-separated lowercase keywords that should trigger this knowledge when a merchant asks a question (e.g., "chargeback, dispute, contracargo")
- "title": short descriptive title (max 80 chars)
- "content": the full knowledge/instruction Pascal should remember and use when responding
- "action": recommended action Pascal should take when this knowledge is triggered, or null if not applicable

Example output:
{"category":"chargebacks","match_pattern":"chargeback, dispute, contracargo","title":"Chargeback dispute window","content":"When merchants ask about chargebacks, always mention the 30-day dispute window from the date the chargeback is received.","action":"Mention the 30-day window and advise them to contact support if the deadline is approaching."}`;

export async function handleFeedbackMessage(params: {
  text: string;
  channelId: string;
  threadTs: string;
  userId: string;
  slackClient: WebClient;
}): Promise<void> {
  const { text, channelId, threadTs, userId, slackClient } = params;

  // Post thinking indicator
  const thinking = await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: "Processing feedback... :brain:",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Processing feedback... :brain:" },
      },
    ],
  });

  try {
    // Call Claude to extract structured knowledge
    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: 512,
      messages: [{ role: "user", content: text }],
      system: EXTRACTION_PROMPT,
    });

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse JSON — strip markdown fences if Claude adds them
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const extracted = JSON.parse(cleaned) as {
      category: string;
      match_pattern: string;
      title: string;
      content: string;
      action: string | null;
    };

    // Validate required fields
    if (!extracted.category || !extracted.match_pattern || !extracted.title || !extracted.content) {
      throw new Error("Missing required fields in extracted knowledge");
    }

    // Insert into knowledge base
    await pgQuery(
      `INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority, is_active)
       VALUES ($1, $2, $3, $4, $5, 5, true)`,
      [
        extracted.category,
        extracted.match_pattern,
        extracted.title,
        extracted.content,
        extracted.action || null,
      ]
    );

    // Force-refresh knowledge cache
    await loadKnowledgeBase();

    logger.info(
      { title: extracted.title, category: extracted.category, patterns: extracted.match_pattern, user: userId },
      "Feedback saved to knowledge base"
    );

    // Acknowledge in channel
    await slackClient.chat.update({
      channel: channelId,
      ts: thinking.ts!,
      text: `Learned: ${extracted.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:white_check_mark: *Knowledge saved*\n*Title:* ${extracted.title}\n*Category:* ${extracted.category}\n*Patterns:* \`${extracted.match_pattern}\``,
          },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Added by <@${userId}> | Pascal Knowledge Base` },
          ],
        },
      ],
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId, channelId }, "Failed to process feedback");

    await slackClient.chat.update({
      channel: channelId,
      ts: thinking.ts!,
      text: `Failed to process feedback: ${errMsg}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:x: *Failed to save feedback*\n${errMsg}\n\nPlease try rephrasing your feedback and try again.`,
          },
        },
      ],
    });
  }
}
