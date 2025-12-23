import { IMastraLogger } from '@mastra/core/logger';

/**
 * Schema for a synced Discord message
 */
export interface SyncedMessage {
  id: string;
  author: string;
  content: string;
  timestamp: string; // ISO 8601 format
  messageUrl: string;
}

/**
 * Schema for Discord sync tracker data
 */
export interface SyncTrackerData {
  version: number;
  lastMessageId: string;
  lastTimestamp: string; // ISO 8601 format
  lastAuthorIsTeamMember?: boolean; // Whether the last Discord message author has Admin or Mastra Team role
  messages: SyncedMessage[]; // All synced messages for the collapsible UI
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
 * Formats a relative time string like "2 hours ago" or "Dec 22"
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) {
    return diffMins <= 1 ? 'just now' : `${diffMins} minutes ago`;
  } else if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  } else if (diffDays < 7) {
    return diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Formats a single Discord message as a collapsible section
 */
function formatMessageAsCollapsible(message: SyncedMessage): string {
  const date = new Date(message.timestamp);
  const timeStr = formatRelativeTime(date);

  return `<details>
<summary><a href="${message.messageUrl}">${message.author}</a> · ${timeStr}</summary>

${message.content}

</details>`;
}

/**
 * Creates the unified Discord sync comment with collapsible message sections
 * This replaces multiple individual comments with a single, expandable comment
 */
export function createDiscordSyncComment(
  threadUrl: string,
  messages: SyncedMessage[],
  lastAuthorIsTeamMember?: boolean,
): string {
  const lastMessage = messages[messages.length - 1];
  const lastTimestamp = lastMessage ? new Date(lastMessage.timestamp) : new Date();

  const syncData: SyncTrackerData = {
    version: 2,
    lastMessageId: lastMessage?.id || '',
    lastTimestamp: lastTimestamp.toISOString(),
    lastAuthorIsTeamMember,
    messages,
  };

  const jsonString = JSON.stringify(syncData);

  // Format all messages as collapsible sections
  const messagesSections = messages.map(formatMessageAsCollapsible).join('\n\n');

  const messageCount = messages.length;
  const messageText = messageCount === 1 ? '1 message' : `${messageCount} messages`;

  return `<!-- DISCORD_SYNC: ${jsonString} -->
## 💬 Discord Activity

<details>
<summary><strong>${messageText}</strong> synced from Discord</summary>

${messagesSections || '_No messages synced yet_'}

</details>

---
<sub>🔗 <a href="${threadUrl}">View thread in Discord</a> · Last synced: ${lastTimestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</sub>`;
}

/**
 * Parses a sync tracker comment to extract last synced message info and all messages
 * Supports both v1 (without messages) and v2 (with messages array) formats
 */
export function parseSyncTrackerComment(commentBody: string): {
  lastMessageId: string;
  lastTimestamp: Date;
  lastAuthorIsTeamMember?: boolean;
  messages: SyncedMessage[];
  version: number;
} | null {
  const jsonRegex = /<!-- DISCORD_SYNC: ({.+?}) -->/;
  const jsonMatch = commentBody.match(jsonRegex);

  if (!jsonMatch) return null;

  try {
    const syncData: SyncTrackerData = JSON.parse(jsonMatch[1]);
    return {
      lastMessageId: syncData.lastMessageId,
      lastTimestamp: new Date(syncData.lastTimestamp),
      lastAuthorIsTeamMember: syncData.lastAuthorIsTeamMember,
      messages: syncData.messages || [],
      version: syncData.version || 1,
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
