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
 *     confidence: number             // 0.0 to 1.0
 *   }
 *
 * Two downstream uses:
 *   1. The orchestrator passes `canonical_query` to knowledge retrieval so
 *      semantic search isn't fighting against shorthand like "WD 1234 stuck".
 *   2. If `intent === 'bare_id'` and exactly one ID was extracted with high
 *      confidence, the orchestrator short-circuits to a single tool call +
 *      Haiku-formatted answer, skipping the multi-round Sonnet loop. This is
 *      the BC Game / partner-bot lookup pattern, generalized to every channel.
 *
 * Failure mode: any error in refineQuery() returns a "passthrough" refinement
 * that leaves the original text intact and disables the short-circuit. The
 * pipeline never blocks on Haiku availability.
 *
 * Spec: PASCAL_MODEL_2.md §3 Phase 1 / §6 Milestone 5 AID-77.
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

export interface RefinedQuery {
  intent: RefineIntent;
  canonical_query: string;
  ids: string[];
  confidence: number;
  /** True when refineQuery short-circuited to passthrough (Haiku failed or skipped). */
  passthrough: boolean;
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
  };
}

function buildRefinePrompt(text: string): string {
  return `You are Pascal's query-refinement preprocessor.

Your job: take a raw merchant or Tonder-team message and produce a clean
canonical version + intent classification. Pascal will use the result to
decide whether to route the message to a fast tool lookup or to its full
reasoning pipeline.

Raw message: "${text.slice(0, 2000)}"

Classify and rewrite. Respond with ONLY a JSON object (no prose, no
markdown fences). Schema:

{
  "intent": "bare_id" | "data_query" | "integration_question" | "escalation" | "deposit_ticket" | "social" | "other",
  "canonical_query": "<cleaned-up rewrite of the message in 1-2 sentences, with any shorthand expanded>",
  "ids": ["<any payment_id, order_id, txid, tracking_key, UUID, or alphanumeric reference extracted from the message>", ...],
  "confidence": <0.0 to 1.0>
}

Intent definitions:
  • bare_id              — message is JUST one or more IDs, no question (e.g. "1862577238055789135" or "WD 4471421")
  • data_query           — asking about transaction data, volumes, rates, acceptance, withdrawals (e.g. "acceptance rate for BCGAME today", "show me failed deposits")
  • integration_question — technical question about Tonder's SDK, API, webhooks, payment methods, 3DS, decline codes
  • escalation           — explicit ask for human help, complaint, or "something is broken"
  • deposit_ticket       — partner-bot-format deposit ticket (includes "OrderId:", "TxId:", "Amount:", etc.)
  • social               — greeting, thanks, chitchat, no actionable question
  • other                — anything else

Shorthand expansion examples:
  • "WD 1234 stuck"       → canonical: "withdrawal 1234 status — appears stuck", ids: ["1234"]
  • "TX 4520690 today?"   → canonical: "transaction 4520690 status as of today", ids: ["4520690"]
  • "dep 5/k mxn missing" → canonical: "missing SPEI deposit around $5,000 MXN today"
  • "rate slack hoy"      → canonical: "today's overall acceptance rate"

ID extraction guidance:
  • Pull any numeric strings ≥ 4 digits, UUIDs, alphanumeric refs ≥ 8 chars.
  • Ignore obvious amounts (e.g. "$5000", "5,000 MXN") — those aren't lookup IDs.
  • Preserve large numeric IDs as strings (don't truncate or convert).

Confidence: 1.0 if the message is unambiguous; lower if the intent is mixed
or context-dependent.

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
