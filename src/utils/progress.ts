import { logger } from "./logger";

/**
 * ProgressUpdater — schedules timed UI edits while the agent loop is
 * running, so users don't stare at a frozen "thinking..." placeholder
 * for 60-120s.
 *
 * Contract:
 *   1. Construct with a single `onEdit(text)` callback that performs
 *      the channel-specific edit (Slack `chat.update`, Telegram
 *      `editMessageText`, etc).
 *   2. Schedule N edits with `schedule(delayMs, text)`. The first edit
 *      to fire wins for that scheduled slot.
 *   3. Call `cancel()` when the final response is ready. Any edits
 *      that haven't fired yet are dropped. If an edit DID fire and
 *      the final response also arrives, the caller's final update
 *      naturally wins (last write).
 *
 * Errors inside an `onEdit` invocation are logged but never thrown —
 * a failed progress edit must not abort the in-flight agent loop.
 *
 * Implemented for AID-84 (Slack/Telegram async handoff). See
 * /Users/yuyo/Downloads/PASCAL_INTELLIGENCE_UPGRADE.md for the full
 * spec.
 */
export class ProgressUpdater {
  private timers: NodeJS.Timeout[] = [];
  private cancelled = false;
  private editsSent = 0;
  private firstEditAt: number | null = null;

  constructor(private readonly onEdit: (text: string) => Promise<void>) {}

  /**
   * Schedule a progress edit to fire after `delayMs` from now (NOT
   * from the start of the call — each invocation is independent).
   * Multiple calls stack — schedule(15_000), schedule(45_000),
   * schedule(90_000) produces three edits at the expected wall-clock
   * times.
   */
  schedule(delayMs: number, text: string): void {
    if (this.cancelled) return;
    const timer = setTimeout(async () => {
      if (this.cancelled) return;
      try {
        await this.onEdit(text);
        this.editsSent += 1;
        if (this.firstEditAt === null) this.firstEditAt = Date.now();
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), text },
          "Progress edit failed (non-fatal)"
        );
      }
    }, delayMs);
    this.timers.push(timer);
  }

  /**
   * Cancel all pending edits. Idempotent. Call this in the same
   * `try`-block path as the final response so a successful early
   * completion doesn't trigger a confusing "still working" edit
   * AFTER the answer has been delivered.
   */
  cancel(): void {
    this.cancelled = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Telemetry: how many progress edits fired before the final answer. */
  getEditsSent(): number {
    return this.editsSent;
  }

  /** Telemetry: wall-clock timestamp of the first progress edit, or null. */
  getFirstEditAt(): number | null {
    return this.firstEditAt;
  }
}
