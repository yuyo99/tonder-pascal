export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10_000 })
  : null;

async function generateEmbedding(text: string): Promise<string | null> {
  if (!openai) return null;
  try {
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return `[${resp.data[0].embedding.join(",")}]`;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, title, content, match_pattern, action, business_id } = body;

    if (!category || !title || !content || !match_pattern) {
      return NextResponse.json(
        { error: "Missing required fields: category, title, content, match_pattern" },
        { status: 400 }
      );
    }

    const embeddingStr = await generateEmbedding(`${title}\n${content}`);

    // Try with embedding first. If pgvector isn't available or embedding is null, fall back to NULL.
    try {
      const result = await query(
        `INSERT INTO pascal_knowledge_base
           (category, match_pattern, title, content, action, source, confidence, business_id, priority, is_active, embedding)
         VALUES ($1, $2, $3, $4, $5, 'dashboard:training', 1.0, $6, 5, true, $7)
         RETURNING id, category, title`,
        [category, match_pattern, title, content, action || null, business_id || null, embeddingStr]
      );
      return NextResponse.json(result.rows[0], { status: 201 });
    } catch (dbErr) {
      // If embedding column doesn't exist or pgvector failed, retry without embedding
      const dbMsg = dbErr instanceof Error ? dbErr.message : "";
      if (dbMsg.includes("embedding") || dbMsg.includes("vector")) {
        console.warn("Training INSERT failed on embedding — retrying without it:", dbMsg);
        const result = await query(
          `INSERT INTO pascal_knowledge_base
             (category, match_pattern, title, content, action, source, confidence, business_id, priority, is_active)
           VALUES ($1, $2, $3, $4, $5, 'dashboard:training', 1.0, $6, 5, true)
           RETURNING id, category, title`,
          [category, match_pattern, title, content, action || null, business_id || null]
        );
        return NextResponse.json(result.rows[0], { status: 201 });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error("Training POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
