import { LinearClient } from "@linear/sdk";
import { config } from "../config";
import { MerchantContext } from "../merchants/types";
import { logger } from "../utils/logger";

let linear: LinearClient | null = null;

// Cached IDs (resolved once, reused)
let cachedTeamId: string | null = null;
let cachedTriageStateId: string | null = null;
let cachedAssigneeId: string | null = null;

function getLinearClient(): LinearClient {
  if (!linear) {
    if (!config.linear.apiKey) {
      throw new Error("LINEAR_API_KEY not configured");
    }
    linear = new LinearClient({ apiKey: config.linear.apiKey });
  }
  return linear;
}

const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export interface TicketParams {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  merchantCtx: MerchantContext;
}

export interface TicketResult {
  id: string;
  identifier: string;
  url: string;
}

async function resolveTeamAndState(): Promise<void> {
  if (cachedTeamId && cachedTriageStateId) return;

  const client = getLinearClient();

  // Find SOS team
  const teams = await client.teams();
  const sosTeam = teams.nodes.find(
    (t) => t.key === "SOS" || t.name.toLowerCase().includes("support")
  );
  if (!sosTeam) {
    throw new Error("Support team (SOS) not found in Linear");
  }
  cachedTeamId = sosTeam.id;

  // Find Triage state
  const states = await sosTeam.states();
  const triageState = states.nodes.find((s) => s.name === "Triage");
  cachedTriageStateId = triageState?.id || null;

  // Find default assignee
  if (config.linear.defaultAssignee) {
    const users = await client.users();
    const assignee = users.nodes.find(
      (u) => u.email === config.linear.defaultAssignee
    );
    cachedAssigneeId = assignee?.id || null;
  }

  logger.info(
    { teamId: cachedTeamId, triageStateId: cachedTriageStateId },
    "Linear team/state resolved"
  );
}

export async function createSupportTicket(
  params: TicketParams
): Promise<TicketResult> {
  await resolveTeamAndState();
  const client = getLinearClient();

  const fullDescription = [
    `**Merchant:** ${params.merchantCtx.businessName} (ID: ${params.merchantCtx.businessId})`,
    `**Platform:** ${params.merchantCtx.platform}`,
    `**Channel:** ${params.merchantCtx.channelId}`,
    `**Created by:** Pascal (AI Assistant)`,
    "",
    "---",
    "",
    params.description,
  ].join("\n");

  const issuePayload = await client.createIssue({
    teamId: cachedTeamId!,
    title: `[${params.merchantCtx.businessName}] ${params.title}`,
    description: fullDescription,
    priority: PRIORITY_MAP[params.priority] || 3,
    stateId: cachedTriageStateId || undefined,
    assigneeId: cachedAssigneeId || undefined,
  });

  const issue = await issuePayload.issue;
  if (!issue) {
    throw new Error("Failed to create Linear issue");
  }

  logger.info(
    { identifier: issue.identifier, merchant: params.merchantCtx.businessName },
    "Linear support ticket created"
  );

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
  };
}
