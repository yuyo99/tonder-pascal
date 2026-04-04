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
  const body = await req.json();
  const { category, title, content, match_pattern, action, business_id } = body;

  if (!category || !title || !content || !match_pattern) {
    return NextResponse.json(
      { error: "Missing required fields: category, title, content, match_pattern" },
      { status: 400 }
    );
  }

  const embeddingStr = await generateEmbedding(`${title}\n${content}`);

  const result = await query(
    `INSERT INTO pascal_knowledge_base
       (category, match_pattern, title, content, action, source, confidence, business_id, priority, is_active, embedding)
     VALUES ($1, $2, $3, $4, $5, 'dashboard:training', 1.0, $6, 5, true, $7)
     RETURNING id, category, title`,
    [category, match_pattern, title, content, action || null, business_id || null, embeddingStr]
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}
