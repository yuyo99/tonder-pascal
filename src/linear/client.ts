import { LinearClient } from "@linear/sdk";
import { config } from "../config";
import { MerchantContext } from "../merchants/types";
import { logger } from "../utils/logger";

let linear: LinearClient | null = null;

// Cached IDs (resolved once, reused)
let cachedTeamId: string | null = null;
let cachedTriageStateId: string | null = null;
let cachedAssigneeId: string | null = null;
const resolvedUserIds = new Map<string, string>(); // email → Linear user ID

function getLinearClient(): LinearClient {
  if (!linear) {
    if (!config.linear.apiKey) {
      throw new Error("LINEAR_API_KEY not configured");
    }
    linear = new LinearClient({ apiKey: config.linear.apiKey });
  }
  return linear;
}

export type CommandType = "ticket" | "bug" | "feature" | "escalate";

const COMMAND_CONFIG: Record<CommandType, { priority: number; prefix: string }> = {
  ticket:   { priority: 3, prefix: "" },
  bug:      { priority: 2, prefix: "[Bug] " },
  feature:  { priority: 4, prefix: "[Feature] " },
  escalate: { priority: 1, prefix: "[Escalation] " },
};

export interface TicketParams {
  title: string;
  description: string;
  commandType: CommandType;
  merchantCtx: MerchantContext;
  createdBy?: string;
}

export interface TicketResult {
  id: string;
  identifier: string;
  url: string;
}

async function resolveTeamAndState(): Promise<void> {
  if (cachedTeamId && cachedTriageStateId) return;

  const client = getLinearClient();

  // Linear SDK v25 client.teams() includes 'membership' field requiring userId
  // Use raw GraphQL with only the fields we need
  const teamsResult = await client.client.rawRequest(
    `query { teams { nodes { id key name } } }`
  );
  const teamNodes = (teamsResult as any).data.teams.nodes as Array<{
    id: string;
    key: string;
    name: string;
  }>;
  const sosTeam = teamNodes.find(
    (t) => t.key === "SOS" || t.name.toLowerCase().includes("support")
  );
  if (!sosTeam) {
    throw new Error("Support team (SOS) not found in Linear");
  }
  cachedTeamId = sosTeam.id;

  // Get workflow states for the team
  const statesResult = await client.client.rawRequest(
    `query($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }`,
    { teamId: cachedTeamId }
  );
  const stateNodes = (statesResult as any).data.team.states.nodes as Array<{
    id: string;
    name: string;
  }>;
  const triageState = stateNodes.find((s) => s.name === "Triage");
  cachedTriageStateId = triageState?.id || null;

  // Resolve default assignee
  if (config.linear.defaultAssignee) {
    const usersResult = await client.client.rawRequest(
      `query { users { nodes { id email } } }`
    );
    const userNodes = (usersResult as any).data.users.nodes as Array<{
      id: string;
      email: string;
    }>;
    const assignee = userNodes.find(
      (u) => u.email === config.linear.defaultAssignee
    );
    cachedAssigneeId = assignee?.id || null;
  }

  logger.info(
    { teamId: cachedTeamId, triageStateId: cachedTriageStateId, assigneeId: cachedAssigneeId },
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
    `**Created by:** ${params.createdBy || "Operator (via Pascal)"}`,
    "",
    "---",
    "",
    params.description,
  ].join("\n");

  const issuePayload = await client.createIssue({
    teamId: cachedTeamId!,
    title: `[${params.merchantCtx.businessName}] ${COMMAND_CONFIG[params.commandType].prefix}${params.title}`,
    description: fullDescription,
    priority: COMMAND_CONFIG[params.commandType].priority,
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

/* ─── Team-routed ticket (for ambient mode ticket creation) ─── */

// Known team IDs
const TEAM_IDS: Record<string, string> = {
  sos: "", // resolved dynamically via resolveTeamAndState
  finops: "f3175c22-9085-4d04-b0d0-f95e2e678cdd",
  int: "d2479bda-f447-4389-9ea2-5ed1038aec5f",
};

// Cache triage state IDs per team
const cachedTeamTriageStates = new Map<string, string>();

async function resolveTeamTriageState(teamId: string): Promise<string | undefined> {
  const cached = cachedTeamTriageStates.get(teamId);
  if (cached) return cached;

  const client = getLinearClient();
  const statesResult = await client.client.rawRequest(
    `query($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }`,
    { teamId },
  );
  const stateNodes = (statesResult as any).data.team.states.nodes as Array<{
    id: string;
    name: string;
  }>;
  const triage = stateNodes.find((s) => s.name === "Triage");
  if (triage) cachedTeamTriageStates.set(teamId, triage.id);
  return triage?.id;
}

export async function createTeamTicket(params: {
  team: "sos" | "finops" | "int";
  title: string;
  description: string;
  priority?: number;
  merchantCtx?: MerchantContext;
}): Promise<TicketResult> {
  const client = getLinearClient();

  let teamId: string;
  if (params.team === "sos") {
    // SOS team is resolved dynamically
    await resolveTeamAndState();
    teamId = cachedTeamId!;
  } else {
    teamId = TEAM_IDS[params.team];
  }

  const stateId = await resolveTeamTriageState(teamId);

  const fullDescription = params.merchantCtx
    ? [
        `**Merchant:** ${params.merchantCtx.businessName} (ID: ${params.merchantCtx.businessId})`,
        `**Platform:** ${params.merchantCtx.platform}`,
        `**Channel:** ${params.merchantCtx.channelId}`,
        `**Created by:** Pascal (ambient detection)`,
        "",
        "---",
        "",
        params.description,
      ].join("\n")
    : params.description;

  const issuePayload = await client.createIssue({
    teamId,
    title: params.title,
    description: fullDescription,
    priority: params.priority ?? 3,
    stateId: stateId || undefined,
  });

  const issue = await issuePayload.issue;
  if (!issue) {
    throw new Error(`Failed to create ${params.team.toUpperCase()} ticket`);
  }

  logger.info(
    { identifier: issue.identifier, team: params.team, title: params.title },
    "Linear team ticket created (ambient)"
  );

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
  };
}

/* ─── Lightweight triage ticket (no MerchantContext required) ─── */

async function resolveUserByEmail(email: string): Promise<string | null> {
  const cached = resolvedUserIds.get(email);
  if (cached) return cached;

  const client = getLinearClient();
  const result = await client.client.rawRequest(
    `query { users { nodes { id email } } }`
  );
  const users = (result as any).data.users.nodes as Array<{ id: string; email: string }>;
  // Cache all users while we're at it
  for (const u of users) resolvedUserIds.set(u.email, u.id);
  return resolvedUserIds.get(email) || null;
}

export async function createTriageTicket(params: {
  title: string;
  description: string;
  assigneeEmail: string;
}): Promise<TicketResult> {
  await resolveTeamAndState();
  const client = getLinearClient();

  const assigneeId = await resolveUserByEmail(params.assigneeEmail);

  const issuePayload = await client.createIssue({
    teamId: cachedTeamId!,
    title: params.title,
    description: params.description,
    priority: 3, // Normal
    stateId: cachedTriageStateId || undefined,
    assigneeId: assigneeId || undefined,
  });

  const issue = await issuePayload.issue;
  if (!issue) {
    throw new Error("Failed to create Linear triage ticket");
  }

  logger.info(
    { identifier: issue.identifier, assignee: params.assigneeEmail },
    "Linear triage ticket created via emoji reaction"
  );

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
  };
}
