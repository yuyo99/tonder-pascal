/**
 * Pascal Model 2 / AID-77 — Refine query (Phase 1 of the pipeline)
 *
 * Sits between Phase 0 (gate) and the main Sonnet tool loop. Takes the
 * raw merchant message and runs a fast Haiku call that returns:
 *
 *   {
 *     intent: 'bare_id' | 'data_query' | 'integration_question' |
 *             'escalation' | 'deposit_ticket' | 'social' | 'other',
 *     canonical_query: string,       // cleaned-up rewrite (shorthand expanded)
 *     ids: string[],                 // any identifiers extracted from the text
 *     confidence: number,            // 0.0 to 1.0
 *     tool_plan: {                   // AID-79b: data-query planner
 *       suggested_tool: 'query_transactions' | 'lookup_by_id' | null,
 *       suggested_filters: { date_range, status, payment_method, ... },
 *       reasoning: string
 *     } | null
 *   }
 *
 * Downstream uses:
 *   1. canonical_query feeds knowledge retrieval (better recall on shorthand)
 *   2. bare_id intent + single ID → short-circuit to direct lookup, no Sonnet
 *   3. AID-79b: tool_plan is injected into Sonnet's system prompt as a
 *      <query_plan> hint so Sonnet picks the right tool in round 1 instead
 *      of exploring across 2-3 rounds. The plan is a SUGGESTION — Sonnet
 *      can override it.
 *   4. AID-79b: social intent + high confidence → canned reply, no Sonnet
 *      tool loop. Saves ~5-10s and ~$0.01 per "thanks" message.
 *
 * Failure mode: any error in refineQuery() returns a "passthrough" refinement
 * that leaves the original text intact and disables the short-circuit. The
 * pipeline never blocks on Haiku availability.
 *
 * Spec: PASCAL_MODEL_2.md §3 Phase 1 / §6 Milestone 5 AID-77.
 *       PASCAL_INTELLIGENCE_UPGRADE.md AID-79b (data-query planner).
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { logger } from "../utils/logger";

const client = new Anthropic({ apiKey: config.claude.apiKey, timeout: 15_000 });

export type RefineIntent =
  | "bare_id"
  | "data_query"
  | "integration_question"
  | "escalation"
  | "deposit_ticket"
  | "social"
  | "other";

/**
 * AID-79b: structured plan for which tool Sonnet should call and with
 * what filters. Injected into the system prompt as a <query_plan>
 * hint. All fields optional — if Haiku can't make a strong suggestion
 * the field is omitted and Sonnet decides freely.
 */
export interface ToolPlan {
  /** Suggested tool name; null if the question doesn't map to a known tool. */
  suggested_tool: "query_transactions" | "lookup_by_id" | "get_withdrawal_status" | null;
  /**
   * Suggested filters for query_transactions. Mirrors a subset of
   * QueryTransactionsInput.filters. Date ranges are resolved to ISO
   * 8601 from natural-language keywords ("yesterday" → ISO start/end).
   */
  suggested_filters?: {
    status?: string[];
    payment_method?: string[];
    date_range?: { from: string; to: string };
    amount_range?: { min?: number; max?: number };
    search?: string;
    decline_reason?: string;
  };
  /** Suggested aggregate mode for query_transactions, if applicable. */
  suggested_aggregate?:
    | "count"
    | "sum"
    | "group_by_status"
    | "group_by_method"
    | "group_by_decline"
    | "group_by_day";
  /** 1-2 sentence explanation, useful for self-QA debugging. */
  reasoning: string;
}

export interface RefinedQuery {
  intent: RefineIntent;
  canonical_query: string;
  ids: string[];
  confidence: number;
  /** True when refineQuery short-circuited to passthrough (Haiku failed or skipped). */
  passthrough: boolean;
  /** AID-79b: tool-call plan; null when Haiku didn't produce one or passthrough. */
  tool_plan: ToolPlan | null;
}

/**
 * Best-effort detector for messages that are clearly a bare ID and don't
 * need an LLM round-trip. This is a fast pre-check before we even call
 * Haiku — if the message is "just an ID", we already know the intent.
 *
 * Returns the ID if matched, null otherwise.
 */
function detectBareId(text: string): string | null {
  const trimmed = text.trim();
  // 8+ alphanumeric chars (numeric, UUID, hex, mixed), nothing else
  if (/^[A-Za-z0-9-]{8,64}$/.test(trimmed)) return trimmed;
  // Numeric ID only
  if (/^\d{4,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Run Haiku to refine the query. Always returns a result — falls through to
 * passthrough on any failure (timeout, parse error, etc.).
 */
export async function refineQuery(text: string): Promise<RefinedQuery> {
  // Fast path — obvious bare IDs skip the Haiku call entirely.
  const bareId = detectBareId(text);
  if (bareId) {
    return {
      intent: "bare_id",
      canonical_query: `Look up ID ${bareId} and report its current status`,
      ids: [bareId],
      confidence: 0.95,
      passthrough: false,
      // Bare-ID short-circuit bypasses Sonnet entirely so the plan is
      // unused, but populate suggested_tool for completeness in case
      // the short-circuit fails and the orchestrator falls through to
      // the normal pipeline.
      tool_plan: {
        suggested_tool: "lookup_by_id",
        reasoning: "Message is a bare ID — direct lookup_by_id call.",
      },
    };
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: buildRefinePrompt(text),
        },
      ],
    });

    const out = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return passthrough(text);

    const parsed = JSON.parse(match[0]) as Partial<RefinedQuery>;

    // Validate the shape — Haiku must return all required fields, and the
    // intent must be one of our known labels.
    const validIntents: RefineIntent[] = [
      "bare_id",
      "data_query",
      "integration_question",
      "escalation",
      "deposit_ticket",
      "social",
      "other",
    ];
    if (!parsed.intent || !validIntents.includes(parsed.intent)) {
      return passthrough(text);
    }

    return {
      intent: parsed.intent,
      canonical_query: parsed.canonical_query?.trim() || text,
      ids: Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      passthrough: false,
      tool_plan: validateToolPlan(parsed.tool_plan),
    };
  } catch (err) {
    logger.warn({ err }, "refineQuery: Haiku failed, falling through to passthrough");
    return passthrough(text);
  }
}

function passthrough(text: string): RefinedQuery {
  return {
    intent: "other",
    canonical_query: text,
    ids: [],
    confidence: 0,
    passthrough: true,
    tool_plan: null,
  };
}

/**
 * Validate Haiku's tool_plan output. Returns a normalized plan or null
 * if the plan is malformed / missing required fields. We're lenient on
 * missing optional fields but strict on the suggested_tool value (must
 * be one of the known names or null).
 */
function validateToolPlan(raw: unknown): ToolPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const validTools = ["query_transactions", "lookup_by_id", "get_withdrawal_status"];
  const tool =
    p.suggested_tool === null ||
    (typeof p.suggested_tool === "string" && validTools.includes(p.suggested_tool))
      ? (p.suggested_tool as ToolPlan["suggested_tool"])
      : null;
  const reasoning = typeof p.reasoning === "string" ? p.reasoning : "";
  const filters =
    p.suggested_filters && typeof p.suggested_filters === "object"
      ? (p.suggested_filters as ToolPlan["suggested_filters"])
      : undefined;
  const aggregate =
    typeof p.suggested_aggregate === "string"
      ? (p.suggested_aggregate as ToolPlan["suggested_aggregate"])
      : undefined;
  return {
    suggested_tool: tool,
    suggested_filters: filters,
    suggested_aggregate: aggregate,
    reasoning,
  };
}

function buildRefinePrompt(text: string): string {
  // Today's ISO timestamp — pre-resolved so the model can convert
  // "yesterday" / "last week" into concrete ISO 8601 ranges without
  // having to reason about calendar math.
  const nowIso = new Date().toISOString();
  return `You are Pascal's query-refinement preprocessor.

Your job: take a raw merchant or Tonder-team message and produce (a) a
clean canonical rewrite + intent classification, AND (b) a structured
tool-call plan that helps Pascal's main reasoner pick the right tool
on the first attempt.

Now: ${nowIso}
Raw message: "${text.slice(0, 2000)}"

Respond with ONLY a JSON object (no prose, no markdown fences). Schema:

{
  "intent": "bare_id" | "data_query" | "integration_question" | "escalation" | "deposit_ticket" | "social" | "other",
  "canonical_query": "<cleaned-up rewrite of the message in 1-2 sentences, with any shorthand expanded>",
  "ids": ["<any payment_id, order_id, txid, tracking_key, UUID, or alphanumeric reference extracted from the message>", ...],
  "confidence": <0.0 to 1.0>,
  "tool_plan": {
    "suggested_tool": "query_transactions" | "lookup_by_id" | "get_withdrawal_status" | null,
    "suggested_filters": {
      "status":          ["approved" | "declined" | "pending" | "refunded" | "reversed" | "expired" | "failed"],
      "payment_method":  ["cards" | "spei" | "oxxopay" | "cash_voucher" | "mercadopago"],
      "date_range":      { "from": "<ISO8601>", "to": "<ISO8601>" },
      "amount_range":    { "min": <number>, "max": <number> },
      "search":          "<id, email, reference, or txid to fuzzy-match>",
      "decline_reason":  "<partial match string>"
    },
    "suggested_aggregate": "count" | "sum" | "group_by_status" | "group_by_method" | "group_by_decline" | "group_by_day",
    "reasoning": "<1-2 sentences explaining why you picked this plan>"
  }
}

Intent definitions:
  • bare_id              — JUST one or more IDs, no question (e.g. "1862577238055789135" or "WD 4471421")
  • data_query           — asking about transaction data, volumes, rates, acceptance, withdrawals
  • integration_question — technical question about SDK, API, webhooks, payment methods, 3DS, decline codes
  • escalation           — explicit ask for human help, complaint, "something is broken"
  • deposit_ticket       — partner-bot-format deposit ticket
  • social               — greeting, thanks, chitchat, no actionable question
  • other                — anything else

Shorthand expansion examples:
  • "WD 1234 stuck"       → canonical: "withdrawal 1234 status", ids: ["1234"]
  • "TX 4520690 today?"   → canonical: "transaction 4520690 status as of today", ids: ["4520690"]
  • "dep 5/k mxn missing" → canonical: "missing SPEI deposit around $5,000 MXN today"
  • "rate slack hoy"      → canonical: "today's overall acceptance rate"

ID extraction guidance:
  • Pull numeric strings ≥ 4 digits, UUIDs, alphanumeric refs ≥ 8 chars.
  • Ignore obvious amounts (e.g. "$5000", "5,000 MXN").
  • Preserve large numeric IDs as strings.

Tool plan guidance:
  • For data_query → suggested_tool: "query_transactions".
      ▸ "what's our acceptance rate today/this week"     → suggested_aggregate: "group_by_status", date_range
      ▸ "top decline reasons"                              → suggested_aggregate: "group_by_decline"
      ▸ "total volume yesterday"                           → suggested_aggregate: "sum", date_range
      ▸ "show me declined SPEI > 5k yesterday"             → filters: { status, payment_method, amount_range, date_range }
      ▸ "transactions for customer@x.com"                  → filters: { search }
  • For bare_id → suggested_tool: "lookup_by_id".
  • For withdrawal questions → suggested_tool: "get_withdrawal_status".
  • For integration_question / escalation / social / other → suggested_tool: null (Pascal will not use a data tool).

Date resolution (CRITICAL — Pascal cannot do this in-flight):
  • Resolve any relative date in the message ("yesterday", "today",
    "this week", "last week", "this month", "last 7 days") to explicit
    ISO 8601 ranges using "Now: ${nowIso}" as the anchor.
  • Use UTC if the merchant didn't specify a timezone.
  • "yesterday" = previous calendar day, 00:00:00 → 23:59:59
  • "this week" = Monday 00:00:00 of current week → now
  • If no date mentioned at all, omit date_range entirely (do NOT default to "today").

Payment method labels (CRITICAL — use ONLY external labels):
  • "cards" "spei" "oxxopay" "cash_voucher" "mercadopago"
  • NEVER use internal acquirer names (kushki, unlimit, bitso, stp, etc.)

Status labels: use the lowercase canonical values from the schema. Map common synonyms:
  • "successful" / "approved" / "completed" → "approved"
  • "rejected" / "declined" → "declined"
  • "stuck" / "in progress" → "pending"

Confidence: 1.0 if unambiguous; lower if the intent is mixed.
Reasoning: be brief — a sentence or two.

If you're uncertain about the tool plan, output tool_plan with suggested_tool: null and a brief reason.

Respond with JSON only.`;
}

/**
 * Predicate the orchestrator uses to decide whether to take the bare-ID
 * short-circuit path. Conservative — only triggers when:
 *   - intent is `bare_id`
 *   - exactly one ID was extracted
 *   - confidence >= 0.85
 *
 * Returns the single ID, or null to take the normal Sonnet path.
 */
export function bareIdShortCircuit(refined: RefinedQuery): string | null {
  if (refined.passthrough) return null;
  if (refined.intent !== "bare_id") return null;
  if (refined.ids.length !== 1) return null;
  if (refined.confidence < 0.85) return null;
  return refined.ids[0];
}

/**
 * AID-79b: short-circuit for purely social messages ("thanks", "ok", "hi").
 * Conservative — only fires when:
 *   - intent is `social`
 *   - confidence >= 0.90 (higher bar than bare_id because false positives
 *     here mean we skipped real work)
 *
 * Returns true to take the social path (canned + Haiku-formatted reply),
 * false to fall through to normal Sonnet pipeline.
 */
export function socialShortCircuit(refined: RefinedQuery): boolean {
  if (refined.passthrough) return false;
  if (refined.intent !== "social") return false;
  if (refined.confidence < 0.9) return false;
  return true;
}

/**
 * AID-79b: render the tool plan as a system-prompt section. Returns
 * empty string when there's nothing useful to inject (passthrough,
 * social, or no concrete suggestion).
 *
 * The plan is presented as a SUGGESTION — Sonnet may override it if
 * it disagrees. Importantly, we don't tell Sonnet "use exactly this
 * filter" — we say "here's what a fast preprocessor inferred; verify
 * + adjust as needed."
 */
export function renderToolPlanForPrompt(refined: RefinedQuery): string {
  const p = refined.tool_plan;
  if (!p) return "";
  if (!p.suggested_tool && !p.suggested_filters && !p.suggested_aggregate) return "";

  const lines: string[] = [];
  lines.push("\n\n## Query Plan (Haiku preprocessor hint)");
  lines.push(
    "A fast preprocessor analyzed the merchant's message and suggests the following tool call. " +
      "Treat this as a HINT — verify the filters make sense and adjust if needed. " +
      "If the suggestion is correct, calling the suggested tool with the suggested filters " +
      "in a single round is preferred."
  );
  if (p.suggested_tool) lines.push(`- suggested_tool: \`${p.suggested_tool}\``);
  if (p.suggested_aggregate)
    lines.push(`- suggested_aggregate: \`${p.suggested_aggregate}\``);
  if (p.suggested_filters && Object.keys(p.suggested_filters).length > 0) {
    lines.push(
      `- suggested_filters: \`${JSON.stringify(p.suggested_filters)}\``
    );
  }
  if (p.reasoning) lines.push(`- reasoning: ${p.reasoning}`);
  return lines.join("\n");
}
