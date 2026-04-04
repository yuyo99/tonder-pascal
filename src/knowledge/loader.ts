/**
 * Pascal Knowledge Base Loader
 *
 * Provides findRelevantKnowledge() for system prompt injection.
 * Primary: semantic search via pgvector cosine similarity.
 * Fallback: keyword-based substring matching (if pgvector unavailable).
 */

import { pgQuery } from "../postgres/connection";
import { generateEmbedding } from "../lib/embeddings";
import { logger } from "../utils/logger";

export interface KnowledgeEntry {
  id: string;
  category: string;
  match_pattern: string;
  title: string;
  content: string;
  action: string | null;
  priority: number;
}

// Keyword cache for fallback
let cache: KnowledgeEntry[] = [];
let lastLoaded = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Load all active knowledge entries from DB into cache (for keyword fallback) */
export async function loadKnowledgeBase(): Promise<void> {
  try {
    const result = await pgQuery(
      `SELECT id, category, match_pattern, title, content, action, priority
       FROM pascal_knowledge_base
       WHERE is_active = true
       ORDER BY priority ASC`
    );
    cache = result.rows;
    lastLoaded = Date.now();
    if (cache.length > 0) {
      logger.info({ count: cache.length }, "Pascal knowledge base loaded");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load knowledge base (using cached data)");
  }
}

/** Ensure keyword cache is fresh */
async function ensureFreshCache(): Promise<KnowledgeEntry[]> {
  if (Date.now() - lastLoaded > CACHE_TTL) {
    await loadKnowledgeBase();
  }
  return cache;
}

/** Keyword-based fallback search (existing logic) */
function keywordSearch(question: string, entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const lower = question.toLowerCase();
  return entries.filter((entry) => {
    const patterns = entry.match_pattern
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    return patterns.some((pattern) => lower.includes(pattern));
  });
}

/**
 * Find relevant knowledge entries for a question.
 * Uses semantic search (pgvector) first, falls back to keyword matching.
 * Now async — callers must await.
 */
export async function findRelevantKnowledge(
  question: string,
  businessId?: number
): Promise<KnowledgeEntry[]> {
  // Try semantic search first
  try {
    const embedding = await generateEmbedding(question);
    if (embedding) {
      const result = await pgQuery(
        `SELECT id, category, match_pattern, title, content, action, priority
         FROM pascal_knowledge_base
         WHERE is_active = true
           AND embedding IS NOT NULL
           AND (business_id IS NULL OR business_id = $2)
         ORDER BY embedding <=> $1::vector
         LIMIT 5`,
        [`[${embedding.join(",")}]`, businessId ?? null]
      );
      if (result.rows.length > 0) {
        logger.debug(
          { count: result.rows.length, method: "semantic" },
          "Knowledge found via semantic search"
        );
        return result.rows;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Semantic search failed — falling back to keyword");
  }

  // Keyword fallback
  const entries = await ensureFreshCache();
  const matches = keywordSearch(question, entries);
  if (matches.length > 0) {
    logger.debug(
      { count: matches.length, method: "keyword" },
      "Knowledge found via keyword fallback"
    );
  }
  return matches;
}
