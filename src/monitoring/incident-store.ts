/**
 * Incident store — deduplicated incident tracking in PostgreSQL.
 * Each unique fingerprint maps to one open incident; occurrences increment.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";
import type { Incident } from "./types";

/**
 * Record an incident. If an open incident with the same fingerprint exists,
 * bump occurrences and update last_seen_at. Otherwise create a new one.
 * Returns { isNew, occurrences } so the caller can decide whether to alert.
 */
export async function recordIncident(
  incident: Incident,
): Promise<{ isNew: boolean; occurrences: number }> {
  try {
    // Try to update existing open incident
    const update = await pgQuery(
      `UPDATE pascal_incidents
       SET occurrences = occurrences + 1,
           last_seen_at = now(),
           updated_at = now(),
           severity = $1,
           latest_details = $2
       WHERE fingerprint = $3 AND status = 'open'
       RETURNING occurrences`,
      [incident.severity, JSON.stringify(incident.details), incident.fingerprint],
    );

    if (update.rows.length > 0) {
      return { isNew: false, occurrences: update.rows[0].occurrences };
    }

    // No open incident — create new
    const insert = await pgQuery(
      `INSERT INTO pascal_incidents
         (status, severity, fingerprint, merchant_name, channel_id,
          first_seen_at, last_seen_at, occurrences, latest_details)
       VALUES ('open', $1, $2, $3, $4, now(), now(), 1, $5)
       ON CONFLICT (fingerprint) DO UPDATE SET
         occurrences = pascal_incidents.occurrences + 1,
         last_seen_at = now(),
         updated_at = now(),
         status = 'open',
         severity = $1,
         latest_details = $5
       RETURNING occurrences`,
      [
        incident.severity,
        incident.fingerprint,
        incident.merchantName,
        incident.channelId,
        JSON.stringify(incident.details),
      ],
    );

    const occurrences = insert.rows[0]?.occurrences ?? 1;
    return { isNew: occurrences === 1, occurrences };
  } catch (err) {
    logger.error({ err, fingerprint: incident.fingerprint }, "Failed to record incident");
    return { isNew: true, occurrences: 1 };
  }
}

/**
 * Resolve an incident (mark as resolved).
 */
export async function resolveIncident(fingerprint: string): Promise<void> {
  try {
    await pgQuery(
      `UPDATE pascal_incidents SET status = 'resolved', updated_at = now() WHERE fingerprint = $1 AND status = 'open'`,
      [fingerprint],
    );
  } catch (err) {
    logger.error({ err, fingerprint }, "Failed to resolve incident");
  }
}

/**
 * Count recent occurrences of a fingerprint pattern within a time window.
 */
export async function countRecentOccurrences(
  fingerprint: string,
  windowMinutes: number,
): Promise<number> {
  try {
    const result = await pgQuery(
      `SELECT occurrences FROM pascal_incidents
       WHERE fingerprint = $1 AND status = 'open'
         AND last_seen_at > now() - make_interval(mins => $2)`,
      [fingerprint, windowMinutes],
    );
    return result.rows[0]?.occurrences ?? 0;
  } catch {
    return 0;
  }
}
