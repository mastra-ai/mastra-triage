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
    const newIssue = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: `This issue was created from Discord post ${post.id}:\n\n[![Open in Discord](https://img.shields.io/badge/Open_in_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](${post.url})\n\n${bodyContent}`,
      labels: ['status: needs triage', 'discord'],
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
    thread: z.string(),
    githubIssue: z.string(),
  }),
  execute: async ({ inputData: { post, issue }, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);

    const thread = await discordClient.channels.fetch(post.id);
    if (thread?.isThread()) {
      const starterMessage = await thread.fetchStarterMessage();
      const authorMention = starterMessage?.author ? `<@${starterMessage.author.id}>` : '';
      await thread.send(`
        📝 Created GitHub issue: ${issue.html_url}
        🔍 If you're experiencing an error, please provide a [minimal reproducible example](https://stackoverflow.com/help/minimal-reproducible-example) to help us resolve it quickly.
        🙏 Thank you ${authorMention} for helping us improve Mastra!
      `);
    }

    return { success: true, thread: post.id, githubIssue: issue.html_url };
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
