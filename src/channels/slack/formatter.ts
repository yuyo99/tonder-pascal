import type { KnownBlock, Block } from "@slack/web-api";

export function formatResponse(answer: string): (KnownBlock | Block)[] {
  const blocks: (KnownBlock | Block)[] = [];

  const chunks = splitText(answer, 2900);
  for (const chunk of chunks) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: chunk },
    });
  }

  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Pascal | ${now} CST`,
      },
    ],
  });

  return blocks;
}

export function formatError(error: string): (KnownBlock | Block)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Something went wrong while processing your request:\n\`\`\`${error}\`\`\`\nPlease try again or contact Tonder support.`,
      },
    },
  ];
}

export function formatThinking(): (KnownBlock | Block)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Let me look into that... :hourglass_flowing_sand:",
      },
    },
  ];
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
