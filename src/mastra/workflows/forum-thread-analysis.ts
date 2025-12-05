import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getDiscordClient } from '../helpers/client';
import { getAllThreadMessages } from '../helpers/messages';
import { postSchema } from '../shared/post';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ForumChannel } from 'discord.js';

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
    forumChannelId: z.string().describe('The ID of the Discord forum channel to fetch threads from'),
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

      logger?.info(`✓ Analyzed: ${thread.name} (${messages.length} messages) - Severity: ${result.object.severityScore}/10 (${severity})`);

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

// Step 3: Generate markdown table with severity column and statistics
const generateTableStep = createStep({
  id: 'generate-table',
  inputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
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

    // Track detailed category data for summaries
    const categoryDetails: Record<
      string,
      {
        threads: z.infer<typeof threadAnalysisSchema>[];
        totalSeverityScore: number;
      }
    > = {};

    let totalSeverityScore = 0;

    inputData.analyses.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      totalSeverityScore += a.severityScore;

      // Initialize category if not exists
      if (!byCategory[a.category]) {
        byCategory[a.category] = {
          total: 0,
          Bug: 0,
          'Feature Request': 0,
          Question: 0,
        };
      }

      // Initialize category details if not exists
      if (!categoryDetails[a.category]) {
        categoryDetails[a.category] = {
          threads: [],
          totalSeverityScore: 0,
        };
      }

      // Increment category counts
      byCategory[a.category].total += 1;
      byCategory[a.category][a.type] += 1;

      // Track detailed category data
      categoryDetails[a.category].threads.push(a);
      categoryDetails[a.category].totalSeverityScore += a.severityScore;
    });

    const averageSeverityScore = inputData.analyses.length > 0
      ? Number((totalSeverityScore / inputData.analyses.length).toFixed(1))
      : 0;

    const stats = {
      total: inputData.analyses.length,
      byType,
      bySeverity,
      averageSeverityScore,
      byCategory,
    };

    // Generate markdown table with header
    const currentDate = new Date().toISOString().split('T')[0];

    // Create type statistics table
    const typeStatsTable = `| Type | Count |
|------|-------|
${allTypes.map(type => `| ${type} | ${stats.byType[type]} |`).join('\n')}`;

    // Create severity statistics table
    const severityStatsTable = `| Severity | Count |
|----------|-------|
${allSeverities.map(severity => `| ${severityEmoji[severity]} ${severity} | ${stats.bySeverity[severity]} |`).join('\n')}`;

    // Create category breakdown table with key issues
    const categoryBreakdownTable = `| Category | Total | Bugs | Features | Questions | Key Issues |
|----------|-------|------|----------|-----------|------------|
${Object.entries(stats.byCategory)
  .sort((a, b) => b[1].total - a[1].total) // Sort by total count descending
  .map(([category, counts]) => {
    // Get top 3 key issues for this category (sorted by severity)
    const details = categoryDetails[category];
    const keyIssues = [...details.threads]
      .sort((a, b) => b.severityScore - a.severityScore)
      .slice(0, 3)
      .map(t => `• ${t.summary}`)
      .join('<br>');
    return `| ${category} | ${counts.total} | ${counts.Bug} | ${counts['Feature Request']} | ${counts.Question} | ${keyIssues} |`;
  })
  .join('\n')}`;

    const header = `# Forum Thread Analysis Report

**Analysis Date**: ${currentDate}
**Total Threads**: ${stats.total}

## Summary Statistics

### By Type
${typeStatsTable}

### By Severity
${severityStatsTable}

**Average Severity Score**: ${stats.averageSeverityScore.toFixed(1)}/10
- 1-3: MINOR issues (cosmetic, low priority, minimal impact)
- 4-7: MAJOR issues (significant but not blocking, moderate impact)
- 8-10: CRITICAL issues (blocking, high priority, severe impact)

## Category Breakdown
${categoryBreakdownTable}

---

## Thread Details

`;

    const table =
      `| Type | Severity | Score | Category | Summary | Thread Name | URL |\n` +
      `|------|----------|-------|----------|---------|-------------|-----|\n` +
      sorted
        .map(
          a =>
            `| ${typeAbbrev[a.type]} | ${severityEmoji[a.severity]} | ${a.severityScore}/10 | ${a.category} | ${a.summary} | ${a.threadName} | [Link](${a.url}) |`,
        )
        .join('\n');

    const markdownTable = header + table;

    return { markdownTable, stats };
  },
});

// Step 4: Save markdown table to file
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
    forumChannelId: z.string().describe('The ID of the Discord forum channel to fetch threads from'),
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
  .then(generateTableStep)
  .then(saveFileStep)
  .commit();
