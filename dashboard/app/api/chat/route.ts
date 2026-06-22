/**
 * /api/chat — Pascal Concierge chat endpoint.
 *
 * Architecture:
 *   1. Read session cookie → extract verified business_id.
 *   2. POST to the orchestrator service (PASCAL_WEB_API_URL/internal/web-chat)
 *      with the shared internal token.
 *   3. The orchestrator runs the SAME pipeline used by Slack/Telegram
 *      (gate, refine, retrieve, tools, validate, audit), then returns
 *      the merchant-safe response text + any file attachments.
 *   4. We forward the response back to the client.
 *
 * This dashboard does NOT run its own Anthropic client, does NOT touch
 * MongoDB directly, and does NOT have any tool surface of its own. The
 * orchestrator is the single source of truth for the merchant-facing
 * model behavior.
 *
 * NOTE: when the chat UI is later embedded inside Tonder's existing
 * dashboard.tonder.io, that backend mints the same business_id session
 * token via the same HMAC secret — this route still works unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/auth";

const ORCHESTRATOR_URL = process.env.PASCAL_WEB_API_URL ?? "http://localhost:8080";
const INTERNAL_TOKEN = process.env.PASCAL_INTERNAL_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const session = await readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!INTERNAL_TOKEN) {
    return NextResponse.json(
      { error: "Server misconfigured: missing PASCAL_INTERNAL_TOKEN" },
      { status: 500 },
    );
  }

  let body: { text?: unknown; user_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Text required" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${ORCHESTRATOR_URL}/internal/web-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        business_id: session.business_id,
        text,
        user_id: `web-${session.business_id}`,
        user_name:
          typeof body.user_name === "string" ? body.user_name : undefined,
      }),
    });

    const data = await upstream.json().catch(() => ({ error: "Bad upstream response" }));
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("chat proxy error:", err);
    return NextResponse.json(
      { error: "Orchestrator unreachable" },
      { status: 502 },
    );
  }
}
