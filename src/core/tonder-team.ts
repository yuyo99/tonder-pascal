/**
 * Tonder team member identification.
 * Loads from pascal_people DB table with 10-minute cache.
 * Falls back to hardcoded entries if DB is unavailable.
 * Used by ambient mode to distinguish Tonder staff from merchants.
 */

import { pgQuery } from "../postgres/connection";
import { logger } from "../utils/logger";

export interface TeamMemberInfo {
  id: string;
  name: string;
  role: string;
  domain: string;
  topics: string[];
  escalation_notes: string;
  email: string;
  slack_user_id: string | null;
  telegram_user_id: string | null;
}

// ── Cache ──

let teamCache: TeamMemberInfo[] = [];
let slackIndex = new Map<string, TeamMemberInfo>();
let telegramIndex = new Map<string, TeamMemberInfo>();
let lastLoaded = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Hardcoded fallbacks (used before DB is available or if DB query fails)
const FALLBACK_SLACK: Record<string, { name: string; role: string }> = {
  "U091BLCSUMC": { name: "Roberto", role: "FinOps" },
  "U058YPQ0EBU": { name: "Geraldine Sprockel", role: "Acquirer MID" },
  "U0A6RK3GR3P": { name: "Sandy Sosa", role: "Integrations Lead" },
};

const FALLBACK_TELEGRAM: Record<string, { name: string; role: string }> = {
  "8525646695": { name: "Sandy Sosa", role: "Integrations Lead" },
  "7104916069": { name: "Geraldine Sprockel", role: "Acquirer MID" },
};

async function loadTeam(): Promise<void> {
  try {
    const result = await pgQuery(
      `SELECT id, name, role, domain, topics, escalation_notes, email,
              slack_user_id, telegram_user_id
       FROM pascal_people
       WHERE type = 'tonder_team' AND is_active = true
       ORDER BY name ASC`
    );
    teamCache = result.rows;
    lastLoaded = Date.now();

    // Rebuild indexes
    slackIndex = new Map();
    telegramIndex = new Map();
    for (const m of teamCache) {
      if (m.slack_user_id) slackIndex.set(m.slack_user_id, m);
      if (m.telegram_user_id) telegramIndex.set(m.telegram_user_id, m);
    }

    if (teamCache.length > 0) {
      logger.info(
        { count: teamCache.length, slackIds: Array.from(slackIndex.keys()), telegramIds: Array.from(telegramIndex.keys()) },
        "Tonder team loaded from DB"
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load team from DB — using fallback");
  }
}

async function ensureLoaded(): Promise<void> {
  if (Date.now() - lastLoaded > CACHE_TTL) {
    await loadTeam();
  }
}

// ── Public API ──

export async function isTonderTeamMember(userId: string): Promise<boolean> {
  await ensureLoaded();
  const inDb = slackIndex.has(userId) || telegramIndex.has(userId);
  const inFallback = userId in FALLBACK_SLACK || userId in FALLBACK_TELEGRAM;
  const result = inDb || inFallback;
  if (result) {
    logger.debug({ userId, inDb, inFallback, telegramIndexSize: telegramIndex.size, slackIndexSize: slackIndex.size }, "Tonder team member detected");
  }
  return result;
}

export async function getTeamMemberName(userId: string): Promise<string | null> {
  await ensureLoaded();
  const member = slackIndex.get(userId) ?? telegramIndex.get(userId);
  if (member) return member.name;
  return FALLBACK_SLACK[userId]?.name ?? FALLBACK_TELEGRAM[userId]?.name ?? null;
}

export async function getTeamMemberRole(userId: string): Promise<string | null> {
  await ensureLoaded();
  const member = slackIndex.get(userId) ?? telegramIndex.get(userId);
  if (member) return member.role;
  return FALLBACK_SLACK[userId]?.role ?? FALLBACK_TELEGRAM[userId]?.role ?? null;
}

/** Get all team members for prompt injection */
export async function getTeamDirectory(): Promise<TeamMemberInfo[]> {
  await ensureLoaded();
  return teamCache;
}
