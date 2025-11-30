import { IMastraLogger } from '@mastra/core/logger';

/**
 * Schema for Discord sync tracker data
 */
export interface SyncTrackerData {
  version: number;
  lastMessageId: string;
  lastTimestamp: string; // ISO 8601 format
  lastAuthorIsTeamMember?: boolean; // Whether the last Discord message author has Admin or Mastra Team role
}

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

  return `**Discord Message** from ${author} at ${formattedTime}

${content}

[View in Discord](${messageUrl})

---
*This message was automatically synced from Discord*`;
}

/**
 * Creates or updates a sync tracker comment to prevent duplicate message syncing
 * Now uses JSON format for better extensibility
 */
export function createSyncTrackerComment(
  lastMessageId: string,
  lastTimestamp: Date,
  lastAuthorIsTeamMember?: boolean,
): string {
  const syncData: SyncTrackerData = {
    version: 1,
    lastMessageId,
    lastTimestamp: lastTimestamp.toISOString(),
    lastAuthorIsTeamMember,
  };

  const jsonString = JSON.stringify(syncData);
  
  return `<!-- DISCORD_SYNC: ${jsonString} -->

### Discord Sync Tracker

- **Last Message ID:** \`${lastMessageId}\`
- **Last Sync Timestamp:** ${lastTimestamp.toISOString()}${lastAuthorIsTeamMember !== undefined ? `\n- **Last Author is Team Member:** ${lastAuthorIsTeamMember ? 'Yes' : 'No'}` : ''}

---
*This tracker helps prevent duplicate message syncing from Discord*`;
}

/**
 * Parses a sync tracker comment to extract last synced message info
 * Expects JSON format (legacy format has been migrated)
 */
export function parseSyncTrackerComment(
  commentBody: string,
): { lastMessageId: string; lastTimestamp: Date; lastAuthorIsTeamMember?: boolean } | null {
  const jsonRegex = /<!-- DISCORD_SYNC: ({.+?}) -->/;
  const jsonMatch = commentBody.match(jsonRegex);

  if (!jsonMatch) return null;

  try {
    const syncData: SyncTrackerData = JSON.parse(jsonMatch[1]);
    return {
      lastMessageId: syncData.lastMessageId,
      lastTimestamp: new Date(syncData.lastTimestamp),
      lastAuthorIsTeamMember: syncData.lastAuthorIsTeamMember,
    };
  } catch (error) {
    console.error('Failed to parse JSON sync tracker:', error);
    return null;
  }
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