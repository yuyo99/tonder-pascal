/**
 * Pascal Model 2 / AID-80 — Simulation runner
 *
 * Three jobs:
 *   1. runSimulation(simId, triggeredBy) — execute one sim end-to-end:
 *      customer persona (Sonnet) drives a multi-turn conversation against
 *      Pascal (handleIncomingMessage, in-process), then a Haiku judge
 *      scores the transcript against the sim's success criteria.
 *      Persists a row into pascal_simulation_runs + updates the sim
 *      row's last_result / consecutive_failures. On transition into
 *      fail, opens a Linear ticket on the SOS team.
 *   2. runSuite(opts) — pull all active sims and run them sequentially
 *      (with up to MAX_PARALLEL concurrency). Called by the nightly
 *      3 AM Mexico City cron.
 *   3. startJobPoller() — every 10s claim pending rows from
 *      pascal_simulation_jobs (inserted by the dashboard's "Run now"
 *      button) and execute them via runSimulation.
 *
 * Cost ceilings:
 *   - max_turns per sim DB column (default 4)
 *   - MAX_TURNS_GLOBAL env hard cap (default 8) — runtime check
 *   - MAX_PARALLEL env cap (default 2) for runSuite
 *
 * Spec: PASCAL_MODEL_2.md §6 Milestone 6 AID-80.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { pgQuery } from "../postgres/connection";
import { handleIncomingMessage } from "../core/orchestrator";
import { createTeamTicket } from "../linear/client";
import type { IncomingMessage } from "../channels/types";
import { logger } from "../utils/logger";
import { storeErrorFromCatch } from "../utils/error-store";

const client = new Anthropic({
  apiKey: config.claude.apiKey,
  timeout: 60_000,
});

const MAX_TURNS_GLOBAL = parseInt(process.env.SIM_MAX_TURNS_GLOBAL ?? "8", 10);
const MAX_PARALLEL = Math.max(1, parseInt(process.env.SIM_MAX_PARALLEL ?? "2", 10));
const POLLER_INTERVAL_MS = 10_000;

let pollerHandle: ReturnType<typeof setInterval> | null = null;
let pollerRunning = false;

// ── Types ──────────────────────────────────────────────────────────────

interface SimulationRow {
  id: number;
  name: string;
  procedure_id: number | null;
  scenario_description: string;
  customer_persona: string;
  opening_message: string;
  max_turns: number;
  expected_outcome: string;
  success_criteria: string[];
  merchant_business_id: number;
  test_channel_id: string;
  last_result: "pass" | "fail" | "partial" | "error" | null;
  owner: string | null;
}

interface TranscriptTurn {
  role: "customer" | "pascal";
  text: string;
  latencyMs?: number;
  error?: string;
}

interface JudgeCriterion {
  name: string;
  met: boolean;
  reason: string;
}

interface JudgeResult {
  result: "pass" | "fail" | "partial";
  summary: string;
  criteria: JudgeCriterion[];
}

export interface RunOutcome {
  runId: number;
  result: "pass" | "fail" | "partial" | "error";
  transcript: TranscriptTurn[];
  judge: JudgeResult | null;
  linearTicket: string | null;
  latencyMs: number;
  error?: string;
}

export interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  partial: number;
  errors: number;
}

// ── Main entry: runSimulation ──────────────────────────────────────────

export async function runSimulation(
  simId: number,
  triggeredBy: string = "cron",
): Promise<RunOutcome> {
  const startedAt = Date.now();
  let sim: SimulationRow | null = null;
  const transcript: TranscriptTurn[] = [];
  let turns = 0;
  let error: string | undefined;
  let result: RunOutcome["result"] = "error";
  let judge: JudgeResult | null = null;

  try {
    sim = await loadSimulation(simId);
    if (!sim) {
      throw new Error(`simulation ${simId} not found`);
    }

    logger.info({ simId, name: sim.name, triggeredBy }, "Simulation: starting");

    // Seed transcript with the opening message
    transcript.push({ role: "customer", text: sim.opening_message });

    const maxTurns = Math.min(sim.max_turns, MAX_TURNS_GLOBAL);

    for (let turn = 1; turn <= maxTurns; turn++) {
      turns = turn;
      const lastCustomer = transcript[transcript.length - 1];
      if (lastCustomer.role !== "customer") break; // safety

      // Pascal turn
      const pascalStart = Date.now();
      let pascalText = "";
      let pascalError: string | undefined;
      try {
        const incomingMsg: IncomingMessage = {
          channelId: sim.test_channel_id,
          platform: "slack",
          userId: `sim_user_${sim.id}`,
          userName: `Sim Customer (${sim.name})`,
          text: lastCustomer.text,
          rawEvent: { _sim: true, simulation_id: sim.id, run_at: startedAt },
          // Always treat as a direct mention so the Phase 0 require_mention
          // rules don't block sim traffic. Real merchant gates still apply
          // to real channels — only the sim:* channel ids see this.
          mentions: ["@pascal"],
          ambient: false,
        };
        const response = await handleIncomingMessage(incomingMsg);
        pascalText = response.text || "";
      } catch (err) {
        pascalError = err instanceof Error ? err.message : String(err);
      }
      transcript.push({
        role: "pascal",
        text: pascalText,
        latencyMs: Date.now() - pascalStart,
        error: pascalError,
      });

      if (pascalError || !pascalText) {
        // Pascal threw or returned empty — count as error result; the judge
        // will still rate the partial transcript but typically marks fail.
        break;
      }

      // Customer persona follow-up
      const followUp = await askCustomerPersona(sim, transcript);
      if (followUp.done) break;
      transcript.push({ role: "customer", text: followUp.message });
    }

    // Judge the full transcript
    judge = await judgeTranscript(sim, transcript);
    result = judge.result;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ err, simId }, "Simulation: failed with error");
    storeErrorFromCatch("scheduler", err, { action: "simulation:run", simId });
    result = "error";
  }

  const latencyMs = Date.now() - startedAt;

  // Persist the run + update sim row
  let runId = 0;
  let linearTicket: string | null = null;
  try {
    runId = await persistRun({
      simulation_id: simId,
      result,
      judge,
      transcript,
      turns,
      latencyMs,
      error: error ?? null,
      triggered_by: triggeredBy,
    });

    // Open Linear ticket on transition into fail (cron runs only — manual
    // "Run now" runs don't fire tickets, to keep noise low when the team
    // is interactively debugging).
    if (
      sim &&
      result === "fail" &&
      triggeredBy === "cron" &&
      sim.last_result !== "fail"
    ) {
      try {
        linearTicket = await openFailureTicket(sim, transcript, judge, runId);
        if (linearTicket) {
          await pgQuery(
            `UPDATE pascal_simulation_runs SET linear_ticket = $1 WHERE id = $2`,
            [linearTicket, runId],
          );
        }
      } catch (ticketErr) {
        logger.warn({ err: ticketErr, simId }, "Simulation: failed to open Linear ticket");
      }
    }

    if (sim) {
      await updateSimLastResult(sim, result, judge);
    }
  } catch (persistErr) {
    logger.error({ err: persistErr, simId }, "Simulation: failed to persist run");
  }

  logger.info(
    { simId, name: sim?.name, result, turns, latencyMs, runId, linearTicket },
    "Simulation: done",
  );

  return { runId, result, transcript, judge, linearTicket, latencyMs, error };
}

// ── runSuite ───────────────────────────────────────────────────────────

export async function runSuite(opts: { onlyActive?: boolean } = {}): Promise<SuiteResult> {
  const onlyActive = opts.onlyActive ?? true;
  const stats: SuiteResult = { total: 0, passed: 0, failed: 0, partial: 0, errors: 0 };

  let sims: { id: number }[];
  try {
    const res = await pgQuery(
      `SELECT id FROM pascal_simulations ${onlyActive ? "WHERE active = true" : ""} ORDER BY id`,
    );
    sims = res.rows;
  } catch (err) {
    logger.error({ err }, "runSuite: failed to load sim list");
    return stats;
  }

  stats.total = sims.length;
  logger.info({ count: sims.length, parallel: MAX_PARALLEL }, "Simulation suite: starting");

  // Bounded parallelism — chunk the list into batches of MAX_PARALLEL and
  // await each batch before starting the next. Simple, deterministic, no
  // promise-pool dependency.
  for (let i = 0; i < sims.length; i += MAX_PARALLEL) {
    const batch = sims.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(
      batch.map((s) => runSimulation(s.id, "cron").catch((err) => {
        logger.error({ err, simId: s.id }, "Simulation suite: sim threw");
        return { result: "error" } as RunOutcome;
      })),
    );
    for (const r of results) {
      if (r.result === "pass") stats.passed++;
      else if (r.result === "fail") stats.failed++;
      else if (r.result === "partial") stats.partial++;
      else stats.errors++;
    }
  }

  logger.info({ ...stats }, "Simulation suite: done");
  return stats;
}

// ── Job poller (handles dashboard "Run now" requests) ──────────────────

export function startJobPoller(): void {
  if (pollerHandle) return;
  pollerHandle = setInterval(pollOnce, POLLER_INTERVAL_MS);
  logger.info({ intervalMs: POLLER_INTERVAL_MS }, "Simulation job poller started");
}

export function stopJobPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
}

async function pollOnce(): Promise<void> {
  if (pollerRunning) return; // prevent re-entry if a job is still running
  pollerRunning = true;
  try {
    // Atomically claim the oldest pending job — SKIP LOCKED makes this safe
    // for the (unlikely but possible) case of two pollers running at once.
    const claim = await pgQuery(
      `UPDATE pascal_simulation_jobs
          SET status = 'running'
        WHERE id = (
          SELECT id FROM pascal_simulation_jobs
           WHERE status = 'pending'
           ORDER BY triggered_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, simulation_id, triggered_by`,
    );
    if (claim.rowCount === 0) return; // nothing pending

    const job = claim.rows[0] as { id: number; simulation_id: number; triggered_by: string | null };
    logger.info({ jobId: job.id, simId: job.simulation_id }, "Sim job: claimed");

    try {
      const outcome = await runSimulation(job.simulation_id, job.triggered_by ?? "dashboard");
      await pgQuery(
        `UPDATE pascal_simulation_jobs SET status = 'done', run_id = $1 WHERE id = $2`,
        [outcome.runId || null, job.id],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id }, "Sim job: failed");
      await pgQuery(
        `UPDATE pascal_simulation_jobs SET status = 'error', error = $1 WHERE id = $2`,
        [errMsg, job.id],
      );
    }
  } catch (err) {
    logger.warn({ err }, "Sim job poller: tick failed");
  } finally {
    pollerRunning = false;
  }
}

// ── Internals ──────────────────────────────────────────────────────────

async function loadSimulation(id: number): Promise<SimulationRow | null> {
  const res = await pgQuery(
    `SELECT id, name, procedure_id, scenario_description, customer_persona,
            opening_message, max_turns, expected_outcome, success_criteria,
            merchant_business_id, test_channel_id, last_result, owner
       FROM pascal_simulations
      WHERE id = $1`,
    [id],
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    ...row,
    success_criteria: Array.isArray(row.success_criteria)
      ? row.success_criteria
      : JSON.parse(row.success_criteria),
  };
}

async function persistRun(args: {
  simulation_id: number;
  result: "pass" | "fail" | "partial" | "error";
  judge: JudgeResult | null;
  transcript: TranscriptTurn[];
  turns: number;
  latencyMs: number;
  error: string | null;
  triggered_by: string;
}): Promise<number> {
  const res = await pgQuery(
    `INSERT INTO pascal_simulation_runs
       (simulation_id, result, judge_summary, judge_criteria, transcript,
        turns, latency_ms, error, triggered_by, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     RETURNING id`,
    [
      args.simulation_id,
      args.result,
      args.judge?.summary ?? null,
      args.judge?.criteria ? JSON.stringify(args.judge.criteria) : null,
      JSON.stringify(args.transcript),
      args.turns,
      args.latencyMs,
      args.error,
      args.triggered_by,
    ],
  );
  return res.rows[0].id as number;
}

async function updateSimLastResult(
  sim: SimulationRow,
  result: RunOutcome["result"],
  judge: JudgeResult | null,
): Promise<void> {
  // Reset consecutive_failures on pass/partial; increment on fail/error.
  if (result === "pass" || result === "partial") {
    await pgQuery(
      `UPDATE pascal_simulations
          SET last_result = $1,
              last_run_at = now(),
              last_failure_reason = NULL,
              consecutive_failures = 0,
              updated_at = now()
        WHERE id = $2`,
      [result, sim.id],
    );
  } else {
    await pgQuery(
      `UPDATE pascal_simulations
          SET last_result = $1,
              last_run_at = now(),
              last_failure_reason = $2,
              consecutive_failures = consecutive_failures + 1,
              updated_at = now()
        WHERE id = $3`,
      [result, judge?.summary ?? "no judgment", sim.id],
    );
  }
}

// ── Customer persona ───────────────────────────────────────────────────

async function askCustomerPersona(
  sim: SimulationRow,
  transcript: TranscriptTurn[],
): Promise<{ done: true } | { done: false; message: string }> {
  // Format the transcript so far for the persona
  const formatted = transcript
    .map((t) => (t.role === "customer" ? `You: ${t.text}` : `Pascal: ${t.text}`))
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 300,
    system: `${sim.customer_persona}

You are role-playing a single conversation with Pascal. Based on Pascal's most recent reply, decide what you do next:
  • If Pascal answered your question or you've gotten what you need, respond with done=true.
  • If Pascal asked you a clarifying question, answer it briefly and naturally.
  • If Pascal's reply is incomplete or wrong, push back briefly.
  • Stay in character. Match the language Pascal used. Keep replies under 2 sentences.

Respond with ONLY a JSON object: {"done": true} OR {"done": false, "message": "<your reply>"}`,
    messages: [
      {
        role: "user",
        content: `Conversation so far:\n\n${formatted}\n\nYour next move (JSON only):`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { done: true }; // safety bail
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed.done === true) return { done: true };
    if (parsed.done === false && typeof parsed.message === "string" && parsed.message.trim()) {
      return { done: false, message: parsed.message.trim() };
    }
    return { done: true };
  } catch {
    return { done: true };
  }
}

// ── Judge ──────────────────────────────────────────────────────────────

async function judgeTranscript(
  sim: SimulationRow,
  transcript: TranscriptTurn[],
): Promise<JudgeResult> {
  const formatted = transcript
    .map((t, i) =>
      `[${i + 1}] ${t.role === "customer" ? "Customer" : "Pascal"}: ${t.text}${t.error ? ` (ERROR: ${t.error})` : ""}`,
    )
    .join("\n\n");

  const criteriaList = sim.success_criteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  const prompt = `You are evaluating a Pascal regression simulation. Judge strictly but fairly — Pascal is a payment-support agent that the Tonder team relies on.

## Scenario
${sim.scenario_description}

## Expected outcome
${sim.expected_outcome}

## Success criteria
${criteriaList}

## Transcript
${formatted}

## Your task
For EACH criterion above, decide whether Pascal met it based on the transcript. Then return an overall result:
  • "pass" — all (or all-but-one minor) criteria met
  • "partial" — about half met, or critical criteria met but others missed
  • "fail" — most criteria missed, or the response was clearly wrong / harmful

Respond with ONLY a JSON object:
{
  "result": "pass" | "partial" | "fail",
  "summary": "<1-2 sentence overall assessment>",
  "criteria": [
    {"name": "<exact criterion text from above>", "met": true | false, "reason": "<brief evidence from transcript>"},
    ...
  ]
}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      result: "fail",
      summary: "Judge response was unparseable",
      criteria: sim.success_criteria.map((name) => ({ name, met: false, reason: "judge no-parse" })),
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as JudgeResult;
    if (!["pass", "fail", "partial"].includes(parsed.result)) {
      parsed.result = "fail";
    }
    if (!Array.isArray(parsed.criteria)) parsed.criteria = [];
    parsed.summary = parsed.summary ?? "";
    return parsed;
  } catch {
    return {
      result: "fail",
      summary: "Judge response was invalid JSON",
      criteria: sim.success_criteria.map((name) => ({ name, met: false, reason: "judge parse error" })),
    };
  }
}

// ── Linear failure ticket ──────────────────────────────────────────────

async function openFailureTicket(
  sim: SimulationRow,
  transcript: TranscriptTurn[],
  judge: JudgeResult | null,
  runId: number,
): Promise<string | null> {
  const failedCriteria = judge?.criteria.filter((c) => !c.met) ?? [];
  const transcriptText = transcript
    .slice(-8) // last 8 turns is plenty for a ticket
    .map((t) => `**${t.role === "customer" ? "Customer" : "Pascal"}:** ${t.text}${t.error ? ` *(error: ${t.error})*` : ""}`)
    .join("\n\n");

  const description = [
    `**Simulation**: ${sim.name}`,
    sim.procedure_id ? `**Procedure**: procedure id ${sim.procedure_id}` : `**Procedure**: free-form`,
    `**Owner**: ${sim.owner ?? "unassigned"}`,
    `**Judge summary**: ${judge?.summary ?? "(no judgment)"}`,
    "",
    "### Failed criteria",
    failedCriteria.length > 0
      ? failedCriteria.map((c) => `- ${c.name} — ${c.reason}`).join("\n")
      : "_(none — failed for other reasons)_",
    "",
    "### Transcript",
    transcriptText,
    "",
    `### Run`,
    `pascal_simulation_runs.id = ${runId}`,
    `View in /simulations`,
  ].join("\n");

  const ticket = await createTeamTicket({
    team: "sos",
    title: `[Sim] ${sim.name} failed`,
    description,
    priority: 3,
  });
  return ticket?.identifier ?? null;
}
