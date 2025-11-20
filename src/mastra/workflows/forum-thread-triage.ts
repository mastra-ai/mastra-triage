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
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  summary: z.string(),
});

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

// Step 2: Analyze individual threads with full conversation context
const analyzeThreadsStep = createStep({
  id: 'analyze-threads',
  inputSchema: z.object({
    success: z.boolean(),
    posts: z.array(postSchema),
  }),
  outputSchema: z.object({
    analyses: z.array(threadAnalysisSchema),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient();
    const agent = mastra.getAgentById('threadClassifierAgent');

    logger?.info(`Analyzing ${inputData.posts.length} threads...`);

    const analyses: Array<{
      threadId: string;
      threadName: string;
      url: string;
      tags: string[];
      messageCount: number;
      type: 'Bug' | 'Feature Request' | 'Question';
      category: string;
      severity: 'MINOR' | 'MAJOR' | 'CRITICAL';
      summary: string;
    }> = [];

    for (const thread of inputData.posts) {
      try {
        // Fetch ALL messages from the thread
        const messages = await getAllThreadMessages({
          client: discordClient,
          threadId: thread.id,
        });

        if (messages.length === 0) {
          logger?.warn(`No messages found for thread: ${thread.name}`);
          continue;
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
        `.trim();

        const result = await agent.generate(prompt, {
          structuredOutput: {
            schema: z.object({
              type: z.enum(['Bug', 'Feature Request', 'Question']),
              category: z.string(),
              severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
              summary: z.string(),
            }),
          },
        });

        analyses.push({
          threadId: thread.id,
          threadName: thread.name,
          url: thread.url,
          tags: thread.tags,
          messageCount: messages.length,
          type: result.object.type,
          category: result.object.category,
          severity: result.object.severity,
          summary: result.object.summary,
        });

        logger?.info(`✓ Analyzed: ${thread.name} (${messages.length} messages)`);
      } catch (error) {
        logger?.error(`Error analyzing thread ${thread.name}:`, error);
        // Continue with next thread even if one fails
        continue;
      }
    }

    logger?.info(`Successfully analyzed ${analyses.length} out of ${inputData.posts.length} threads`);

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

    // Sort by severity priority (CRITICAL first)
    const severityOrder = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };
    const sorted = [...inputData.analyses].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

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

    inputData.analyses.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;

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

    const stats = {
      total: inputData.analyses.length,
      byType,
      bySeverity,
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

    // Create category breakdown table
    const categoryBreakdownTable = `| Category | Total | Bugs | Features | Questions |
|----------|-------|------|----------|-----------|
${Object.entries(stats.byCategory)
  .sort((a, b) => b[1].total - a[1].total) // Sort by total count descending
  .map(([category, counts]) => `| ${category} | ${counts.total} | ${counts.Bug} | ${counts['Feature Request']} | ${counts.Question} |`)
  .join('\n')}`;

    const header = `# Forum Thread Analysis Report

**Analysis Date**: ${currentDate}
**Total Threads**: ${stats.total}

## Summary Statistics

### By Type
${typeStatsTable}

### By Severity
${severityStatsTable}

## Category Breakdown
${categoryBreakdownTable}

---

## Thread Details

`;

    const table =
      `| Thread Name | Type | Severity | Category | Summary | URL |\n` +
      `|-------------|------|----------|----------|---------|-----|\n` +
      sorted
        .map(
          a =>
            `| ${a.threadName} | ${typeAbbrev[a.type]} | ${severityEmoji[a.severity]} | ${a.category} | ${a.summary} | [Link](${a.url}) |`,
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
export const forumThreadTriageWorkflow = createWorkflow({
  id: 'forum-thread-triage',
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
  .then(analyzeThreadsStep)
  .then(generateTableStep)
  .then(saveFileStep)
  .commit();
