import { IMastraLogger } from '@mastra/core/logger';

/**
 * Extracts Discord thread/channel ID from a GitHub issue body
 * Supports both badge markdown format and plain Discord URLs
 */
export function extractDiscordThreadId(issueBody: string | null): string | null {
  if (!issueBody) return null;

  // Try to match Discord URL in any format (badge or plain)
  // Pattern matches: https://discord.com/channels/{guild_id}/{thread_id}
  const discordUrlRegex = /https:\/\/discord\.com\/channels\/\d+\/(\d+)/;
  const match = issueBody.match(discordUrlRegex);

  return match ? match[1] : null;
}

/**
 * Formats a Discord message for posting as a GitHub comment
 */
export function formatDiscordMessageAsComment(
  author: string,
  content: string,
  timestamp: Date,
  messageUrl: string,
): string {
  const formattedTime = timestamp.toISOString();

  return `**Discord Message** from @${author} at ${formattedTime}

${content}

[View in Discord](${messageUrl})

---
*This message was automatically synced from Discord*`;
}

/**
 * Creates or updates a sync tracker comment to prevent duplicate message syncing
 */
export function createSyncTrackerComment(lastMessageId: string, lastTimestamp: Date): string {
  return `<!-- DISCORD_SYNC: last_message_id=${lastMessageId}, last_timestamp=${lastTimestamp.toISOString()} -->

Last Discord sync: ${lastTimestamp.toISOString()}`;
}

/**
 * Parses a sync tracker comment to extract last synced message info
 */
export function parseSyncTrackerComment(
  commentBody: string,
): { lastMessageId: string; lastTimestamp: Date } | null {
  const syncRegex = /<!-- DISCORD_SYNC: last_message_id=(\S+), last_timestamp=(\S+) -->/;
  const match = commentBody.match(syncRegex);

  if (!match) return null;

  return {
    lastMessageId: match[1],
    lastTimestamp: new Date(match[2]),
  };
}

/**
 * Logs an error with context but doesn't throw
 */
export function logError(logger: IMastraLogger | undefined, context: string, error: unknown): void {
  if (logger) {
    logger.error(`${context}:`, error);
  } else {
    console.error(`${context}:`, error);
  }
}