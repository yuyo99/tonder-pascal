/**
 * Pascal Knowledge Base Loader
 *
 * Caches pascal_knowledge_base entries from PostgreSQL with a 10-minute TTL.
 * Provides findRelevantKnowledge() for system prompt injection.
 * Pattern: adapted from Marcus's knowledge/loader.ts.
 */

import { pgQuery } from "../postgres/connection";
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

let cache: KnowledgeEntry[] = [];
let lastLoaded = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Load all active knowledge entries from DB into cache */
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

/** Ensure cache is fresh, trigger background refresh if stale */
function ensureFresh(): KnowledgeEntry[] {
  if (Date.now() - lastLoaded > CACHE_TTL) {
    loadKnowledgeBase().catch(() => {});
  }
  return cache;
}

/**
 * Find all knowledge entries whose match_pattern matches the question.
 * Supports comma-separated patterns (e.g. "refund, reembolso, devolucion").
 * Returns matches sorted by priority (lowest = highest priority).
 */
export function findRelevantKnowledge(question: string): KnowledgeEntry[] {
  const entries = ensureFresh();
  const lower = question.toLowerCase();

  const matches: KnowledgeEntry[] = [];

  for (const entry of entries) {
    // Split comma-separated patterns and check each
    const patterns = entry.match_pattern
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    const matched = patterns.some((pattern) => lower.includes(pattern));
    if (matched) {
      matches.push(entry);
    }
  }

  return matches; // already sorted by priority from the SQL query
}
