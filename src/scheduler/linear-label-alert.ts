import { LinearClient } from "@linear/sdk";
import { WebClient } from "@slack/web-api";
import { KnownBlock } from "@slack/types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { getCollection } from "../mongodb/connection";

// ── Constants ────────────────────────────────────────────────────────

const ALERT_CHANNEL = "C0743M91PCG";
const ROBERTO_USER_ID = "U091BLCSUMC";
const INT_TEAM_ID = "d2479bda-f447-4389-9ea2-5ed1038aec5f";
const FINOPS_TEAM_ID = "f3175c22-9085-4d04-b0d0-f95e2e678cdd";
const LABEL_NAME = "INT - Account Creation PROD";
const FINANCE_CONSOLE_URL =
  "https://main.d1sqsry80rike8.amplifyapp.com/sign-in?redirect_url=https%3A%2F%2Fmain.d1sqsry80rike8.amplifyapp.com%2Ffinances%2Faccounts%3Fentity_type%3DBUSINESS";

const DEDUP_COLLECTION = "pascal-alerted-issues";

// ── Dedup via MongoDB ───────────────────────────────────────────────

async function getAlertedIds(): Promise<Set<string>> {
  const col = getCollection(DEDUP_COLLECTION);
  const docs = await col.find({}, { projection: { issueId: 1, _id: 0 } }).toArray();
  return new Set(docs.map((d) => d.issueId as string));
}

async function markAlerted(issueIds: string[]): Promise<void> {
  if (issueIds.length === 0) return;
  const col = getCollection(DEDUP_COLLECTION);
  await col.insertMany(
    issueIds.map((id) => ({ issueId: id, alertedAt: new Date() })),
    { ordered: false },
  );
}

// ── Cached FinOps IDs (resolved once) ────────────────────────────────

let cachedFinOpsTriageStateId: string | null = null;
let cachedRobertoUserId: string | null = null;

// ── GraphQL ──────────────────────────────────────────────────────────

const LABEL_ISSUES_QUERY = `
  query($filter: IssueFilter!) {
    issues(filter: $filter, first: 50) {
      nodes {
        id
        identifier
        title
        url
        assignee { name }
        project { name }
      }
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────

interface LabelIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  assigneeName: string | null;
  projectName: string | null;
}

// ── Data Fetcher ─────────────────────────────────────────────────────

async function fetchAccountCreationIssues(): Promise<LabelIssue[]> {
  if (!config.linear.apiKey) {
    logger.warn("LINEAR_API_KEY not set — skipping account creation alert");
    return [];
  }

  const client = new LinearClient({ apiKey: config.linear.apiKey });

  const result = await client.client.rawRequest(LABEL_ISSUES_QUERY, {
    filter: {
      team: { id: { eq: INT_TEAM_ID } },
      labels: { name: { eq: LABEL_NAME } },
      state: { type: { nin: ["completed", "canceled"] } },
    },
  });

  const nodes = (result as any).data.issues.nodes as any[];

  return nodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    url: n.url,
    assigneeName: n.assignee?.name || null,
    projectName: n.project?.name || null,
  }));
}

// ── FinOps Ticket Creation ─────────────────────────────────────────

async function resolveFinOpsIds(client: LinearClient): Promise<void> {
  if (cachedFinOpsTriageStateId && cachedRobertoUserId) return;

  if (!cachedFinOpsTriageStateId) {
    const statesResult = await client.client.rawRequest(
      `query($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }`,
      { teamId: FINOPS_TEAM_ID },
    );
    const stateNodes = (statesResult as any).data.team.states.nodes as Array<{
      id: string;
      name: string;
    }>;
    const triage = stateNodes.find((s) => s.name === "Triage");
    cachedFinOpsTriageStateId = triage?.id || null;
  }

  if (!cachedRobertoUserId) {
    const usersResult = await client.client.rawRequest(
      `query { users { nodes { id name } } }`,
    );
    const userNodes = (usersResult as any).data.users.nodes as Array<{
      id: string;
      name: string;
    }>;
    const roberto = userNodes.find((u) =>
      u.name.toLowerCase().includes("roberto"),
    );
    cachedRobertoUserId = roberto?.id || null;
  }
}

async function createFinOpsTicket(
  issue: LabelIssue,
): Promise<{ identifier: string; url: string }> {
  const client = new LinearClient({ apiKey: config.linear.apiKey! });
  await resolveFinOpsIds(client);

  const description = [
    `## Account Configuration for ${issue.identifier}`,
    "",
    `**Source ticket:** [${issue.identifier}](${issue.url})`,
    `**Project:** ${issue.projectName || "N/A"}`,
    "",
    "### Accounts",
    "- [ ] Business Payable",
    "- [ ] Business Settlement Pending",
    "- [ ] Reserve Payable",
    "- [ ] Payouts (if applicable)",
    "",
    "### Fees",
    "- [ ] IN fees per method (merchants SLA)",
    "- [ ] OUT fees per method (merchants SLA)",
    "",
    "---",
    `Configure in [Finance Console](${FINANCE_CONSOLE_URL})`,
  ].join("\n");

  const issuePayload = await client.createIssue({
    teamId: FINOPS_TEAM_ID,
    title: `[Account Config] ${issue.identifier} — ${issue.title}`,
    description,
    priority: 2,
    stateId: cachedFinOpsTriageStateId || undefined,
    assigneeId: cachedRobertoUserId || undefined,
  });

  const created = await issuePayload.issue;
  if (!created) throw new Error("Failed to create FinOps ticket");

  logger.info(
    { finOpsTicket: created.identifier, sourceIssue: issue.identifier },
    "FinOps ticket created",
  );

  return { identifier: created.identifier, url: created.url };
}

// ── Single batched Slack message ─────────────────────────────────────

function buildBatchBlocks(issues: LabelIssue[]): KnownBlock[] {
  const issueLines = issues
    .map((i) => `• <${i.url}|${i.identifier}> — ${i.title}`)
    .join("\n");

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `:bank: Account Creation PROD (${issues.length} new)`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<@${ROBERTO_USER_ID}> Configure accounts & fees in *<${FINANCE_CONSOLE_URL}|Finance Console>*:`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: issueLines },
    },
  ];
}

// ── Public: Send Alert ───────────────────────────────────────────────

export async function sendAccountCreationAlert(slackClient: WebClient): Promise<void> {
  const issues = await fetchAccountCreationIssues();
  const alreadyAlerted = await getAlertedIds();

  const newIssues = issues.filter((i) => !alreadyAlerted.has(i.id));

  if (newIssues.length === 0) {
    logger.debug("No new Account Creation PROD issues");
    return;
  }

  // One Slack message for all new issues
  const blocks = buildBatchBlocks(newIssues);
  const msg = await slackClient.chat.postMessage({
    channel: ALERT_CHANNEL,
    blocks,
    text: `Account Creation PROD: ${newIssues.length} new issue(s)`,
  });

  // Create FinOps tickets and list them in thread
  if (msg.ts) {
    const ticketLines: string[] = [];
    for (const issue of newIssues) {
      try {
        const ticket = await createFinOpsTicket(issue);
        ticketLines.push(`• <${ticket.url}|${ticket.identifier}> → ${issue.identifier}`);
      } catch (err) {
        logger.error({ err, issue: issue.identifier }, "Failed to create FinOps ticket");
        ticketLines.push(`• ${issue.identifier} — _FinOps ticket failed_`);
      }
    }
    await slackClient.chat.postMessage({
      channel: ALERT_CHANNEL,
      thread_ts: msg.ts,
      text: `:clipboard: FinOps tickets:\n${ticketLines.join("\n")}`,
    });
  }

  // Persist dedup to MongoDB
  await markAlerted(newIssues.map((i) => i.id));

  logger.info(
    { count: newIssues.length, channel: ALERT_CHANNEL },
    "Account Creation PROD alert sent",
  );
}
