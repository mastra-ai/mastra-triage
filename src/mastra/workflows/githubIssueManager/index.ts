import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../../shared/github';
import { getDiscordClient } from '../../shared/discord';
import { getMemberByLogin } from '../../constants/members';
import {
  extractDiscordThreadId,
  formatDiscordMessageAsComment,
  createSyncTrackerComment,
  parseSyncTrackerComment,
  logError,
} from './helpers';
import { Message } from 'discord.js';

const owner = 'mastra-ai';
const repo = 'mastra';

// Schema for a single issue to process
const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  updated_at: z.string(),
  html_url: z.string(),
});

// Step 1: Fetch issues with "status: waiting for author" label
const fetchWaitingIssuesStep = createStep({
  id: 'fetch-waiting-issues',
  inputSchema: z.object({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
    batchSize: z.number().default(100),
  }),
  outputSchema: z.object({
    issues: z.array(issueSchema),
    count: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();

    try {
      logger?.info('Fetching issues with "status: waiting for author" or "status: needs reproduction" labels...');

      // Fetch issues with both labels
      const labelsToFetch = ['status: waiting for author', 'status: needs reproduction'];
      const allIssues = [];

      for (const label of labelsToFetch) {
        const { data: labelIssues } = await octokit.rest.issues.listForRepo({
          owner: inputData.owner,
          repo: inputData.repo,
          labels: label,
          state: 'open',
          per_page: inputData.batchSize,
          sort: 'updated',
          direction: 'desc',
        });
        allIssues.push(...labelIssues);
      }

      // Remove duplicates (in case an issue has both labels)
      const uniqueIssues = Array.from(
        new Map(allIssues.map(issue => [issue.number, issue])).values(),
      );

      logger?.info(`Found ${uniqueIssues.length} issues with target labels (${labelsToFetch.join(', ')})`);

      return {
        issues: uniqueIssues.map(issue => ({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
        })),
        count: uniqueIssues.length,
      };
    } catch (error) {
      logError(logger, 'Error fetching issues', error);
      throw error;
    }
  },
});

// Step 2: Check last comment author and add label if needed
const checkCommentAuthorStep = createStep({
  id: 'check-comment-author',
  inputSchema: issueSchema.extend({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
  }),
  outputSchema: z.object({
    needsFollowUp: z.boolean(),
    lastCommentAuthor: z.string().nullable(),
    labelAdded: z.boolean(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();

    try {
      // Fetch all comments for this issue
      const { data: comments } = await octokit.rest.issues.listComments({
        owner: inputData.owner,
        repo: inputData.repo,
        issue_number: inputData.number,
        per_page: 100,
      });

      // Filter out bot comments
      const humanComments = comments.filter(comment => comment.user?.type !== 'Bot');

      if (humanComments.length === 0) {
        logger?.debug(`Issue #${inputData.number}: No human comments found`);
        return {
          needsFollowUp: false,
          lastCommentAuthor: null,
          labelAdded: false,
        };
      }

      // Get the last human comment
      const lastComment = humanComments[humanComments.length - 1];
      const lastAuthor = lastComment.user?.login || null;

      if (!lastAuthor) {
        logger?.debug(`Issue #${inputData.number}: Last comment has no author`);
        return {
          needsFollowUp: false,
          lastCommentAuthor: null,
          labelAdded: false,
        };
      }

      // Check if author is a Mastra member
      const isMember = getMemberByLogin(lastAuthor) !== undefined;

      logger?.debug(
        `Issue #${inputData.number}: Last comment from ${lastAuthor} (isMember: ${isMember})`,
      );

      if (!isMember) {
        // Add "status: needs follow up" label
        try {
          await octokit.rest.issues.addLabels({
            owner: inputData.owner,
            repo: inputData.repo,
            issue_number: inputData.number,
            labels: ['status: needs follow up'],
          });

          logger?.info(`Issue #${inputData.number}: Added "status: needs follow up" label`);

          return {
            needsFollowUp: true,
            lastCommentAuthor: lastAuthor,
            labelAdded: true,
          };
        } catch (error) {
          logError(logger, `Error adding label to issue #${inputData.number}`, error);
          return {
            needsFollowUp: true,
            lastCommentAuthor: lastAuthor,
            labelAdded: false,
          };
        }
      }

      return {
        needsFollowUp: false,
        lastCommentAuthor: lastAuthor,
        labelAdded: false,
      };
    } catch (error) {
      logError(logger, `Error checking comments for issue #${inputData.number}`, error);
      return {
        needsFollowUp: false,
        lastCommentAuthor: null,
        labelAdded: false,
      };
    }
  },
});

// Step 3: Sync Discord messages to GitHub
const syncDiscordMessagesStep = createStep({
  id: 'sync-discord-messages',
  inputSchema: issueSchema.extend({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
  }),
  outputSchema: z.object({
    hasDiscordThread: z.boolean(),
    messagesSynced: z.number(),
    threadId: z.string().nullable(),
    lastDiscordAuthorHasMastraRole: z.boolean().nullable(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    // Extract Discord thread ID from issue body
    const threadId = extractDiscordThreadId(inputData.body);

    if (!threadId) {
      logger?.debug(`Issue #${inputData.number}: No Discord thread URL found`);
      return {
        hasDiscordThread: false,
        messagesSynced: 0,
        threadId: null,
        lastDiscordAuthorHasMastraRole: null,
      };
    }

    logger?.info(`Issue #${inputData.number}: Found Discord thread ${threadId}`);

    try {
      const discordClient = await getDiscordClient(logger);
      const octokit = getGithubClient();

      // Fetch the Discord thread
      const thread = await discordClient.channels.fetch(threadId);

      if (!thread?.isThread()) {
        logger?.error(`Issue #${inputData.number}: Channel ${threadId} is not a thread`);
        return {
          hasDiscordThread: true,
          messagesSynced: 0,
          threadId,
          lastDiscordAuthorHasMastraRole: null,
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

      let lastSyncedTimestamp: Date;
      let syncTrackerCommentId: number | null = null;

      if (syncTrackerComment) {
        const syncInfo = parseSyncTrackerComment(syncTrackerComment.body || '');
        if (syncInfo) {
          lastSyncedTimestamp = syncInfo.lastTimestamp;
          syncTrackerCommentId = syncTrackerComment.id;
          logger?.debug(
            `Issue #${inputData.number}: Found sync tracker, last sync at ${lastSyncedTimestamp.toISOString()}`,
          );
        } else {
          // Use issue update time if we can't parse the tracker
          lastSyncedTimestamp = new Date(inputData.updated_at);
          logger?.debug(
            `Issue #${inputData.number}: Could not parse sync tracker, using issue updated_at`,
          );
        }
      } else {
        // No sync tracker found, use issue creation/update time
        lastSyncedTimestamp = new Date(inputData.updated_at);
        logger?.debug(
          `Issue #${inputData.number}: No sync tracker found, using issue updated_at ${lastSyncedTimestamp.toISOString()}`,
        );
      }

      // Fetch messages from Discord thread
      const messages = await thread.messages.fetch({ limit: 100 });

      // Filter for messages newer than last sync
      const newMessages = Array.from(messages.values())
        .filter((msg: Message) => msg.createdAt > lastSyncedTimestamp)
        .filter((msg: Message) => msg.content.length > 0) // Only messages with content
        .sort((a: Message, b: Message) => a.createdAt.getTime() - b.createdAt.getTime()); // Oldest first

      // Check if there are any messages at all in the thread
      const allMessagesArray = Array.from(messages.values());
      
      if (newMessages.length === 0) {
        logger?.info(`Issue #${inputData.number}: No new Discord messages to sync`);
        
        // Check the last message author's role even if no new messages
        let lastDiscordAuthorHasMastraRole: boolean | null = null;
        if (allMessagesArray.length > 0) {
          const lastMessage = allMessagesArray[0]; // Messages are sorted newest first
          try {
            const guildId = thread.guild?.id;
            if (guildId) {
              const member = await thread.guild.members.fetch(lastMessage.author.id);
              const hasMastraRole = member.roles.cache.some(role => role.name === 'Admin' || role.name === 'Mastra Team');
              lastDiscordAuthorHasMastraRole = hasMastraRole;
              logger?.debug(
                `Issue #${inputData.number}: Last Discord author ${lastMessage.author.username} has Admin or Mastra Team role: ${hasMastraRole}`,
              );
            }
          } catch (error) {
            logError(logger, `Error checking Discord member roles for issue #${inputData.number}`, error);
          }
        }
        
        return {
          hasDiscordThread: true,
          messagesSynced: 0,
          threadId,
          lastDiscordAuthorHasMastraRole,
        };
      }

      logger?.info(
        `Issue #${inputData.number}: Syncing ${newMessages.length} new Discord messages`,
      );

      // Post each message as a GitHub comment
      for (const message of newMessages) {
        const author = message.author.username;
        const content = message.content;
        const timestamp = message.createdAt;
        const messageUrl = message.url;

        const commentBody = formatDiscordMessageAsComment(author, content, timestamp, messageUrl);

        await octokit.rest.issues.createComment({
          owner: inputData.owner,
          repo: inputData.repo,
          issue_number: inputData.number,
          body: commentBody,
        });

        logger?.debug(`Issue #${inputData.number}: Posted Discord message from ${author}`);
      }

      // Update or create sync tracker comment
      const lastMessage = newMessages[newMessages.length - 1];
      const syncTrackerBody = createSyncTrackerComment(lastMessage.id, lastMessage.createdAt);

      if (syncTrackerCommentId) {
        // Update existing tracker
        await octokit.rest.issues.updateComment({
          owner: inputData.owner,
          repo: inputData.repo,
          comment_id: syncTrackerCommentId,
          body: syncTrackerBody,
        });
      } else {
        // Create new tracker
        await octokit.rest.issues.createComment({
          owner: inputData.owner,
          repo: inputData.repo,
          issue_number: inputData.number,
          body: syncTrackerBody,
        });
      }

      logger?.info(
        `Issue #${inputData.number}: Successfully synced ${newMessages.length} Discord messages`,
      );

      // Check if the last message author has the "Mastra Team" role
      let lastDiscordAuthorHasMastraRole: boolean | null = null;
      const lastMessageInThread = allMessagesArray[0]; // Messages are sorted newest first
      
      if (lastMessageInThread) {
        try {
          const guildId = thread.guild?.id;
          if (guildId) {
            const member = await thread.guild.members.fetch(lastMessageInThread.author.id);
            const hasMastraRole = member.roles.cache.some(role => role.name === 'Admin' || role.name === 'Mastra Team');
            lastDiscordAuthorHasMastraRole = hasMastraRole;
            logger?.debug(
              `Issue #${inputData.number}: Last Discord author ${lastMessageInThread.author.username} has Admin or Mastra Team role: ${hasMastraRole}`,
            );
          }
        } catch (error) {
          logError(logger, `Error checking Discord member roles for issue #${inputData.number}`, error);
        }
      }

      return {
        hasDiscordThread: true,
        messagesSynced: newMessages.length,
        threadId,
        lastDiscordAuthorHasMastraRole,
      };
    } catch (error) {
      logError(logger, `Error syncing Discord messages for issue #${inputData.number}`, error);
      return {
        hasDiscordThread: true,
        messagesSynced: 0,
        threadId,
        lastDiscordAuthorHasMastraRole: null,
      };
    }
  },
});

// Step 4: Check Discord author role and add label if needed
const checkDiscordAuthorRoleStep = createStep({
  id: 'check-discord-author-role',
  inputSchema: z.object({
    number: z.number(),
    owner: z.string().default(owner),
    repo: z.string().default(repo),
    lastDiscordAuthorHasMastraRole: z.boolean().nullable(),
    hasDiscordThread: z.boolean(),
  }),
  outputSchema: z.object({
    discordFollowUpLabelAdded: z.boolean(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();

    // Only check if there's a Discord thread and we have role information
    if (!inputData.hasDiscordThread || inputData.lastDiscordAuthorHasMastraRole === null) {
      return { discordFollowUpLabelAdded: false };
    }

    // If the last Discord author doesn't have the Mastra Team role, add the follow up label
    if (inputData.lastDiscordAuthorHasMastraRole === false) {
      try {
        await octokit.rest.issues.addLabels({
          owner: inputData.owner,
          repo: inputData.repo,
          issue_number: inputData.number,
          labels: ['status: needs follow up'],
        });

        logger?.info(
          `Issue #${inputData.number}: Added "status: needs follow up" label (last Discord author not a Mastra team member)`,
        );

        return { discordFollowUpLabelAdded: true };
      } catch (error) {
        logError(logger, `Error adding Discord follow-up label to issue #${inputData.number}`, error);
        return { discordFollowUpLabelAdded: false };
      }
    }

    return { discordFollowUpLabelAdded: false };
  },
});

// Create a workflow for processing a single issue
const processIssueWorkflow = createWorkflow({
  id: 'process-single-issue',
  inputSchema: issueSchema.extend({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
  }),
  outputSchema: z.object({
    issueNumber: z.number(),
    labelAdded: z.boolean(),
    messagesSynced: z.number(),
    success: z.boolean(),
  }),
})
  .then(checkCommentAuthorStep)
  .map(async ({ getInitData }) => {
    // Pass the original issue data to the next step
    return getInitData();
  })
  .then(syncDiscordMessagesStep)
  .map(async ({ getStepResult, getInitData }) => {
    const { number, owner, repo } = getInitData();
    const syncResult = getStepResult(syncDiscordMessagesStep);

    return {
      number,
      owner,
      repo,
      lastDiscordAuthorHasMastraRole: syncResult.lastDiscordAuthorHasMastraRole,
      hasDiscordThread: syncResult.hasDiscordThread,
    };
  })
  .then(checkDiscordAuthorRoleStep)
  .map(async ({ getStepResult, getInitData }) => {
    const { number } = getInitData();
    const commentResult = getStepResult(checkCommentAuthorStep);
    const syncResult = getStepResult(syncDiscordMessagesStep);
    const discordRoleResult = getStepResult(checkDiscordAuthorRoleStep);

    return {
      issueNumber: number,
      labelAdded: commentResult.labelAdded || discordRoleResult.discordFollowUpLabelAdded,
      messagesSynced: syncResult.messagesSynced,
      success: true,
    };
  })
  .commit();

// Main workflow
export const githubIssueManagerWorkflow = createWorkflow({
  id: 'github-issue-manager',
  inputSchema: z.object({
    owner: z.string().default(owner),
    repo: z.string().default(repo),
    batchSize: z.number().default(100),
  }),
  outputSchema: z.object({
    issuesProcessed: z.number(),
    labelsAdded: z.number(),
    messagesSynced: z.number(),
    success: z.boolean(),
  }),
})
  .then(fetchWaitingIssuesStep)
  .map(async ({ inputData: { issues }, getInitData }) => {
    const { owner, repo } = getInitData();
    return issues.map(issue => ({ ...issue, owner, repo }));
  })
  .foreach(processIssueWorkflow, { concurrency: 10 })
  .map(async ({ inputData: results }) => {
    const labelsAdded = results.filter(r => r.labelAdded).length;
    const messagesSynced = results.reduce((sum, r) => sum + r.messagesSynced, 0);

    return {
      issuesProcessed: results.length,
      labelsAdded,
      messagesSynced,
      success: true,
    };
  })
  .commit();