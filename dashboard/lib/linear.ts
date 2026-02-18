/**
 * Linear client for the Pascal Dashboard.
 *
 * Fetches merchant/partner integration data from two Linear teams
 * (Integrations + Support) and caches it with a 5-minute TTL.
 *
 * Uses direct fetch() to the Linear GraphQL API instead of @linear/sdk
 * to avoid ETIMEDOUT issues on Railway's Alpine containers.
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";

function getApiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error("LINEAR_API_KEY not configured");
  return key;
}

/** Execute a GraphQL query against the Linear API with timeout + retry */
async function linearGql<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const apiKey = getApiKey();
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Linear API ${res.status}: ${text}`);
      }

      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(
          `Linear GraphQL: ${json.errors.map((e: any) => e.message).join(", ")}`
        );
      }
      return json.data as T;
    } catch (err: any) {
      clearTimeout(timeout);
      const isRetryable =
        err.name === "AbortError" ||
        err.cause?.code === "ETIMEDOUT" ||
        err.cause?.code === "ECONNRESET";

      if (isRetryable && attempt < maxRetries) {
        console.warn(
          `Linear API attempt ${attempt + 1} failed (${err.cause?.code ?? err.name}), retrying...`
        );
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Linear API: max retries exceeded");
}

/* ─── Constants: Team & Label Parent IDs ─── */

// Team IDs (use IDs directly to avoid extra nesting in GraphQL)
const INT_TEAM_ID = "d2479bda-f447-4389-9ea2-5ed1038aec5f";
const SOS_TEAM_ID = "b3b91e8f-cf68-4632-b6da-c49a2bc97b8a";

// Parent label IDs that identify merchant/partner labels
const INT_MERCHANTS_PARENT = "ea27fd32-657c-46f7-a475-ecd42137346d";
const INT_PARTNERS_PARENT = "b5edd6cb-1e90-4aeb-b146-89ed83836124";
const SOS_MERCHANTS_PARENT = "71d12f33-5056-44d0-acf6-3842e037c9db";

/* ─── Types ─── */

export interface MerchantIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  status: string;
  statusType: string;
  priority: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
}

export interface MerchantEntry {
  name: string;
  type: "merchant" | "partner";
  section: "integration" | "support";
  issues: MerchantIssue[];
  openCount: number;
  latestStatus: string;
  latestStatusType: string;
  assignee: string | null;
  lastActivity: string;
}

export interface IntegrationStats {
  totalInIntegration: number;
  totalLive: number;
  blockedCount: number;
  inProgressCount: number;
  completedThisMonth: number;
}

export interface IntegrationData {
  integrations: MerchantEntry[];
  support: MerchantEntry[];
  stats: IntegrationStats;
  cachedAt: string;
}

/* ─── Cache ─── */

interface CacheEntry {
  data: IntegrationData;
  timestamp: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/* ─── GraphQL ─── */

const ISSUES_QUERY = `
  query FetchTeamIssues($teamId: String!, $cursor: String) {
    team(id: $teamId) {
      issues(first: 25, after: $cursor, orderBy: updatedAt) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          identifier
          title
          url
          priority
          createdAt
          updatedAt
          dueDate
          state { name type }
          assignee { name }
          labels { nodes { id name parent { id } } }
        }
      }
    }
  }
`;

/* ─── Helpers ─── */

const PRIORITY_MAP: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

/** Strip label prefix ("Merchant → Nuvigo Pay" → "Nuvigo Pay") */
function extractEntityName(labelName: string): string {
  const idx = labelName.indexOf("→");
  if (idx === -1) return labelName.trim();
  return labelName.slice(idx + 1).trim();
}

/** Determine entity type and section from a label's parent ID */
function classifyLabel(parentId: string | null): {
  type: "merchant" | "partner";
  section: "integration" | "support";
} | null {
  if (!parentId) return null;
  if (parentId === INT_MERCHANTS_PARENT)
    return { type: "merchant", section: "integration" };
  if (parentId === INT_PARTNERS_PARENT)
    return { type: "partner", section: "integration" };
  if (parentId === SOS_MERCHANTS_PARENT)
    return { type: "merchant", section: "support" };
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  state: { name: string; type: string };
  assignee: { name: string } | null;
  labels: { nodes: Array<{ id: string; name: string; parent: { id: string } | null }> };
}

/** Fetch all issues for a team by ID, paginating through results */
async function fetchTeamIssues(teamId: string): Promise<RawIssue[]> {
  const allIssues: RawIssue[] = [];
  let cursor: string | null = null;

  interface TeamIssuesResult {
    team: { issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawIssue[];
    } };
  }

  for (let page = 0; page < 20; page++) {
    const result: TeamIssuesResult = await linearGql(ISSUES_QUERY, { teamId, cursor });

    const issuesData = result?.team?.issues;
    if (!issuesData) break;

    allIssues.push(...(issuesData.nodes || []));

    if (!issuesData.pageInfo.hasNextPage) break;
    cursor = issuesData.pageInfo.endCursor;
  }

  return allIssues;
}

/** Group raw issues by entity (merchant/partner) name */
function groupByEntity(
  issues: RawIssue[],
  sectionFilter: "integration" | "support"
): Map<string, { type: "merchant" | "partner"; issues: RawIssue[] }> {
  const groups = new Map<
    string,
    { type: "merchant" | "partner"; issues: RawIssue[] }
  >();

  for (const issue of issues) {
    for (const label of issue.labels.nodes) {
      const classification = classifyLabel(label.parent?.id ?? null);
      if (!classification || classification.section !== sectionFilter) continue;

      const name = extractEntityName(label.name);
      const existing = groups.get(name);
      if (existing) {
        existing.issues.push(issue);
      } else {
        groups.set(name, { type: classification.type, issues: [issue] });
      }
    }
  }

  return groups;
}

/** Convert grouped data to sorted MerchantEntry[] */
function buildEntries(
  groups: Map<string, { type: "merchant" | "partner"; issues: RawIssue[] }>,
  section: "integration" | "support"
): MerchantEntry[] {
  const entries: MerchantEntry[] = [];

  for (const [name, group] of groups) {
    // Sort issues by updatedAt desc
    group.issues.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const latest = group.issues[0];
    const activeIssues = group.issues.filter(
      (i) =>
        !["completed", "canceled", "duplicate"].includes(
          i.state.type.toLowerCase()
        )
    );

    entries.push({
      name,
      type: group.type,
      section,
      issues: group.issues.map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        url: i.url,
        status: i.state.name,
        statusType: i.state.type,
        priority: PRIORITY_MAP[i.priority] || "None",
        assignee: i.assignee?.name ?? null,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        dueDate: i.dueDate,
      })),
      openCount: activeIssues.length,
      latestStatus: latest.state.name,
      latestStatusType: latest.state.type,
      assignee: latest.assignee?.name ?? null,
      lastActivity: latest.updatedAt,
    });
  }

  // Sort: most recently active first
  entries.sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  return entries;
}

/* ─── Main Fetch ─── */

export async function fetchIntegrationData(
  forceRefresh = false
): Promise<IntegrationData> {
  // Return cache if fresh
  if (!forceRefresh && cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  // Fetch both teams in parallel
  const [intIssues, sosIssues] = await Promise.all([
    fetchTeamIssues(INT_TEAM_ID),
    fetchTeamIssues(SOS_TEAM_ID),
  ]);

  // Group and build entries
  const intGroups = groupByEntity(intIssues, "integration");
  const sosGroups = groupByEntity(sosIssues, "support");

  const integrations = buildEntries(intGroups, "integration");
  const support = buildEntries(sosGroups, "support");

  // Count completed this month (across both teams)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const completedThisMonth = [...intIssues, ...sosIssues].filter(
    (i) =>
      ["completed", "resolved"].includes(i.state.type.toLowerCase()) &&
      new Date(i.updatedAt) >= monthStart
  ).length;

  // Compute stats
  const allEntries = [...integrations, ...support];
  const blockedCount = allEntries.filter((e) =>
    ["Waiting for Customer", "Paused"].includes(e.latestStatus)
  ).length;
  const inProgressCount = allEntries.filter((e) =>
    ["In Progress", "Investigating"].includes(e.latestStatus)
  ).length;

  const data: IntegrationData = {
    integrations,
    support,
    stats: {
      totalInIntegration: integrations.length,
      totalLive: support.length,
      blockedCount,
      inProgressCount,
      completedThisMonth,
    },
    cachedAt: new Date().toISOString(),
  };

  cache = { data, timestamp: Date.now() };
  return data;
}
