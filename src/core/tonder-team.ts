/**
 * Tonder team member identification.
 * Maps Slack + Telegram user IDs to team member info.
 * Used by ambient mode to distinguish Tonder staff from merchants.
 */

interface TeamMember {
  name: string;
  role: string;
}

// Slack user IDs → team member
const SLACK_TEAM: Record<string, TeamMember> = {
  "U091BLCSUMC": { name: "Roberto", role: "FinOps" },
  // Add more Slack user IDs here as needed
};

// Telegram user IDs → team member
const TELEGRAM_TEAM: Record<string, TeamMember> = {
  // Add Telegram user IDs here as needed
};

const COMBINED = { ...SLACK_TEAM, ...TELEGRAM_TEAM };

export function isTonderTeamMember(userId: string): boolean {
  return userId in COMBINED;
}

export function getTeamMemberName(userId: string): string | null {
  return COMBINED[userId]?.name ?? null;
}

export function getTeamMemberRole(userId: string): string | null {
  return COMBINED[userId]?.role ?? null;
}
