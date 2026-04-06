/**
 * Nightly Auto-Learn Job (AID-79)
 *
 * Runs at 2:00 AM Mexico City. Mines pascal_conversation_log for
 * high-quality Q&A pairs, deduplicates against existing knowledge,
 * and promotes them to pascal_knowledge_base.
 */

import { pgQuery } from "../postgres/connection";
import { generateEmbedding } from "../lib/embeddings";
import { saveKnowledgeEntry } from "../knowledge/save-entry";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

const DEDUP_COSINE_THRESHOLD = 0.92;

interface ConversationRow {
  id: string;
  question: string;
  answer: string;
  channel_id: string;
  platform: string;
  merchant_name: string;
  business_ids: number[] | null;
  created_at: string;
}

/**
 * Infer a knowledge category from the question text.
 */
function inferCategory(question: string): string {
  const q = question.toLowerCase();
  if (/decline|rejected|error.?code|failed|rechaz/.test(q)) return "decline_code";
  if (/integrat|sdk|api|webhook|checkout|hosted/.test(q)) return "integration";
  if (/spei|oxxo|card|payment.?method|tarjeta/.test(q)) return "payment_method";
  if (/refund|policy|allowed|forbidden|reembolso/.test(q)) return "policy";
  if (/withdraw|payout|settlement|retiro|liquidaci/.test(q)) return "troubleshooting";
  return "faq";
}

/**
 * Build a match_pattern from the question (extract key terms).
 */
function buildMatchPattern(question: string): string {
  const stopwords = new Set(["the", "a", "an", "is", "are", "was", "were", "what", "how", "why", "when", "where", "can", "do", "does", "did", "i", "my", "me", "we", "our", "you", "your", "it", "its", "this", "that", "for", "to", "in", "on", "of", "with", "and", "or", "not", "no", "de", "el", "la", "los", "las", "un", "una", "es", "en", "por", "para", "con", "que", "del", "al", "se", "su", "como", "más", "pero", "si"]);
  const words = question.toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/gi, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  // Take the first 5 unique keywords
  return [...new Set(words)].slice(0, 5).join(", ");
}

/**
 * Check if a Q&A pair is too similar to existing knowledge entries.
 * Returns true if a near-duplicate exists (should skip).
 */
async function isDuplicate(embedding: number[]): Promise<boolean> {
  try {
    const result = await pgQuery(
      `SELECT id FROM pascal_knowledge_base
       WHERE embedding IS NOT NULL
         AND is_active = true
         AND 1 - (embedding <=> $1::vector) > $2
       LIMIT 1`,
      [`[${embedding.join(",")}]`, DEDUP_COSINE_THRESHOLD]
    );
    return result.rows.length > 0;
  } catch {
    // pgvector not available — skip dedup, allow insertion
    return false;
  }
}

/**
 * Run the nightly auto-learn job.
 */
export async function runNightlyLearn(): Promise<void> {
  const startTime = Date.now();
  logger.info("Nightly auto-learn: starting...");

  // Step 1: Fetch high-quality conversations from last 24h
  const { rows: conversations } = (await pgQuery(`
    SELECT cl.id, cl.question, cl.answer, cl.channel_id, cl.platform,
           cl.merchant_name, cl.created_at,
           mc.business_ids
    FROM pascal_conversation_log cl
    LEFT JOIN pascal_merchant_channels mc ON mc.id = cl.merchant_id
    WHERE cl.created_at >= NOW() - INTERVAL '24 hours'
      AND cl.error IS NULL
      AND length(cl.question) >= 20
      AND length(cl.answer) >= 30
    ORDER BY cl.created_at DESC
  `)) as { rows: ConversationRow[] };

  logger.info({ totalConversations: conversations.length }, "Nightly auto-learn: conversations fetched");

  let promoted = 0;
  let skippedQA = 0;
  let skippedDedup = 0;
  let skippedEmbed = 0;

  for (const conv of conversations) {
    // Step 2: Check if there's a matching self-QA event with status = 'ok'
    const { rows: qaMatch } = await pgQuery(
      `SELECT 1 FROM pascal_self_qa_events
       WHERE channel_id = $1 AND platform = $2
         AND status = 'ok' AND responded = true AND fallback_used = false
         AND created_at BETWEEN $3::timestamptz - INTERVAL '10 seconds'
                             AND $3::timestamptz + INTERVAL '10 seconds'
       LIMIT 1`,
      [conv.channel_id, conv.platform, conv.created_at]
    );

    if (qaMatch.length === 0) {
      skippedQA++;
      continue;
    }

    // Step 3: Generate embedding
    const text = `${conv.question}\n${conv.answer}`;
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      skippedEmbed++;
      continue;
    }

    // Step 4: Dedup against existing KB
    if (await isDuplicate(embedding)) {
      skippedDedup++;
      continue;
    }

    // Step 5: Insert as new knowledge entry
    const category = inferCategory(conv.question);
    const matchPattern = buildMatchPattern(conv.question);
    const businessId = conv.business_ids?.[0] ?? undefined;

    try {
      await saveKnowledgeEntry({
        category,
        matchPattern,
        title: conv.question.slice(0, 200),
        content: conv.answer.slice(0, 2000),
        source: "auto:conversation_log",
        confidence: 0.7,
        businessId,
        priority: 7, // Lower priority than manual entries (5)
      });
      promoted++;
    } catch (err) {
      logger.warn({ err, convId: conv.id }, "Nightly auto-learn: failed to save entry");
      storeErrorFromCatch("scheduler", err, { action: "nightly_learn", conversationId: conv.id });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    { promoted, skippedQA, skippedDedup, skippedEmbed, total: conversations.length, durationMs },
    "Nightly auto-learn: complete"
  );
}
