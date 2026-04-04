/**
 * Embedding generation via OpenAI text-embedding-3-small.
 * Used for semantic search over pascal_knowledge_base (pgvector).
 * Anthropic doesn't have an embedding API, so we use OpenAI for this.
 */

import OpenAI from "openai";
import { config } from "../config";
import { logger } from "../utils/logger";

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!config.openai.apiKey) return null;
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey, timeout: 10_000 });
  return client;
}

/**
 * Generate a 1536-dimensional embedding for the given text.
 * Returns null if OpenAI is not configured or the call fails.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const openai = getClient();
  if (!openai) {
    logger.debug("OpenAI not configured — skipping embedding generation");
    return null;
  }

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // text-embedding-3-small supports 8191 tokens
    });
    return response.data[0].embedding;
  } catch (err) {
    logger.warn({ err }, "Failed to generate embedding — semantic search unavailable");
    return null;
  }
}
