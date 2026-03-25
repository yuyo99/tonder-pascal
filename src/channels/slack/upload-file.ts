/**
 * Raw HTTP file upload to Slack — bypasses filesUploadV2 SDK issues.
 * Uses the 3-step upload flow:
 *   1. files.getUploadURLExternal → get presigned URL + file_id
 *   2. POST buffer to the presigned URL
 *   3. files.completeUploadExternal → finalize + share to channel
 */

import { logger } from "../../utils/logger";

interface UploadOptions {
  threadTs?: string;
  title?: string;
}

export async function uploadFileToSlack(
  token: string,
  channelId: string,
  buffer: Buffer,
  filename: string,
  opts?: UploadOptions,
): Promise<void> {
  logger.info({ filename, bufferSize: buffer.length, channel: channelId, hasThread: !!opts?.threadTs }, "Starting 3-step Slack file upload");

  if (!buffer || buffer.length === 0) {
    throw new Error("Cannot upload empty buffer");
  }

  // Step 1: Get upload URL
  const urlRes = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      filename,
      length: String(buffer.length),
    }),
  });

  const urlData = (await urlRes.json()) as {
    ok: boolean;
    upload_url?: string;
    file_id?: string;
    error?: string;
  };

  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
    throw new Error(`files.getUploadURLExternal failed: ${urlData.error || "unknown"}`);
  }

  logger.info({ fileId: urlData.file_id, filename, size: buffer.length }, "Got Slack upload URL");

  // Step 2: Upload file content to presigned URL
  const uploadRes = await fetch(urlData.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`File upload to presigned URL failed: ${uploadRes.status} ${uploadRes.statusText}`);
  }

  // Step 3: Complete upload and share to channel
  const completeBody: {
    files: { id: string; title?: string }[];
    channel_id: string;
    thread_ts?: string;
  } = {
    files: [{ id: urlData.file_id, title: opts?.title || filename }],
    channel_id: channelId,
  };

  if (opts?.threadTs) {
    completeBody.thread_ts = opts.threadTs;
  }

  const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(completeBody),
  });

  const completeData = (await completeRes.json()) as { ok: boolean; error?: string };

  if (!completeData.ok) {
    throw new Error(`files.completeUploadExternal failed: ${completeData.error || "unknown"}`);
  }

  logger.info({ fileId: urlData.file_id, filename, channel: channelId }, "File uploaded to Slack successfully");
}
