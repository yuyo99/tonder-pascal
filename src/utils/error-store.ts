import { pgQuery } from "../postgres/connection";
import { logger } from "./logger";

type ErrorSource =
  | "orchestrator"
  | "tool"
  | "slack"
  | "telegram"
  | "scheduler"
  | "feedback"
  | "config"
  | "system";

type ErrorSeverity = "error" | "fatal";

interface ErrorContext {
  merchant?: string;
  channel?: string;
  platform?: string;
  tool?: string;
  user?: string;
  action?: string;
  [key: string]: unknown;
}

/**
 * Persist an error to pascal_error_logs.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function storeError(
  source: ErrorSource,
  message: string,
  context: ErrorContext = {},
  severity: ErrorSeverity = "error",
  stack?: string
): void {
  pgQuery(
    `INSERT INTO pascal_error_logs (source, severity, message, stack, context)
     VALUES ($1, $2, $3, $4, $5)`,
    [source, severity, message, stack || null, JSON.stringify(context)]
  ).catch((err) => {
    // Last resort: log to stdout only. Never recurse.
    logger.warn({ err, source, message }, "Failed to persist error log");
  });
}

/**
 * Convenience: extract message + stack from an unknown error value,
 * then call storeError.
 */
export function storeErrorFromCatch(
  source: ErrorSource,
  err: unknown,
  context: ErrorContext = {},
  severity: ErrorSeverity = "error"
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  storeError(source, message, context, severity, stack);
}
