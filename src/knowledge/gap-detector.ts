/**
 * Knowledge Gap Detector (AID-80)
 *
 * When Pascal can't answer well (fallback, low confidence), records the
 * question as a gap. Deduplicates by cosine similarity — similar questions
 * increment frequency instead of creating new gaps.
 */

import { pgQuery } from "../postgres/connection";
import { generateEmbedding } from "../lib/embeddings";
import { logger } from "../utils/logger";

const DEDUP_COSINE_THRESHOLD = 0.88;

/**
 * Infer a suggested category from the question (same heuristic as nightly-learn).
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

export interface GapInput {
  question: string;
  channelId: string;
  platform: string;
  merchantName?: string;
  businessId?: number;
}

/**
 * Detect and record a knowledge gap.
 * If a similar gap already exists (cosine > 0.88), increments frequency.
 * Otherwise creates a new pending gap.
 */
export async function detectAndRecordGap(input: GapInput): Promise<void> {
  const { question, channelId, platform, merchantName, businessId } = input;

  // Skip trivial messages
  if (!question || question.trim().length < 15) return;

  // Generate embedding for dedup
  const embedding = await generateEmbedding(question);

  if (embedding) {
    // Check for similar existing gap
    try {
      const { rows: existing } = await pgQuery(
        `SELECT id FROM pascal_knowledge_gaps
         WHERE status = 'pending'
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> $1::vector) > $2
         LIMIT 1`,
        [`[${embedding.join(",")}]`, DEDUP_COSINE_THRESHOLD]
      );

      if (existing.length > 0) {
        // Similar gap exists — increment frequency
        await pgQuery(
          `UPDATE pascal_knowledge_gaps
           SET frequency = frequency + 1, updated_at = now()
           WHERE id = $1`,
          [existing[0].id]
        );
        logger.debug({ gapId: existing[0].id }, "Gap frequency incremented (similar question)");
        return;
      }
    } catch (err) {
      // pgvector not available — fall through to simple insert without dedup
      logger.debug({ err }, "Gap dedup via embedding failed — inserting without dedup");
    }
  }

  // Insert new gap
  const category = inferCategory(question);
  const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

  await pgQuery(
    `INSERT INTO pascal_knowledge_gaps
       (question, channel_id, platform, merchant_name, business_id, suggested_category, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [question.slice(0, 1000), channelId, platform, merchantName ?? null, businessId ?? null, category, embeddingStr]
  );

  logger.info(
    { channelId, platform, category, questionLen: question.length },
    "Knowledge gap recorded"
  );
}
