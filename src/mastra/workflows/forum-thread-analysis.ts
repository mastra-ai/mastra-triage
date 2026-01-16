/**
 * Forum Thread Analysis Workflow
 *
 * ⚠️ MANUAL TRIGGER ONLY - DO NOT DELETE
 *
 * This workflow is NOT triggered by GitHub Actions. It is invoked manually
 * by Romain and Abhi for generating periodic reports on Discord forum thread
 * activity and sentiment analysis.
 *
 * Use case: Analyzing Discord help forum threads to identify trends, severity
 * distribution, and key issues across different product categories.
 *
 * Output: Generates a markdown report file (forum-thread-analysis.md) with
 * statistics, category breakdowns, and detailed thread analysis.
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getDiscordClient } from '../helpers/client';
import { getAllThreadMessages } from '../helpers/messages';
import { postSchema } from '../shared/post';
import { getGithubClient } from '../shared/github';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ForumChannel } from 'discord.js';

const TRIAGER_BOT_APP_ID = '1379372702242181182';

/**
 * Extracts the GitHub issue status from a message containing a GitHub issue link.
 * @param message - Message object containing a GitHub issue URL in its content
 * @returns The issue state ('open' | 'closed' | 'pr pending' | ...) or null if extraction/fetch fails
 */
type IssueStatus = 'open' | 'closed' | 'waiting for author' | 'needs reproduction' | 'pr pending' | null;

async function getIssueStatus(message: { content: string }): Promise<IssueStatus> {
  // Extract GitHub issue URL from message content
  // Pattern: https://github.com/{owner}/{repo}/issues/{issue_number}
  const githubIssueRegex = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/;
  const match = message.content.match(githubIssueRegex);

  if (!match) {
    return null;
  }

  const [, owner, repo, issueNumber] = match;

  try {
    const octokit = getGithubClient();
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: parseInt(issueNumber, 10),
    });

    // If closed, return closed status
    if (issue.state === 'closed') {
      return 'closed';
    }

    // Check for linked/referenced PRs via timeline events
    try {
      const { data: timeline } = await octokit.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: parseInt(issueNumber, 10),
        per_page: 100,
      });

      const hasLinkedPR = timeline.some(
        event =>
          event.event === 'cross-referenced' &&
          'source' in event &&
          event.source?.issue?.pull_request != null
      );

      if (hasLinkedPR) {
        return 'pr pending';
      }
    } catch (timelineError) {
      // Timeline fetch failed, continue with default status
      console.warn(`Failed to fetch timeline for ${owner}/${repo}#${issueNumber}:`, timelineError);
    }

    // Check for specific status labels
    const labels = issue.labels.map(label => (typeof label === 'string' ? label : label.name));

    if (labels.includes('status: needs reproduction')) {
      return 'needs reproduction';
    }

    if (labels.includes('status: waiting for author')) {
      return 'waiting for author';
    }

    // Default to open if no specific status label
    return 'open';
  } catch (error) {
    console.error(`Failed to fetch issue status for ${owner}/${repo}#${issueNumber}:`, error);
    return null;
  }
}

// Schema for individual thread analysis
const threadAnalysisSchema = z.object({
  threadId: z.string(),
  threadName: z.string(),
  url: z.string(),
  tags: z.array(z.string()),
  messageCount: z.number(),
  type: z.enum(['Bug', 'Feature Request', 'Question']),
  category: z.string(),
  severityScore: z.number().min(1).max(10),
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  summary: z.string(),
  issueStatus: z
    .enum(['open', 'closed', 'waiting for author', 'needs reproduction', 'pr pending'])
    .nullable()
    .describe('GitHub issue status if a linked issue exists'),
});

// Helper function to derive severity category from numeric score
function getSeverityCategory(score: number): 'MINOR' | 'MAJOR' | 'CRITICAL' {
  if (score >= 1 && score <= 3) return 'MINOR';
  if (score >= 4 && score <= 7) return 'MAJOR';
  return 'CRITICAL'; // 8-10
}

// Step 1: Fetch forum threads
const fetchThreadsStep = createStep({
  id: 'fetch-threads',
  inputSchema: z.object({
    forumChannelId: z
      .string()
      .default('1349006916902191125')
      .describe('The ID of the Discord forum channel to fetch threads from'),
    fetchLimit: z.coerce.number().optional().default(1).describe('Number of days to fetch threads from'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    posts: z.array(postSchema),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient();

    try {
      // Get the forum channel
      const channel = await discordClient.channels.fetch(inputData.forumChannelId);

      if (!channel || !channel.isThreadOnly()) {
        throw new Error('Channel not found or not a forum channel');
      }

      const forumChannel = channel as unknown as ForumChannel;
      const availableTags = await forumChannel.availableTags;
      const availableTagsMap = new Map(availableTags.map(tag => [tag.id, tag.name]));

      // Fetch active threads
      const activeThreads = await forumChannel.threads.fetchActive();

      // Combine active and archived threads
      const allThreads = [...Array.from(activeThreads.threads.values())];

      // Calculate the start date based on fetchLimit (in days)
      const startDate = new Date();
      startDate.setHours(startDate.getHours() - 24 * inputData.fetchLimit);

      // Map to the return type and filter threads from the last N days
      const mappedThreads = allThreads
        .map(thread => ({
          id: thread.id,
          name: thread.name,
          createdAt: thread.createdAt || new Date(),
          messageCount: thread.messageCount || 0,
          archived: thread.archived || false,
          locked: thread.locked || false,
          url: thread.url,
          tags: thread.appliedTags.map(tag => availableTagsMap.get(tag) || tag),
        }))
        .filter(thread => thread.createdAt >= startDate)
        .reverse();

      logger?.info(`Found ${mappedThreads.length} posts`);
      return { success: true, posts: mappedThreads };
    } catch (error) {
      logger?.error('Error fetching forum posts:', error);
      throw error;
    }
  },
});

// Step 2: Analyze a single thread with full conversation context
const analyzeThreadStep = createStep({
  id: 'analyze-thread',
  inputSchema: postSchema,
  outputSchema: threadAnalysisSchema.nullable(),
  execute: async ({ inputData: thread, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient();
    const agent = mastra.getAgentById('threadClassifierAgent');

    try {
      // Fetch ALL messages from the thread
      const messages = await getAllThreadMessages({
        client: discordClient,
        threadId: thread.id,
      });

      if (messages.length === 0) {
        logger?.warn(`No messages found for thread: ${thread.name}`);
        return null;
      }

      // Get the triager bot's messages and check for GitHub issue status
      let issueStatus: IssueStatus = null;
      const triageBotMessages = messages.filter(msg => msg.authorId === TRIAGER_BOT_APP_ID);

      if (triageBotMessages.length > 0) {
        // find the github issue link in the triage bot's messages
        const githubIssueLink = triageBotMessages.find(msg => msg.content.includes('github.com/'));
        if (githubIssueLink) {
          // get status of the issue
          issueStatus = await getIssueStatus(githubIssueLink);
          if (issueStatus) {
            logger?.debug(`Issue ${githubIssueLink}  status: ${issueStatus}`);
          }
        } else {
          logger?.debug(`No github issue link found in the triage bot's messages`);
        }
      }

      // Format the conversation for the agent
      const conversation = messages.map(msg => `[${msg.author}]: ${msg.content}`).join('\n\n');

      // Prepare context for the agent
      const prompt = `
Analyze this Discord forum thread:

**Thread Title**: ${thread.name}
**Tags**: ${thread.tags.length > 0 ? thread.tags.join(', ') : 'None'}
**Message Count**: ${messages.length}

**Full Conversation**:
${conversation}

Classify this thread based on the ENTIRE conversation, considering:
- How the issue evolved through the discussion
- Follow-up messages that might reveal bugs or increase severity
- Resolution status or ongoing problems

Provide a severity score from 1-10 where:
- 1-3: MINOR issues (cosmetic, low priority, minimal impact)
- 4-7: MAJOR issues (significant but not blocking, moderate impact)
- 8-10: CRITICAL issues (blocking, high priority, severe impact)
      `.trim();

      const result = await agent.generate(prompt, {
        structuredOutput: {
          schema: z.object({
            type: z.enum(['Bug', 'Feature Request', 'Question']),
            category: z.string(),
            severityScore: z.number().min(1).max(10).describe('Severity score from 1-10'),
            summary: z.string(),
          }),
        },
      });

      const severity = getSeverityCategory(result.object.severityScore);

      logger?.info(
        `✓ Analyzed: ${thread.name} (${messages.length} messages) - Severity: ${result.object.severityScore}/10 (${severity})`,
      );

      return {
        threadId: thread.id,
        threadName: thread.name,
        url: thread.url,
        tags: thread.tags,
        messageCount: messages.length,
        type: result.object.type,
        category: result.object.category,
        severityScore: result.object.severityScore,
        severity,
        summary: result.object.summary,
        issueStatus,
      };
    } catch (error) {
      logger?.error(`Error analyzing thread ${thread.name}:`, error);
      // Return null for failed analyses
      return null;
    }
  },
});

// Step 3: Filter out null results from failed thread analyses
const filterAnalysesStep = createStep({
  id: 'filter-analyses',
  inputSchema: z.object({
    items: z.array(threadAnalysisSchema.nullable()),
  }),
  outputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const analyses = inputData.items.filter((item): item is z.infer<typeof threadAnalysisSchema> => item !== null);

    logger?.info(`Successfully analyzed ${analyses.length} threads`);

    return { analyses };
  },
});

// Step 4: Generate category summaries using agent
const generateCategorySummariesStep = createStep({
  id: 'generate-category-summaries',
  inputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
  }),
  outputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
    categorySummaries: z.record(z.string(), z.string()),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const agent = mastra.getAgentById('categorySummaryAgent');

    // Group threads by category
    const categoriesMap: Record<string, z.infer<typeof threadAnalysisSchema>[]> = {};
    inputData.analyses.forEach(analysis => {
      if (!categoriesMap[analysis.category]) {
        categoriesMap[analysis.category] = [];
      }
      categoriesMap[analysis.category].push(analysis);
    });

    logger?.info(`Generating summaries for ${Object.keys(categoriesMap).length} categories...`);

    // Generate summary for each category
    const categorySummaries: Record<string, string> = {};

    for (const [category, threads] of Object.entries(categoriesMap)) {
      try {
        // Prepare thread information for the agent
        const threadList = threads
          .map((t, idx) => `${idx + 1}. [Severity ${t.severityScore}/10] ${t.threadName}\n   Summary: ${t.summary}`)
          .join('\n\n');

        const prompt = `
Analyze these ${threads.length} threads in the "${category}" category:

${threadList}

Provide a concise 2-3 sentence high-level overview of:
- Common themes and patterns across these threads
- Key concerns raised by users
- Overall nature of issues in this category

Keep it brief and actionable.
        `.trim();

        // const result = await agent.generate(prompt, {
        //   structuredOutput: {
        //     schema: z.object({
        //       summary: z.string().describe('A concise 2-3 sentence overview of the category'),
        //     }),
        //   },
        // });

        // categorySummaries[category] = result.object.summary;
        categorySummaries[category] = '';
        logger?.info(`✓ Generated summary for category: ${category}`);
      } catch (error) {
        logger?.error(`Error generating summary for category ${category}:`, error);
        // Fallback to a generic summary
        categorySummaries[category] = `${threads.length} threads covering various topics in this category.`;
      }
    }

    return {
      analyses: inputData.analyses,
      categorySummaries,
    };
  },
});

// Step 5: Generate markdown table with severity column and statistics
const generateTableStep = createStep({
  id: 'generate-table',
  inputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
    categorySummaries: z.record(z.string(), z.string()),
  }),
  outputSchema: z.object({
    markdownTable: z.string(),
    stats: z.object({
      total: z.number(),
      byType: z.record(z.string(), z.number()),
      bySeverity: z.record(z.string(), z.number()),
      averageSeverityScore: z.number(),
      byCategory: z.record(
        z.string(),
        z.object({
          total: z.number(),
          Bug: z.number(),
          'Feature Request': z.number(),
          Question: z.number(),
        }),
      ),
    }),
  }),
  execute: async ({ inputData }) => {
    const typeAbbrev = {
      Bug: 'BUG',
      'Feature Request': 'FEAT',
      Question: 'Q',
    };

    const severityEmoji = {
      MINOR: '🟢',
      MAJOR: '🟡',
      CRITICAL: '🔴',
    };

    // Sort by severity score (highest first), then by category
    const sorted = [...inputData.analyses].sort((a, b) => b.severityScore - a.severityScore);

    // Calculate statistics with all possible values
    const allTypes = ['Bug', 'Feature Request', 'Question'] as const;
    const allSeverities = ['CRITICAL', 'MAJOR', 'MINOR'] as const;

    // Initialize with all types and severities at 0
    const byType: Record<string, number> = {
      Bug: 0,
      'Feature Request': 0,
      Question: 0,
    };
    const bySeverity: Record<string, number> = {
      CRITICAL: 0,
      MAJOR: 0,
      MINOR: 0,
    };

    // Count actual occurrences and build category breakdown
    const byCategory: Record<
      string,
      {
        total: number;
        Bug: number;
        'Feature Request': number;
        Question: number;
      }
    > = {};

    let totalSeverityScore = 0;

    // Cross-tabulation of Type x Severity
    const typeBySeverity: Record<string, Record<string, number>> = {
      Bug: { CRITICAL: 0, MAJOR: 0, MINOR: 0 },
      'Feature Request': { CRITICAL: 0, MAJOR: 0, MINOR: 0 },
      Question: { CRITICAL: 0, MAJOR: 0, MINOR: 0 },
    };

    inputData.analyses.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      totalSeverityScore += a.severityScore;
      typeBySeverity[a.type][a.severity] += 1;

      // Initialize category if not exists
      if (!byCategory[a.category]) {
        byCategory[a.category] = {
          total: 0,
          Bug: 0,
          'Feature Request': 0,
          Question: 0,
        };
      }

      // Increment category counts
      byCategory[a.category].total += 1;
      byCategory[a.category][a.type] += 1;
    });

    const averageSeverityScore =
      inputData.analyses.length > 0 ? Number((totalSeverityScore / inputData.analyses.length).toFixed(1)) : 0;

    // Count issue statuses
    const byIssueStatus = {
      open: inputData.analyses.filter(
        a => a.issueStatus === 'open' || a.issueStatus === 'waiting for author' || a.issueStatus === 'needs reproduction' || a.issueStatus === 'pr pending',
      ).length,
      closed: inputData.analyses.filter(a => a.issueStatus === 'closed').length,
      noIssue: inputData.analyses.filter(a => a.issueStatus === null).length,
    };

    const stats = {
      total: inputData.analyses.length,
      byType,
      bySeverity,
      averageSeverityScore,
      byCategory,
    };

    // Generate markdown table with header
    const currentDate = new Date().toISOString().split('T')[0];

    // Create cross-tabulation table: Type x Severity
    const summaryStatsTable = `| Type | ${severityEmoji.CRITICAL} Critical | ${severityEmoji.MAJOR} Major | ${severityEmoji.MINOR} Minor | Total |
|------|----------|-------|-------|-------|
${allTypes.map(type => `| ${type} | ${typeBySeverity[type].CRITICAL} | ${typeBySeverity[type].MAJOR} | ${typeBySeverity[type].MINOR} | ${stats.byType[type]} |`).join('\n')}
| **Total** | **${stats.bySeverity.CRITICAL}** | **${stats.bySeverity.MAJOR}** | **${stats.bySeverity.MINOR}** | **${stats.total}** |`;

    // Create category breakdown table with agent-generated summaries
    // const categoryBreakdownTable = `| Category | Total | Bugs | Features | Questions | Summary |
    const categoryBreakdownTable = `| Category | Total | Bugs | Features | Questions |
|----------|-------|------|----------|-----------|
${Object.entries(stats.byCategory)
  .sort((a, b) => b[1].total - a[1].total) // Sort by total count descending
  .map(([category, counts]) => {
    const summary = inputData.categorySummaries[category] || 'No summary available';
    // return `| ${category} | ${counts.total} | ${counts.Bug} | ${counts['Feature Request']} | ${counts.Question} | ${summary} |`;
    return `| ${category} | ${counts.total} | ${counts.Bug} | ${counts['Feature Request']} | ${counts.Question} |`;
  })
  .join('\n')}`;

    const header = `# Forum Thread Analysis Report

**Analysis Date**: ${currentDate}

**Total Threads**: ${stats.total} (${byIssueStatus.open} open, ${byIssueStatus.closed} closed, ${byIssueStatus.noIssue} no issue linked)

## Summary Statistics

${summaryStatsTable}

**Average Severity Score**: ${stats.averageSeverityScore.toFixed(1)}/10
- 1-3: MINOR issues (cosmetic, low priority, minimal impact)
- 4-7: MAJOR issues (significant but not blocking, moderate impact)
- 8-10: CRITICAL issues (blocking, high priority, severe impact)

## Category Breakdown
${categoryBreakdownTable}

---

## Thread Details

`;

    const issueStatusDisplay = (status: IssueStatus) => {
      if (status === 'open') return '🔴 Open';
      if (status === 'closed') return '🟢 Closed';
      if (status === 'waiting for author') return '⏳ Waiting for Author';
      if (status === 'needs reproduction') return '🔍 Needs Reproduction';
      if (status === 'pr pending') return '🔍 PR Pending';
      return '—';
    };

    const table =
      `| Type | Severity | Score | Category | Summary | Thread Name | Issue Status | URL |\n` +
      `|------|----------|-------|----------|---------|-------------|--------------|-----|\n` +
      sorted
        .map(
          a =>
            `| ${typeAbbrev[a.type]} | ${severityEmoji[a.severity]} | ${a.severityScore}/10 | ${a.category} | ${a.summary} | ${a.threadName} | ${issueStatusDisplay(a.issueStatus)} | [Link](${a.url}) |`,
        )
        .join('\n');

    const markdownTable = header + table;

    return { markdownTable, stats };
  },
});

// Step 6: Save markdown table to file
const saveFileStep = createStep({
  id: 'save-file',
  inputSchema: z.object({
    markdownTable: z.string(),
    stats: z.object({
      total: z.number(),
      byType: z.record(z.string(), z.number()),
      bySeverity: z.record(z.string(), z.number()),
      averageSeverityScore: z.number(),
      byCategory: z.record(
        z.string(),
        z.object({
          total: z.number(),
          Bug: z.number(),
          'Feature Request': z.number(),
          Question: z.number(),
        }),
      ),
    }),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    filePath: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    logger?.info('Saving markdown analysis to file...');

    const filePath = join(process.cwd(), '../../', 'forum-thread-analysis.md');
    await fs.writeFile(filePath, inputData.markdownTable, 'utf-8');

    logger?.info(`Markdown analysis saved to ${filePath}`);

    return { success: true, filePath };
  },
});

// Create the workflow
export const forumThreadAnalysisWorkflow = createWorkflow({
  id: 'forum-thread-analysis',
  inputSchema: z.object({
    forumChannelId: z
      .string()
      .default('1349006916902191125')
      .describe('The ID of the Discord forum channel to fetch threads from'),
    fetchLimit: z.coerce.number().optional().default(1).describe('Number of days to fetch threads from'),
  }),
  outputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
    markdownTable: z.string(),
    filePath: z.string(),
    stats: z.object({
      total: z.number(),
      byType: z.record(z.string(), z.number()),
      bySeverity: z.record(z.string(), z.number()),
      averageSeverityScore: z.number(),
      byCategory: z.record(
        z.string(),
        z.object({
          total: z.number(),
          Bug: z.number(),
          'Feature Request': z.number(),
          Question: z.number(),
        }),
      ),
    }),
  }),
})
  .then(fetchThreadsStep)
  .map(async ({ inputData }) => {
    // Extract posts array for foreach iteration
    return inputData.posts;
  })
  .foreach(analyzeThreadStep, { concurrency: 5 })
  .map(async ({ inputData }) => {
    // Package the array results for the filter step
    return { items: inputData };
  })
  .then(filterAnalysesStep)
  .then(generateCategorySummariesStep)
  .then(generateTableStep)
  .then(saveFileStep)
  .commit();
