/**
 * Shared function for inserting knowledge base entries.
 * Used by: /api/training, @Pascal learn:, nightly auto-learn, gap queue answers.
 * Generates embedding on insert for semantic search.
 */

import { pgQuery } from "../postgres/connection";
import { generateEmbedding } from "../lib/embeddings";
import { loadKnowledgeBase } from "./loader";
import { logger } from "../utils/logger";

export interface SaveKnowledgeParams {
  category: string;
  matchPattern: string;
  title: string;
  content: string;
  action?: string;
  source?: string;
  confidence?: number;
  businessId?: number;
  priority?: number;
}

/**
 * Insert a knowledge entry with embedding generation.
 * Returns the new entry's UUID.
 */
export async function saveKnowledgeEntry(params: SaveKnowledgeParams): Promise<string> {
  const embedding = await generateEmbedding(`${params.title}\n${params.content}`);

  const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

  const result = await pgQuery(
    `INSERT INTO pascal_knowledge_base
       (category, match_pattern, title, content, action, source, confidence, business_id, priority, is_active, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
     RETURNING id`,
    [
      params.category,
      params.matchPattern,
      params.title,
      params.content,
      params.action ?? null,
      params.source ?? "manual",
      params.confidence ?? 1.0,
      params.businessId ?? null,
      params.priority ?? 5,
      embeddingStr,
    ]
  );

  const id = result.rows[0].id;
  logger.info(
    { id, title: params.title, category: params.category, source: params.source, hasEmbedding: !!embedding },
    "Knowledge entry saved"
  );

  // Refresh keyword cache
  await loadKnowledgeBase();

  return id;
}
