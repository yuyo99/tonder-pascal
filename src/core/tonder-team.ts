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

// Hardcoded fallback (used before DB is available)
const FALLBACK_SLACK: Record<string, { name: string; role: string }> = {
  "U091BLCSUMC": { name: "Roberto", role: "FinOps" },
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
      logger.info({ count: teamCache.length }, "Tonder team loaded from DB");
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
  if (slackIndex.has(userId) || telegramIndex.has(userId)) return true;
  // Fallback check
  return userId in FALLBACK_SLACK;
}

export async function getTeamMemberName(userId: string): Promise<string | null> {
  await ensureLoaded();
  const member = slackIndex.get(userId) ?? telegramIndex.get(userId);
  if (member) return member.name;
  return FALLBACK_SLACK[userId]?.name ?? null;
}

export async function getTeamMemberRole(userId: string): Promise<string | null> {
  await ensureLoaded();
  const member = slackIndex.get(userId) ?? telegramIndex.get(userId);
  if (member) return member.role;
  return FALLBACK_SLACK[userId]?.role ?? null;
}

/** Get all team members for prompt injection */
export async function getTeamDirectory(): Promise<TeamMemberInfo[]> {
  await ensureLoaded();
  return teamCache;
}
