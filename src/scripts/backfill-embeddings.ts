/**
 * Backfill embeddings for existing pascal_knowledge_base entries.
 * Run once after deploying pgvector: npx tsx src/scripts/backfill-embeddings.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

import { pgQuery, disconnectPg } from "../postgres/connection";
import { generateEmbedding } from "../lib/embeddings";

async function backfill() {
  const { rows } = await pgQuery(
    `SELECT id, title, content FROM pascal_knowledge_base WHERE embedding IS NULL AND is_active = true`
  );

  console.log(`Found ${rows.length} entries without embeddings`);

  let updated = 0;
  for (const row of rows) {
    const text = `${row.title}\n${row.content}`;
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      console.log(`  Skipped ${row.id} — embedding generation failed`);
      continue;
    }

    await pgQuery(
      `UPDATE pascal_knowledge_base SET embedding = $1 WHERE id = $2`,
      [`[${embedding.join(",")}]`, row.id]
    );
    updated++;
    console.log(`  Backfilled ${row.id}: "${row.title.slice(0, 50)}..."`);
  }

  console.log(`Done. Updated ${updated}/${rows.length} entries.`);
  await disconnectPg();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
