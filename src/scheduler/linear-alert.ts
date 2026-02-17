import { LinearClient } from "@linear/sdk";
import { WebClient } from "@slack/web-api";
import { KnownBlock } from "@slack/types";
import { config } from "../config";
import { logger } from "../utils/logger";

// ── Constants ────────────────────────────────────────────────────────

const LINEAR_ALERT_CHANNEL = "C0743M91PCG";

const TEAM_IDS = {
  support: "b3b91e8f-cf68-4632-b6da-c49a2bc97b8a",
  integrations: "d2479bda-f447-4389-9ea2-5ed1038aec5f",
};

const TEAM_DISPLAY: Record<string, { icon: string; label: string }> = {
  Support: { icon: ":sos:", label: "Support" },
  Integrations: { icon: ":link:", label: "Integrations" },
};

const PRIORITY_DISPLAY: Record<number, { icon: string; label: string }> = {
  1: { icon: ":red_circle:", label: "Urgent" },
  2: { icon: ":large_orange_circle:", label: "High" },
};

// ── Types ────────────────────────────────────────────────────────────

interface LinearIssue {
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  dueDate: string; // "YYYY-MM-DD"
  stateName: string;
  assigneeName: string | null;
  url: string;
  labels: string[];
  teamName: string;
  overdueDays: number; // 0 = due today, >0 = overdue
}

// ── GraphQL ──────────────────────────────────────────────────────────

const ISSUES_QUERY = `
  query($filter: IssueFilter!) {
    issues(filter: $filter, first: 100) {
      nodes {
        identifier
        title
        priority
        priorityLabel
        dueDate
        completedAt
        state { name type }
        assignee { name }
        url
        labels { nodes { name } }
        team { name }
      }
    }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────

function getTodayMexicoCity(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Mexico_City",
  }); // "YYYY-MM-DD"
}

function getDisplayDate(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysBetween(dateStr: string, todayStr: string): number {
  const due = new Date(dateStr + "T00:00:00");
  const today = new Date(todayStr + "T00:00:00");
  return Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Data Fetcher ─────────────────────────────────────────────────────

async function fetchOverdueLinearIssues(): Promise<LinearIssue[]> {
  if (!config.linear.apiKey) {
    logger.warn("LINEAR_API_KEY not set — skipping Linear overdue alert");
    return [];
  }

  const client = new LinearClient({ apiKey: config.linear.apiKey });
  const today = getTodayMexicoCity();

  const result = await client.client.rawRequest(ISSUES_QUERY, {
    filter: {
      team: {
        id: { in: [TEAM_IDS.support, TEAM_IDS.integrations] },
      },
      priority: { in: [1, 2] },
      dueDate: { lte: today },
      state: {
        type: { nin: ["completed", "canceled"] },
      },
    },
  });

  const nodes = (result as any).data.issues.nodes as any[];

  return nodes.map((n) => ({
    identifier: n.identifier,
    title: n.title,
    priority: n.priority,
    priorityLabel: n.priorityLabel,
    dueDate: n.dueDate,
    stateName: n.state.name,
    assigneeName: n.assignee?.name || null,
    url: n.url,
    labels: (n.labels?.nodes || []).map((l: any) => l.name),
    teamName: n.team.name,
    overdueDays: daysBetween(n.dueDate, today),
  }));
}

// ── Block Kit Formatter ──────────────────────────────────────────────

function buildBlocks(issues: LinearIssue[], displayDate: string): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `:rotating_light: Linear Overdue Tickets — ${displayDate}`,
    },
  });

  // Summary
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${issues.length} ticket${issues.length !== 1 ? "s" : ""}* due today or overdue across Support & Integrations`,
    },
  });

  // Group by team
  const byTeam = new Map<string, LinearIssue[]>();
  for (const issue of issues) {
    const list = byTeam.get(issue.teamName) || [];
    list.push(issue);
    byTeam.set(issue.teamName, list);
  }

  // Render each team, Support first
  const teamOrder = ["Support", "Integrations"];
  for (const teamName of teamOrder) {
    const teamIssues = byTeam.get(teamName);
    if (!teamIssues || teamIssues.length === 0) continue;

    const display = TEAM_DISPLAY[teamName] || { icon: ":pushpin:", label: teamName };

    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${display.icon} *${display.label}* (${teamIssues.length} ticket${teamIssues.length !== 1 ? "s" : ""})`,
        },
      ],
    });

    // Group by priority within team (Urgent first)
    const byPriority = new Map<number, LinearIssue[]>();
    for (const issue of teamIssues) {
      const list = byPriority.get(issue.priority) || [];
      list.push(issue);
      byPriority.set(issue.priority, list);
    }

    for (const prio of [1, 2]) {
      const prioIssues = byPriority.get(prio);
      if (!prioIssues || prioIssues.length === 0) continue;

      const prioDisplay = PRIORITY_DISPLAY[prio] || { icon: ":white_circle:", label: "Other" };

      // Priority sub-header
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `${prioDisplay.icon} *${prioDisplay.label}*` }],
      });

      // Each issue
      const lines: string[] = [];
      for (const issue of prioIssues) {
        const assignee = issue.assigneeName || "Unassigned";
        const dueDateStr = formatDueDate(issue.dueDate);
        const overdueTag =
          issue.overdueDays > 0
            ? `:warning: *${issue.overdueDays} day${issue.overdueDays !== 1 ? "s" : ""} overdue*`
            : ":calendar: Due today";

        lines.push(
          `• <${issue.url}|${issue.identifier}> ${issue.title}\n` +
            `   :bust_in_silhouette: ${assignee}  ·  :calendar: ${dueDateStr}  ·  ${overdueTag}`
        );
      }

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n\n") },
      });
    }
  }

  return blocks;
}

function buildAllClearBlocks(displayDate: string): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: *No overdue urgent/high tickets today* — ${displayDate}\nSupport & Integrations are all caught up!`,
      },
    },
  ];
}

// ── Public: Send Alert ───────────────────────────────────────────────

export async function sendLinearOverdueAlert(slackClient: WebClient): Promise<void> {
  const displayDate = getDisplayDate();

  const issues = await fetchOverdueLinearIssues();

  const blocks = issues.length > 0
    ? buildBlocks(issues, displayDate)
    : buildAllClearBlocks(displayDate);

  const fallbackText = issues.length > 0
    ? `Linear overdue alert: ${issues.length} urgent/high ticket(s) due today or overdue`
    : "No overdue urgent/high Linear tickets today. All caught up!";

  await slackClient.chat.postMessage({
    channel: LINEAR_ALERT_CHANNEL,
    blocks,
    text: fallbackText,
  });

  logger.info({ count: issues.length, channel: LINEAR_ALERT_CHANNEL }, "Linear overdue alert posted");
}

// ═══════════════════════════════════════════════════════════════════════
// EOD Review (4:59 PM) — still pending + resolved today
// ═══════════════════════════════════════════════════════════════════════

async function fetchResolvedTodayIssues(): Promise<LinearIssue[]> {
  if (!config.linear.apiKey) return [];

  const client = new LinearClient({ apiKey: config.linear.apiKey });
  const today = getTodayMexicoCity();

  // Fetch urgent/high issues from both teams that were completed/canceled
  // and updated today (fallback for completedAt filter)
  const result = await client.client.rawRequest(ISSUES_QUERY, {
    filter: {
      team: {
        id: { in: [TEAM_IDS.support, TEAM_IDS.integrations] },
      },
      priority: { in: [1, 2] },
      state: {
        type: { in: ["completed", "canceled"] },
      },
      completedAt: { gte: `${today}T00:00:00.000Z` },
    },
  });

  const nodes = (result as any).data.issues.nodes as any[];

  return nodes.map((n) => ({
    identifier: n.identifier,
    title: n.title,
    priority: n.priority,
    priorityLabel: n.priorityLabel,
    dueDate: n.dueDate || today,
    stateName: n.state.name,
    assigneeName: n.assignee?.name || null,
    url: n.url,
    labels: (n.labels?.nodes || []).map((l: any) => l.name),
    teamName: n.team.name,
    overdueDays: n.dueDate ? daysBetween(n.dueDate, today) : 0,
  }));
}

// ── EOD Block Kit Formatter ──────────────────────────────────────────

function buildPendingSection(issues: LinearIssue[]): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Group by team
  const byTeam = new Map<string, LinearIssue[]>();
  for (const issue of issues) {
    const list = byTeam.get(issue.teamName) || [];
    list.push(issue);
    byTeam.set(issue.teamName, list);
  }

  const teamOrder = ["Support", "Integrations"];
  for (const teamName of teamOrder) {
    const teamIssues = byTeam.get(teamName);
    if (!teamIssues || teamIssues.length === 0) continue;

    const display = TEAM_DISPLAY[teamName] || { icon: ":pushpin:", label: teamName };

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${display.icon} *${display.label}*`,
        },
      ],
    });

    // Group by priority (Urgent first)
    const byPriority = new Map<number, LinearIssue[]>();
    for (const issue of teamIssues) {
      const list = byPriority.get(issue.priority) || [];
      list.push(issue);
      byPriority.set(issue.priority, list);
    }

    for (const prio of [1, 2]) {
      const prioIssues = byPriority.get(prio);
      if (!prioIssues || prioIssues.length === 0) continue;

      const prioDisplay = PRIORITY_DISPLAY[prio] || { icon: ":white_circle:", label: "Other" };

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `${prioDisplay.icon} *${prioDisplay.label}*` }],
      });

      const lines: string[] = [];
      for (const issue of prioIssues) {
        const assignee = issue.assigneeName || "Unassigned";
        const dueDateStr = formatDueDate(issue.dueDate);
        const overdueTag =
          issue.overdueDays > 0
            ? `:warning: *${issue.overdueDays} day${issue.overdueDays !== 1 ? "s" : ""} overdue*`
            : ":calendar: Due today";

        lines.push(
          `• <${issue.url}|${issue.identifier}> ${issue.title}\n` +
            `   :bust_in_silhouette: ${assignee}  ·  :calendar: ${dueDateStr}  ·  ${overdueTag}`
        );
      }

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n\n") },
      });
    }
  }

  return blocks;
}

function buildResolvedSection(issues: LinearIssue[]): KnownBlock[] {
  const lines: string[] = [];

  for (const issue of issues) {
    const assignee = issue.assigneeName || "Unassigned";
    lines.push(
      `• <${issue.url}|${issue.identifier}> ${issue.title}\n` +
        `   :bust_in_silhouette: ${assignee}  ·  _${issue.stateName}_`
    );
  }

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n\n") },
    },
  ];
}

function buildEodReviewBlocks(
  pending: LinearIssue[],
  resolved: LinearIssue[],
  displayDate: string
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `:clipboard: Linear EOD Review — ${displayDate}`,
    },
  });

  // Summary
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${pending.length}* still pending  ·  *${resolved.length}* resolved today`,
    },
  });

  // Still Pending section
  if (pending.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: *Still Pending* (${pending.length})`,
        },
      ],
    });
    blocks.push(...buildPendingSection(pending));
  }

  // Resolved Today section
  if (resolved.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:white_check_mark: *Resolved Today* (${resolved.length})`,
        },
      ],
    });
    blocks.push(...buildResolvedSection(resolved));
  }

  // All clear
  if (pending.length === 0 && resolved.length === 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: No urgent/high tickets pending or resolved today. All clear!`,
      },
    });
  }

  return blocks;
}

// ── Public: Send EOD Review ──────────────────────────────────────────

export async function sendLinearEodReview(slackClient: WebClient): Promise<void> {
  const displayDate = getDisplayDate();

  const [pending, resolved] = await Promise.all([
    fetchOverdueLinearIssues(),
    fetchResolvedTodayIssues(),
  ]);

  const blocks = buildEodReviewBlocks(pending, resolved, displayDate);

  const fallbackText =
    pending.length > 0 || resolved.length > 0
      ? `Linear EOD review: ${pending.length} pending, ${resolved.length} resolved today`
      : "Linear EOD review: All clear — no urgent/high tickets pending or resolved today";

  await slackClient.chat.postMessage({
    channel: LINEAR_ALERT_CHANNEL,
    blocks,
    text: fallbackText,
  });

  logger.info(
    { pending: pending.length, resolved: resolved.length, channel: LINEAR_ALERT_CHANNEL },
    "Linear EOD review posted"
  );
}
