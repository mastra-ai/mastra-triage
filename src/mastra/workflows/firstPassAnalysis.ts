import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../shared/github';
import { getDiscordClient } from '../shared/discord';
import { firstPassAnalysisAgent } from '../agents/firstPassAnalysis';

const analysisInputSchema = z.object({
  issueNumber: z.number(),
  issueUrl: z.string(),
  issueTitle: z.string(),
  issueBody: z.string(),
  discordThreadId: z.string(),
  discordThreadUrl: z.string(),
});

// Step 1: Enrich context with additional information
const enrichContextStep = createStep({
  id: 'enrich-context',
  inputSchema: analysisInputSchema,
  outputSchema: z.object({
    enrichedIssue: z.string(),
    relatedIssues: z.array(z.any()).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();

    try {
      // Get the full issue with comments
      const { data: issue } = await octokit.rest.issues.get({
        owner: 'mastra-ai',
        repo: 'mastra',
        issue_number: inputData.issueNumber,
      });

      // Get Discord thread messages for additional context
      const discordClient = await getDiscordClient(logger);
      const thread = await discordClient.channels.fetch(inputData.discordThreadId);
      
      let discordMessages = '';
      if (thread?.isThread()) {
        const messages = await thread.messages.fetch({ limit: 10 });
        discordMessages = messages
          .reverse()
          .map(msg => `[${msg.author.username}]: ${msg.content}`)
          .join('\n');
      }

      // Build enriched context
      const enrichedIssue = `
# GitHub Issue #${inputData.issueNumber}: ${inputData.issueTitle}

${inputData.issueBody}

## Discord Thread Context
${discordMessages}

## Issue URL
${inputData.issueUrl}

## Discord Thread URL  
${inputData.discordThreadUrl}
`;

      return {
        enrichedIssue,
        relatedIssues: [],
      };
    } catch (error) {
      logger?.error('Error enriching context:', error);
      // Return minimal context on error
      return {
        enrichedIssue: `# Issue #${inputData.issueNumber}: ${inputData.issueTitle}\n\n${inputData.issueBody}`,
        relatedIssues: [],
      };
    }
  },
});

// Step 2: Deep analysis using the agent
const deepAnalysisStep = createStep({
  id: 'deep-analysis',
  inputSchema: z.object({
    enrichedIssue: z.string(),
  }),
  outputSchema: z.object({
    analysis: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    
    try {
      logger?.info('Starting first-pass analysis...');
      
      // Use the agent to analyze the issue
      const response = await firstPassAnalysisAgent.generate(
        inputData.enrichedIssue,
        {
          maxSteps: 10, // Allow multiple tool calls + final response
        }
      );

      const analysis = response.text || 'No analysis generated';
      
      logger?.info('Analysis complete');
      
      return {
        analysis,
      };
    } catch (error) {
      logger?.error('Error during analysis:', error);
      return {
        analysis: `⚠️ Unable to complete full analysis due to an error.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\nA human maintainer will need to review this issue manually.`,
      };
    }
  },
});

// Step 3: Post response to GitHub and Discord
const respondStep = createStep({
  id: 'respond',
  inputSchema: z.object({
    analysis: z.string(),
    issueNumber: z.number(),
    discordThreadId: z.string(),
  }),
  outputSchema: z.object({
    githubCommentUrl: z.string().optional(),
    discordMessageSent: z.boolean(),
    success: z.boolean(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();
    const discordClient = await getDiscordClient(logger);

    try {
      // Post to GitHub
      const { data: comment } = await octokit.rest.issues.createComment({
        owner: 'mastra-ai',
        repo: 'mastra',
        issue_number: inputData.issueNumber,
        body: `## 🤖 First-Pass Analysis\n\n${inputData.analysis}\n\n---\n*This analysis was automatically generated. Human maintainers will review and provide additional assistance as needed.*`,
      });

      logger?.info(`Posted analysis to GitHub: ${comment.html_url}`);

      // Post to Discord
      let discordMessageSent = false;
      try {
        const thread = await discordClient.channels.fetch(inputData.discordThreadId);
        if (thread?.isThread()) {
          // Truncate analysis if too long for Discord (2000 char limit)
          let discordMessage = `🤖 **First-Pass Analysis**\n\n${inputData.analysis}`;
          if (discordMessage.length > 1900) {
            discordMessage = discordMessage.substring(0, 1900) + '...\n\n*See full analysis on GitHub*';
          }
          
          await thread.send(discordMessage);
          discordMessageSent = true;
          logger?.info('Posted analysis to Discord thread');
        }
      } catch (discordError) {
        logger?.error('Error posting to Discord:', discordError);
        // Don't fail the whole workflow if Discord post fails
      }

      // Add label to indicate analysis was done
      await octokit.rest.issues.addLabels({
        owner: 'mastra-ai',
        repo: 'mastra',
        issue_number: inputData.issueNumber,
        labels: ['ai-analyzed'],
      });

      return {
        githubCommentUrl: comment.html_url,
        discordMessageSent,
        success: true,
      };
    } catch (error) {
      logger?.error('Error posting response:', error);
      return {
        discordMessageSent: false,
        success: false,
      };
    }
  },
});

// Main workflow
export const firstPassAnalysisWorkflow = createWorkflow({
  id: 'first-pass-analysis',
  inputSchema: analysisInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    githubCommentUrl: z.string().optional(),
  }),
  steps: [enrichContextStep, deepAnalysisStep, respondStep],
})
  .then(enrichContextStep)
  .map(async ({ inputData, getInitData }) => {
    return {
      enrichedIssue: inputData.enrichedIssue,
    };
  })
  .then(deepAnalysisStep)
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData();
    return {
      analysis: inputData.analysis,
      issueNumber: initData.issueNumber,
      discordThreadId: initData.discordThreadId,
    };
  })
  .then(respondStep)
  .commit();

