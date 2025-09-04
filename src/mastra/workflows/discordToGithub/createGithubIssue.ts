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
): Promise<string | null> {
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
    return starterMessage.content || null;
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
  }),
  execute: async ({ inputData: post, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);
    const octokit = getGithubClient();
    const title = `[DISCORD:${post.id}] ${post.name}`;
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

    // Create a new issue
    const newIssue = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: `This issue was created from Discord post: ${post.url}\n\n${message}`,
      labels: ['status: needs triage'],
    });

    logger?.debug(`Created new issue: ${newIssue.data.html_url} for ${title}`);

    return newIssue.data;
  },
});

const createDiscordPostStep = createStep({
  id: 'create-discord-post',
  inputSchema: z.object({
    post: postSchema,
    issue: z.object({
      html_url: z.string(),
    }),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ inputData: { post, issue }, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);

    const thread = await discordClient.channels.fetch(post.id);
    if (thread?.isThread()) {
      await thread.send(`📝 Created GitHub issue: ${issue.html_url}`);
    }

    return { success: true };
  },
});

export const createGithubIssueWorkflow = createWorkflow({
  id: 'create-github-issue',
  inputSchema: postSchema,
  outputSchema: z.object({
    success: z.boolean(),
  }),
  steps: [createGithubIssueStep, createDiscordPostStep],
})
  .then(createGithubIssueStep)
  .map(async ({ inputData: issue, getInitData }) => {
    return {
      post: getInitData(),
      issue,
    };
  })
  .then(createDiscordPostStep)
  .commit();
