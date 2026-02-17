import { Pool, QueryResult } from "pg";
import { logger } from "../utils/logger";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL env var");

  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  return pool;
}

export async function pgQuery(
  text: string,
  params?: unknown[]
): Promise<QueryResult> {
  return getPool().query(text, params);
}

export async function disconnectPg(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("PostgreSQL pool closed");
  }
}
