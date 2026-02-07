import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../../shared/github';
import { getMemberByLogin } from '../../constants/members';
import {
  parseSyncTrackerComment,
  logError,
} from './helpers';

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

// Step 2: Check last comment author and sync tracker, add label if needed
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
    labelReason: z.enum(['github_comment', 'sync_tracker', 'both', 'none']).nullable(),
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

      // Check 1: Last GitHub comment author
      let githubCommentIndicatesNonMember = false;
      let lastAuthor: string | null = null;

      // Filter out bot comments
      const humanComments = comments.filter(comment => comment.user?.type !== 'Bot');

      if (humanComments.length > 0) {
        // Get the last human comment
        const lastComment = humanComments[humanComments.length - 1];
        lastAuthor = lastComment.user?.login || null;

        if (lastAuthor) {
          // Check if author is a Mastra member
          const isMember = getMemberByLogin(lastAuthor) !== undefined;
          githubCommentIndicatesNonMember = !isMember;

          logger?.debug(
            `Issue #${inputData.number}: Last comment from ${lastAuthor} (isMember: ${isMember})`,
          );
        }
      }

      // Check 2: Sync tracker for Discord message author
      let syncTrackerIndicatesNonMember = false;
      const syncTrackerComment = comments.find(comment =>
        comment.body?.includes('<!-- DISCORD_SYNC:'),
      );

      if (syncTrackerComment) {
        const syncInfo = parseSyncTrackerComment(syncTrackerComment.body || '');
        if (syncInfo && syncInfo.lastAuthorIsTeamMember === false) {
          syncTrackerIndicatesNonMember = true;
          logger?.debug(
            `Issue #${inputData.number}: Sync tracker indicates last Discord author is not a team member`,
          );
        }
      }

      // Determine label reason
      let labelReason: 'github_comment' | 'sync_tracker' | 'both' | 'none' | null = 'none';
      if (githubCommentIndicatesNonMember && syncTrackerIndicatesNonMember) {
        labelReason = 'both' as const;
      } else if (githubCommentIndicatesNonMember) {
        labelReason = 'github_comment' as const;
      } else if (syncTrackerIndicatesNonMember) {
        labelReason = 'sync_tracker' as const;
      }

      // Add "status: needs follow up" label if either check indicates non-member
      if (githubCommentIndicatesNonMember || syncTrackerIndicatesNonMember) {
        try {
          await octokit.rest.issues.addLabels({
            owner: inputData.owner,
            repo: inputData.repo,
            issue_number: inputData.number,
            labels: ['status: needs follow up'],
          });

          logger?.info(
            `Issue #${inputData.number}: Added "status: needs follow up" label (reason: ${labelReason})`,
          );

          return {
            needsFollowUp: true,
            lastCommentAuthor: lastAuthor,
            labelAdded: true,
            labelReason,
          };
        } catch (error) {
          logError(logger, `Error adding label to issue #${inputData.number}`, error);
          return {
            needsFollowUp: true,
            lastCommentAuthor: lastAuthor,
            labelAdded: false,
            labelReason,
          };
        }
      }

      return {
        needsFollowUp: false,
        lastCommentAuthor: lastAuthor,
        labelAdded: false,
        labelReason: 'none' as const,
      };
    } catch (error) {
      logError(logger, `Error checking comments for issue #${inputData.number}`, error);
      return {
        needsFollowUp: false,
        lastCommentAuthor: null,
        labelAdded: false,
        labelReason: 'none' as const,
      };
    }
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
    labelReason: z.enum(['github_comment', 'sync_tracker', 'both', 'none']).nullable(),
    success: z.boolean(),
  }),
})
  .then(checkCommentAuthorStep)
  .map(async ({ getStepResult, getInitData }) => {
    const { number } = getInitData<any>();
    const commentResult = getStepResult(checkCommentAuthorStep);

    return {
      issueNumber: number,
      labelAdded: commentResult.labelAdded,
      labelReason: commentResult.labelReason,
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
    success: z.boolean(),
  }),
})
  .then(fetchWaitingIssuesStep)
  .map(async ({ inputData: { issues }, getInitData }) => {
    const { owner, repo } = getInitData<any>();
    return issues.map(issue => ({ ...issue, owner, repo }));
  })
  .foreach(processIssueWorkflow, { concurrency: 10 })
  .map(async ({ inputData: results }) => {
    const labelsAdded = results.filter(r => r.labelAdded).length;

    return {
      issuesProcessed: results.length,
      labelsAdded,
      success: true,
    };
  })
  .commit();