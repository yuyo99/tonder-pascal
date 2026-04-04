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

interface BulkEntry {
  category: string;
  title: string;
  content: string;
  match_pattern: string;
  action?: string;
  business_id?: number;
}

export async function POST(req: NextRequest) {
  const { entries } = (await req.json()) as { entries: BulkEntry[] };

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "No entries provided" }, { status: 400 });
  }

  if (entries.length > 100) {
    return NextResponse.json({ error: "Max 100 entries per batch" }, { status: 400 });
  }

  const results: { title: string; status: string; error?: string }[] = [];

  for (const entry of entries) {
    if (!entry.category || !entry.title || !entry.content || !entry.match_pattern) {
      results.push({ title: entry.title || "(missing)", status: "error", error: "Missing required fields" });
      continue;
    }

    try {
      const embeddingStr = await generateEmbedding(`${entry.title}\n${entry.content}`);
      await query(
        `INSERT INTO pascal_knowledge_base
           (category, match_pattern, title, content, action, source, confidence, business_id, priority, is_active, embedding)
         VALUES ($1, $2, $3, $4, $5, 'dashboard:bulk', 1.0, $6, 5, true, $7)`,
        [entry.category, entry.match_pattern, entry.title, entry.content, entry.action || null, entry.business_id || null, embeddingStr]
      );
      results.push({ title: entry.title, status: "ok" });
    } catch (err) {
      results.push({ title: entry.title, status: "error", error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;

  return NextResponse.json({ results, total: entries.length, ok, failed }, { status: 201 });
}
