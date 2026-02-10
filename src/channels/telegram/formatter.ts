/**
 * Escape special characters for Telegram MarkdownV2.
 * Characters that need escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Convert Slack-style markdown to Telegram MarkdownV2.
 * Basic conversions: *bold* stays, _italic_ stays, `code` stays.
 */
export function slackToTelegram(text: string): string {
  // For now, just escape special chars that aren't part of markdown
  // Telegram MarkdownV2 is strict — we'll use HTML parse mode instead
  return text;
}
