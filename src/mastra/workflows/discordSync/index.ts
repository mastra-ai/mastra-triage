import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../../shared/github';
import { getDiscordClient } from '../../shared/discord';
import {
  extractDiscordThreadId,
  createDiscordSyncComment,
  parseSyncTrackerComment,
  logError,
  SyncedMessage,
} from '../githubIssueManager/helpers';
import { Message } from 'discord.js';

const owner = 'mastra-ai';
const repo = 'mastra';

/**
 * Schema for a single GitHub issue
 */
const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  updated_at: z.string(),
  html_url: z.string(),
  labels: z.array(z.object({
    name: z.string(),
  })),
});

/**
 * Step 1: Fetch all open GitHub issues with the "discord" label
 * This retrieves issues that have associated Discord threads that need syncing
 */
const fetchDiscordLabeledIssuesStep = createStep({
  id: 'fetch-discord-labeled-issues',
  inputSchema: z.object({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
  }),
  outputSchema: z.object({
    issues: z.array(issueSchema),
    count: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();

    try {
      logger?.info('Fetching all issues with "discord" label...');

      const allIssues = [];
      let page = 1;
      let hasMore = true;

      // Fetch all pages of issues with "discord" label
      while (hasMore) {
        const { data: issues } = await octokit.rest.issues.listForRepo({
          owner: inputData.owner,
          repo: inputData.repo,
          labels: 'discord',
          state: 'open',
          per_page: 100,
          page,
          sort: 'updated',
          direction: 'desc',
        });

        if (issues.length === 0) {
          hasMore = false;
        } else {
          allIssues.push(...issues);
          page++;
          logger?.debug(`Fetched page ${page - 1}, total issues so far: ${allIssues.length}`);
        }
      }

      logger?.info(`Found ${allIssues.length} issues with "discord" label`);

      return {
        issues: allIssues.map(issue => ({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
          labels: issue.labels?.map(label => ({
            name: typeof label === 'string' ? label : label.name || '',
          })) || [],
        })),
        count: allIssues.length,
      };
    } catch (error) {
      logError(logger, 'Error fetching issues with discord label', error);
      throw error;
    }
  },
});

/**
 * Step 2: Sync Discord messages to a single GitHub issue
 * 
 * This step:
 * 1. Extracts the Discord thread ID from the issue body
 * 2. Fetches existing comments to find the sync tracker
 * 3. Retrieves Discord messages from the thread
 * 4. Filters for new messages since last sync
 * 5. Posts new messages as GitHub comments
 * 6. Updates the sync tracker comment
 */
const syncIssueMessagesStep = createStep({
  id: 'sync-issue-messages',
  inputSchema: issueSchema.extend({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
  }),
  outputSchema: z.object({
    issueNumber: z.number(),
    hasDiscordThread: z.boolean(),
    threadId: z.string().nullable(),
    messagesSynced: z.number(),
    success: z.boolean(),
    error: z.string().nullable(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    // Extract Discord thread ID from issue body
    const threadId = extractDiscordThreadId(inputData.body);

    if (!threadId) {
      logger?.debug(`Issue #${inputData.number}: No Discord thread URL found in body`);
      return {
        issueNumber: inputData.number,
        hasDiscordThread: false,
        threadId: null,
        messagesSynced: 0,
        success: true,
        error: null,
      };
    }

    logger?.info(`Issue #${inputData.number}: Found Discord thread ${threadId}`);

    try {
      const discordClient = await getDiscordClient(logger);
      const octokit = getGithubClient();

      // Fetch the Discord thread/channel
      const thread = await discordClient.channels.fetch(threadId);

      if (!thread?.isThread()) {
        const errorMsg = `Channel ${threadId} is not a thread`;
        logger?.error(`Issue #${inputData.number}: ${errorMsg}`);
        return {
          issueNumber: inputData.number,
          hasDiscordThread: true,
          threadId,
          messagesSynced: 0,
          success: false,
          error: errorMsg,
        };
      }

      // Fetch existing GitHub comments to find sync tracker
      const { data: comments } = await octokit.rest.issues.listComments({
        owner: inputData.owner,
        repo: inputData.repo,
        issue_number: inputData.number,
        per_page: 100,
      });

      // Find the sync tracker comment
      const syncTrackerComment = comments.find(comment =>
        comment.body?.includes('<!-- DISCORD_SYNC:'),
      );

      let lastSyncedMessageId: string | null = null;
      let syncTrackerCommentId: number | null = null;
      let previousAuthorIsTeamMember: boolean | undefined = undefined;
      let existingMessages: SyncedMessage[] = [];

      if (syncTrackerComment) {
        const syncInfo = parseSyncTrackerComment(syncTrackerComment.body || '');
        if (syncInfo) {
          lastSyncedMessageId = syncInfo.lastMessageId;
          syncTrackerCommentId = syncTrackerComment.id;
          previousAuthorIsTeamMember = syncInfo.lastAuthorIsTeamMember;
          existingMessages = syncInfo.messages || [];
          logger?.debug(
            `Issue #${inputData.number}: Found sync tracker, last message ID: ${lastSyncedMessageId}, existing messages: ${existingMessages.length}`,
          );
        } else {
          logger?.debug(
            `Issue #${inputData.number}: Could not parse sync tracker, will fetch all messages`,
          );
        }
      } else {
        // No sync tracker found, fetch all messages from the beginning
        logger?.debug(
          `Issue #${inputData.number}: No sync tracker found, will fetch all messages from thread start`,
        );
      }

      // Fetch messages from Discord thread
      // If we have a last synced message ID, only fetch messages after it
      // Otherwise, fetch all messages from the beginning
      const fetchOptions: { limit: 100; after?: string } = { limit: 100 };
      if (lastSyncedMessageId) {
        fetchOptions.after = lastSyncedMessageId;
        logger?.debug(
          `Issue #${inputData.number}: Fetching messages after Discord message ID ${lastSyncedMessageId}`,
        );
      } else {
        logger?.debug(
          `Issue #${inputData.number}: Fetching all messages from thread start`,
        );
      }
      const messages = await thread.messages.fetch(fetchOptions);

      // Filter out messages without content, messages from bots/apps, and sort oldest first
      // No need to filter by timestamp since Discord API already returns messages after the specified ID
      const newMessages = Array.from(messages.values())
        .filter((msg: Message) => msg.content.length > 0 && !msg.author.bot) // Only messages with content from non-bot users
        .sort((a: Message, b: Message) => a.createdAt.getTime() - b.createdAt.getTime()); // Oldest first

      let lastAuthorIsTeamMember: boolean | undefined = previousAuthorIsTeamMember;
      let allMessages: SyncedMessage[] = [...existingMessages];

      if (newMessages.length === 0) {
        logger?.info(`Issue #${inputData.number}: No new Discord messages to sync`);
      } else {
        logger?.info(
          `Issue #${inputData.number}: Syncing ${newMessages.length} new Discord messages`,
        );

        // Convert new Discord messages to SyncedMessage format and add to array
        for (const message of newMessages) {
          const syncedMessage: SyncedMessage = {
            id: message.id,
            author: message.author.username,
            content: message.content,
            timestamp: message.createdAt.toISOString(),
            messageUrl: message.url,
          };
          allMessages.push(syncedMessage);
        }

        // Check if the last message author has Admin or Mastra Team role
        const lastMessage = newMessages[newMessages.length - 1];
        
        try {
          const guildId = thread.guild?.id;
          if (guildId) {
            const member = await thread.guild.members.fetch(lastMessage.author.id);
            lastAuthorIsTeamMember = member.roles.cache.some(
              role => role.name === 'Admin' || role.name === 'Mastra Team'
            );
            logger?.debug(
              `Issue #${inputData.number}: Last message author ${lastMessage.author.username} is team member: ${lastAuthorIsTeamMember}`,
            );
          }
        } catch (error) {
          logError(logger, `Error checking Discord member roles for issue #${inputData.number}`, error);
        }
      }

      // Build the Discord thread URL
      const threadUrl = `https://discord.com/channels/${thread.guild?.id}/${threadId}`;

      // Update or create the single sync comment with all messages
      if (allMessages.length > 0) {
        const syncCommentBody = createDiscordSyncComment(
          threadUrl,
          allMessages,
          lastAuthorIsTeamMember,
        );

        if (syncTrackerCommentId) {
          // Update existing comment with all messages
          await octokit.rest.issues.updateComment({
            owner: inputData.owner,
            repo: inputData.repo,
            comment_id: syncTrackerCommentId,
            body: syncCommentBody,
          });
          logger?.debug(`Issue #${inputData.number}: Updated sync comment with ${allMessages.length} total messages`);
        } else {
          // Create new sync comment
          await octokit.rest.issues.createComment({
            owner: inputData.owner,
            repo: inputData.repo,
            issue_number: inputData.number,
            body: syncCommentBody,
          });
          logger?.debug(`Issue #${inputData.number}: Created sync comment with ${allMessages.length} messages`);
        }
      } else {
        logger?.debug(`Issue #${inputData.number}: No messages to sync, skipping comment update`);
      }

      logger?.info(
        `Issue #${inputData.number}: Successfully synced ${newMessages.length} Discord messages`,
      );

      return {
        issueNumber: inputData.number,
        hasDiscordThread: true,
        threadId,
        messagesSynced: newMessages.length,
        success: true,
        error: null,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logError(logger, `Error syncing Discord messages for issue #${inputData.number}`, error);
      return {
        issueNumber: inputData.number,
        hasDiscordThread: true,
        threadId,
        messagesSynced: 0,
        success: false,
        error: errorMsg,
      };
    }
  },
});

/**
 * Main Discord Sync Workflow
 *
 * Fetches ALL GitHub issues with the "discord" label and syncs Discord thread messages
 * to the corresponding GitHub issue comments. Uses the sync tracker to avoid duplicates.
 * Processes up to 10 issues concurrently.
 *
 * @param owner - GitHub repository owner (default: mastra-ai)
 * @param repo - GitHub repository name (default: mastra)
 *
 * @returns Summary statistics including:
 * - issuesProcessed: Total number of issues processed
 * - issuesWithThreads: Number of issues that have Discord threads
 * - messagesSynced: Total number of messages synced across all issues
 * - issuesSkipped: Issues without Discord thread URLs
 * - errors: Number of issues that failed to sync
 * - success: Overall workflow success status
 */
export const discordSyncWorkflow = createWorkflow({
  id: 'discord-sync',
  inputSchema: z.object({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
  }),
  outputSchema: z.object({
    issuesProcessed: z.number(),
    issuesWithThreads: z.number(),
    messagesSynced: z.number(),
    issuesSkipped: z.number(),
    errors: z.number(),
    success: z.boolean(),
  }),
})
  .then(fetchDiscordLabeledIssuesStep)
  .map(async ({ inputData: { issues }, getInitData, mastra }) => {
    const logger = mastra?.getLogger();
    const { owner, repo } = getInitData<any>();
    
    // Filter to keep only issues with required status labels
    const requiredLabels = ['status: waiting for author', 'status: needs reproduction'];
    const filteredIssues = issues.filter(issue => {
      const hasRequiredLabel = issue.labels.some(label =>
        requiredLabels.includes(label.name)
      );
      return hasRequiredLabel;
    });
    
    logger?.info(
      `Filtered issues: ${filteredIssues.length} out of ${issues.length} have required status labels`
    );
    
    return filteredIssues.map(issue => ({ ...issue, owner, repo }));
  })
  .foreach(syncIssueMessagesStep, { concurrency: 10 })
  .map(async ({ inputData: results }) => {
    const issuesWithThreads = results.filter(r => r.hasDiscordThread).length;
    const messagesSynced = results.reduce((sum, r) => sum + r.messagesSynced, 0);
    const issuesSkipped = results.filter(r => !r.hasDiscordThread).length;
    const errors = results.filter(r => !r.success).length;

    return {
      issuesProcessed: results.length,
      issuesWithThreads,
      messagesSynced,
      issuesSkipped,
      errors,
      success: errors === 0,
    };
  })
  .commit();