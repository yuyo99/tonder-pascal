import { LinearClient } from "@linear/sdk";
import { WebClient } from "@slack/web-api";
import { KnownBlock } from "@slack/types";
import { config } from "../config";
import { logger } from "../utils/logger";

// ── Constants ────────────────────────────────────────────────────────

const ALERT_CHANNEL = "C0743M91PCG";
const ROBERTO_USER_ID = "U091BLCSUMC";
const INT_TEAM_ID = "d2479bda-f447-4389-9ea2-5ed1038aec5f";
const LABEL_NAME = "Account Creation PROD";
const FINANCE_CONSOLE_URL =
  "https://main.d1sqsry80rike8.amplifyapp.com/sign-in?redirect_url=https%3A%2F%2Fmain.d1sqsry80rike8.amplifyapp.com%2Ffinances%2Faccounts%3Fentity_type%3DBUSINESS";

// ── Dedup Tracker ────────────────────────────────────────────────────

const alertedIssueIds = new Set<string>();

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

    // Reply in thread
    if (msg.ts) {
      await slackClient.chat.postMessage({
        channel: ALERT_CHANNEL,
        thread_ts: msg.ts,
        text: ":white_check_mark: Alert sent. Please confirm in this thread once accounts and fees are configured.",
      });
    }

    alertedIssueIds.add(issue.id);

    logger.info(
      { issue: issue.identifier, channel: ALERT_CHANNEL },
      "Account Creation PROD alert sent"
    );
  }
}
