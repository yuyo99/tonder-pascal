import { Pool, QueryResult } from "pg";

function getPool(): Pool {
  const existing = (globalThis as Record<string, unknown>).__pgPool as
    | Pool
    | undefined;
  if (existing) return existing;

  const connectionString =
    process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL env var");

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  (globalThis as Record<string, unknown>).__pgPool = pool;
  return pool;
}

export async function query(
  text: string,
  params?: unknown[]
): Promise<QueryResult> {
  return getPool().query(text, params);
}
