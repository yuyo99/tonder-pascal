import { LinearClient } from "@linear/sdk";
import { WebClient } from "@slack/web-api";
import { KnownBlock } from "@slack/types";
import { config } from "../config";
import { logger } from "../utils/logger";

// ── Constants ────────────────────────────────────────────────────────

const ALERT_CHANNEL = "C0743M91PCG";
const ROBERTO_USER_ID = "U091BLCSUMC";
const INT_TEAM_ID = "d2479bda-f447-4389-9ea2-5ed1038aec5f";
const FINOPS_TEAM_ID = "f3175c22-9085-4d04-b0d0-f95e2e678cdd";
const LABEL_NAME = "INT - Account Creation PROD";
const FINANCE_CONSOLE_URL =
  "https://main.d1sqsry80rike8.amplifyapp.com/sign-in?redirect_url=https%3A%2F%2Fmain.d1sqsry80rike8.amplifyapp.com%2Ffinances%2Faccounts%3Fentity_type%3DBUSINESS";

// ── Dedup Tracker ────────────────────────────────────────────────────

const alertedIssueIds = new Set<string>();

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
        dueDate
        assignee { name }
        state { name }
        project { name }
        labels { nodes { name } }
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
  dueDate: string | null;
  assigneeName: string | null;
  stateName: string;
  projectName: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    dueDate: n.dueDate || null,
    assigneeName: n.assignee?.name || null,
    stateName: n.state.name,
    projectName: n.project?.name || null,
  }));
}

// ── FinOps Ticket Creation ─────────────────────────────────────────

async function resolveFinOpsIds(client: LinearClient): Promise<void> {
  if (cachedFinOpsTriageStateId && cachedRobertoUserId) return;

  // Resolve FinOps Triage state
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
    logger.debug({ triageStateId: cachedFinOpsTriageStateId }, "FinOps Triage state resolved");
  }

  // Resolve Roberto's Linear user ID
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
    logger.debug({ robertoUserId: cachedRobertoUserId }, "Roberto user ID resolved");
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
    priority: 2, // High
    stateId: cachedFinOpsTriageStateId || undefined,
    assigneeId: cachedRobertoUserId || undefined,
  });

  const created = await issuePayload.issue;
  if (!created) {
    throw new Error("Failed to create FinOps ticket in Linear");
  }

  logger.info(
    { finOpsTicket: created.identifier, sourceIssue: issue.identifier },
    "FinOps account configuration ticket created",
  );

  return { identifier: created.identifier, url: created.url };
}

// ── Block Kit Builder ────────────────────────────────────────────────

function buildAlertBlocks(issue: LabelIssue): KnownBlock[] {
  const contextParts: string[] = [];
  if (issue.projectName) contextParts.push(`:file_folder: ${issue.projectName}`);
  contextParts.push(`:bust_in_silhouette: ${issue.assigneeName || "Unassigned"}`);
  if (issue.dueDate) {
    contextParts.push(`:calendar: ${formatDueDate(issue.dueDate)}`);
  } else {
    contextParts.push(`:spiral_calendar_pad: No deadline`);
  }

  return [
    {
      type: "header",
      text: { type: "plain_text", text: ":bank: Account Creation PROD", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `<@${ROBERTO_USER_ID}> Please configure accounts and fees for the merchant below in *<${FINANCE_CONSOLE_URL}|Finance Console>*.`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:link: <${issue.url}|${issue.identifier}> · ${issue.title}`,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: contextParts.join("  ·  ") }],
    },
  ];
}

// ── Public: Send Alert ───────────────────────────────────────────────

export async function sendAccountCreationAlert(slackClient: WebClient): Promise<void> {
  const issues = await fetchAccountCreationIssues();

  const newIssues = issues.filter((i) => !alertedIssueIds.has(i.id));

  if (newIssues.length === 0) {
    logger.debug("No new Account Creation PROD issues — skipping alert");
    return;
  }

  for (const issue of newIssues) {
    const blocks = buildAlertBlocks(issue);

    const msg = await slackClient.chat.postMessage({
      channel: ALERT_CHANNEL,
      blocks,
      text: `Account Creation PROD: ${issue.identifier} — ${issue.title}`,
    });

    // Reply in thread: confirmation
    if (msg.ts) {
      await slackClient.chat.postMessage({
        channel: ALERT_CHANNEL,
        thread_ts: msg.ts,
        text: ":white_check_mark: Alert sent. Please confirm in this thread once accounts and fees are configured.",
      });

      // Create FinOps ticket and post link in thread
      try {
        const finOpsTicket = await createFinOpsTicket(issue);
        await slackClient.chat.postMessage({
          channel: ALERT_CHANNEL,
          thread_ts: msg.ts,
          text: `:clipboard: FinOps ticket created: <${finOpsTicket.url}|${finOpsTicket.identifier}>`,
        });
      } catch (err) {
        logger.error(
          { err, issue: issue.identifier },
          "Failed to create FinOps ticket — Slack alert still sent",
        );
      }
    }

    alertedIssueIds.add(issue.id);

    logger.info(
      { issue: issue.identifier, channel: ALERT_CHANNEL },
      "Account Creation PROD alert sent",
    );
  }
}
