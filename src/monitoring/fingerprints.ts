/**
 * Incident fingerprinting — deduplicate alerts by unique failure signature.
 * Format: ${platform}:${channelId}:${messageType}:${failureReason}
 */

export function buildFingerprint(
  platform: string,
  channelId: string,
  messageType: string,
  failureReason: string,
): string {
  const sanitize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 80);
  return `${sanitize(platform)}:${sanitize(channelId)}:${sanitize(messageType)}:${sanitize(failureReason)}`;
}

// Common fingerprints
export const HEARTBEAT_MISSING = "system:global:heartbeat:missing";
export const HEARTBEAT_STALE = "system:global:heartbeat:stale";
