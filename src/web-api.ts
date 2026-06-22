/**
 * Internal HTTP API for the Pascal Concierge dashboard.
 *
 * Exposes ONE endpoint:
 *
 *   POST /internal/web-chat
 *     Headers:
 *       Authorization: Bearer ${PASCAL_INTERNAL_TOKEN}
 *     Body:
 *       { business_id: number, text: string, user_id?: string, user_name?: string }
 *     Response:
 *       { text: string, attachments?: [{ filename, base64 }] }
 *
 * The dashboard's /api/chat route extracts business_id from the merchant
 * session and POSTs here. The shared bearer token (set in both Railway
 * services' env) prevents anyone but the dashboard from invoking the
 * orchestrator over the network.
 *
 * The endpoint synthesizes a web IncomingMessage and calls
 * handleIncomingMessage — same code path as Slack/Telegram. The
 * orchestrator's "web" branch in resolveMerchantContext skips the
 * channel lookup and trusts the business_id baked into channelId.
 *
 * Listens on PASCAL_WEB_API_PORT (default 8080).
 */

import * as http from "node:http";
import { handleIncomingMessage } from "./core/orchestrator";
import { IncomingMessage as PascalMessage } from "./channels/types";
import { logger } from "./utils/logger";

const PORT = Number(process.env.PASCAL_WEB_API_PORT ?? 8080);

function getInternalToken(): string {
  const t = process.env.PASCAL_INTERNAL_TOKEN;
  if (!t) {
    throw new Error("Missing PASCAL_INTERNAL_TOKEN env var");
  }
  return t;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // Cap inbound body at 64KB — keep simple, this is a chat turn.
      if (raw.length > 64_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

async function handleWebChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const auth = req.headers.authorization;
  let expectedToken: string;
  try {
    expectedToken = getInternalToken();
  } catch (err) {
    logger.error({ err }, "web-api: token misconfiguration");
    send(res, 500, { error: "Server misconfigured" });
    return;
  }
  if (!auth || auth !== `Bearer ${expectedToken}`) {
    send(res, 401, { error: "Unauthorized" });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    logger.warn({ err }, "web-api: bad body");
    send(res, 400, { error: "Invalid JSON body" });
    return;
  }
  const { business_id, text, user_id, user_name } = body as {
    business_id?: unknown;
    text?: unknown;
    user_id?: unknown;
    user_name?: unknown;
  };

  const businessId = Number(business_id);
  if (!Number.isFinite(businessId) || businessId <= 0) {
    send(res, 400, { error: "Valid business_id required" });
    return;
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    send(res, 400, { error: "Text required" });
    return;
  }

  const msg: PascalMessage = {
    channelId: `web:${businessId}`,
    platform: "web",
    userId: typeof user_id === "string" ? user_id : `web-${businessId}`,
    userName: typeof user_name === "string" ? user_name : "merchant",
    text,
    rawEvent: { source: "web-api" },
  };

  try {
    const response = await handleIncomingMessage(msg);
    const payload: { text: string; attachments?: { filename: string; base64: string }[] } = {
      text: response.text,
    };
    if (response.attachments && response.attachments.length > 0) {
      payload.attachments = response.attachments.map((a) => ({
        filename: a.filename,
        base64: a.buffer.toString("base64"),
      }));
    }
    send(res, 200, payload);
  } catch (err) {
    logger.error({ err, businessId }, "web-api: handler failed");
    send(res, 500, { error: "Internal error" });
  }
}

export function startWebApi(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/internal/web-chat") {
      void handleWebChat(req, res);
      return;
    }
    if (req.method === "GET" && req.url === "/internal/health") {
      send(res, 200, { ok: true });
      return;
    }
    send(res, 404, { error: "Not found" });
  });
  server.listen(PORT, () => {
    logger.info({ port: PORT }, "web-api listening");
  });
  return server;
}
