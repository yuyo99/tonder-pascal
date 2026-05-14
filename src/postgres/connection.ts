import { Client, Pool, QueryResult } from "pg";
import { logger } from "../utils/logger";

let pool: Pool | null = null;

/**
 * Bigint key for the Postgres advisory lock that gates Telegram bot
 * polling to a single process across the cluster. Value is arbitrary
 * but stable — pg advisory keys are application-defined. 0x70617363 =
 * 'pasc' interpreted as 4 ASCII bytes.
 */
const TELEGRAM_BOT_LOCK_KEY = 0x70617363;

/** Dedicated pg.Client holding the advisory lock for this process. */
let lockClient: Client | null = null;

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

  // Prevent unhandled 'error' events from crashing the process.
  // Idle connections can emit ECONNRESET when Railway's PG proxy drops them.
  pool.on("error", (err) => {
    logger.warn(
      { err: err.message, code: (err as NodeJS.ErrnoException).code },
      "PG pool background error (non-fatal)"
    );
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

/**
 * Acquire a Postgres advisory lock that gates Telegram bot polling.
 *
 * The lock is **session-scoped**: it lives on a dedicated long-running
 * pg.Client (NOT the shared pool — pool connections get returned after
 * each query, which would auto-release the lock). The lock is released
 * automatically when the client's TCP connection closes — covers both
 * graceful shutdown and hard crashes.
 *
 * Polls every 2s up to `timeoutMs` (default 60s). Returns true on
 * success, false on timeout. On timeout the client connection is
 * closed cleanly.
 *
 * Used by the Telegram adapter to enforce single-active-poller across
 * containers during Railway's zero-downtime deploy overlap.
 */
export async function acquireBotLock(
  opts: { timeoutMs?: number } = {}
): Promise<boolean> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  const connectionString =
    process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL env var");

  const client = new Client({
    connectionString,
    application_name: "tonder-pascal-bot-lock",
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  // Swallow background errors on the lock client (e.g. PG proxy drops)
  // so they don't crash the process. The next query will surface a
  // failure that the caller handles.
  client.on("error", (err) => {
    logger.warn(
      { err: err.message, code: (err as NodeJS.ErrnoException).code },
      "Bot-lock pg client background error (non-fatal)"
    );
  });

  await client.connect();

  while (Date.now() < deadline) {
    try {
      const r = await client.query<{ got: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS got",
        [TELEGRAM_BOT_LOCK_KEY]
      );
      if (r.rows[0].got) {
        lockClient = client; // keep alive — lock dies with the session
        logger.info("Telegram bot singleton lock acquired");
        return true;
      }
    } catch (err) {
      logger.warn({ err }, "pg_try_advisory_lock query failed — retrying");
    }
    logger.info("Waiting for Telegram bot singleton lock...");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  try {
    await client.end();
  } catch {
    // already closed
  }
  return false;
}

/**
 * Release the Telegram bot singleton lock and close the dedicated
 * lock client. Safe to call multiple times.
 *
 * Called from the Telegram adapter's stop() so the next container can
 * acquire the lock immediately rather than waiting for TCP keepalive
 * timeout.
 */
export async function releaseBotLock(): Promise<void> {
  if (!lockClient) return;
  try {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [
      TELEGRAM_BOT_LOCK_KEY,
    ]);
    await lockClient.end();
  } catch (err) {
    logger.warn(
      { err },
      "Error releasing bot lock (connection may already be closed)"
    );
  }
  lockClient = null;
  logger.info("Telegram bot singleton lock released");
}
