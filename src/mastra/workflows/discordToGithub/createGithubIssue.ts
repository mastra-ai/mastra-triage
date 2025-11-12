import { createStep, createWorkflow } from '@mastra/core/workflows';
import { postSchema } from '../../shared/post';
import { getDiscordClient } from '../../shared/discord';
import { getGithubClient } from '../../shared/github';
import { z } from 'zod';
import { Client } from 'discord.js';
import { IMastraLogger } from '@mastra/core/logger';

async function getFirstThreadMessage(
  {
    client,
    threadId,
  }: {
    client: Client;
    threadId: string;
  },
  logger?: IMastraLogger,
): Promise<{ content: string; images: string[] } | null> {
  try {
    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) {
      logger?.error(`Channel ${threadId} is not a thread or couldn't be found`);
      return null;
    }

    // Fetch the starter message (the message that started the thread)
    const starterMessage = await thread.fetchStarterMessage();
    if (!starterMessage) {
      logger?.info('No starter message found for thread:', threadId);
      return null;
    }

    // Extract only image attachments
    const images = Array.from(starterMessage.attachments.values())
      .filter(attachment => attachment.contentType?.startsWith('image/'))
      .map(attachment => attachment.url);

    return {
      content: starterMessage.content || '',
      images,
    };
  } catch (error) {
    logger?.error('Error fetching thread message:', error);
    return null;
  }
}

const createGithubIssueStep = createStep({
  id: 'create-github-issue',
  inputSchema: postSchema,
  outputSchema: z.object({
    html_url: z.string(),
    number: z.number(),
    title: z.string(),
    body: z.string(),
  }),
  execute: async ({ inputData: post, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);
    const octokit = getGithubClient();
    const title = post.name;
    const owner = 'mastra-ai';
    const repo = 'mastra';

    const message = await getFirstThreadMessage(
      {
        client: discordClient,
        threadId: post.id,
      },
      logger,
    );

    logger?.debug('discord message', JSON.stringify(message));

    // Format the message content
    let bodyContent = message?.content || '';
    
    // Add images if any exist
    if (message?.images && message.images.length > 0) {
      const imageMarkdown = message.images
        .map((url, index) => `![Screenshot ${index + 1}](${url})`)
        .join('\n\n');
      
      // Add images after the message content
      if (bodyContent) {
        bodyContent += '\n\n---\n\n' + imageMarkdown;
      } else {
        bodyContent = imageMarkdown;
      }
    }

    // Create a new issue
    const issueBody = `This issue was created from Discord post ${post.id}:\n\n[![Open in Discord](https://img.shields.io/badge/Open_in_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](${post.url})\n\n${bodyContent}`;
    
    const newIssue = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: issueBody,
      labels: ['status: needs triage', 'discord'],
    });

    logger?.debug(`Created new issue: ${newIssue.data.html_url} for ${title}`);

    return {
      html_url: newIssue.data.html_url,
      number: newIssue.data.number,
      title: newIssue.data.title,
      body: issueBody,
    };
  },
});

const createDiscordPostStep = createStep({
  id: 'create-discord-post',
  inputSchema: z.object({
    post: postSchema,
    issue: z.object({
      html_url: z.string(),
      number: z.number(),
      title: z.string(),
      body: z.string(),
    }),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    thread: z.string(),
    githubIssue: z.string(),
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
  }),
  execute: async ({ inputData: { post, issue }, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);

    const thread = await discordClient.channels.fetch(post.id);
    if (thread?.isThread()) {
      await thread.send(`📝 Created GitHub issue: ${issue.html_url}`);
    }

    return { 
      success: true, 
      thread: post.id, 
      githubIssue: issue.html_url,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body,
    };
  },
});

// Step to log analysis readiness (actual analysis workflow should be triggered separately)
const logAnalysisStep = createStep({
  id: 'log-analysis-ready',
  inputSchema: z.object({
    discordPost: postSchema,
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    githubIssue: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    thread: z.string(),
    githubIssue: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    
    logger?.info(
      `Issue #${inputData.issueNumber} created. Ready for first-pass analysis.`,
      {
        issueNumber: inputData.issueNumber,
        issueUrl: inputData.githubIssue,
        discordThread: inputData.discordPost.url,
      }
    );
    
    // Note: The first-pass analysis workflow can be triggered separately
    // via the Mastra server API or by calling:
    // mastra.workflows.firstPassAnalysisWorkflow.execute({...})

    return {
      success: true,
      thread: inputData.discordPost.id,
      githubIssue: inputData.githubIssue,
    };
  },
});

export const createGithubIssueWorkflow = createWorkflow({
  id: 'create-github-issue',
  inputSchema: postSchema,
  outputSchema: z.object({
    success: z.boolean(),
    thread: z.string(),
    githubIssue: z.string(),
  }),
  steps: [createGithubIssueStep, createDiscordPostStep, logAnalysisStep],
})
  .then(createGithubIssueStep)
  .map(async ({ inputData: issue, getInitData }) => {
    return {
      post: getInitData(),
      issue,
    };
  })
  .then(createDiscordPostStep)
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData();
    return {
      discordPost: initData,
      issueNumber: inputData.issueNumber,
      issueTitle: inputData.issueTitle,
      issueBody: inputData.issueBody,
      githubIssue: inputData.githubIssue,
    };
  })
  .then(logAnalysisStep)
  .commit();
