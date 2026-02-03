import { createStep, createWorkflow } from '@mastra/core/workflows';
import { postSchema } from '../../shared/post';
import { getDiscordClient } from '../../shared/discord';
import { getGithubClient } from '../../shared/github';
import { z } from 'zod';
import { Client } from 'discord.js';
import { IMastraLogger } from '@mastra/core/logger';
import { classifyAreaStep, fetchLabelsStep, labelSquadStep, estimateEffortImpactStep } from '../classification';

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

/**
 * Step to fetch Discord message content for classification
 */
const fetchDiscordContentStep = createStep({
  id: 'fetch-discord-content',
  inputSchema: postSchema,
  outputSchema: z.object({
    post: postSchema,
    content: z.string(),
    images: z.array(z.string()),
  }),
  execute: async ({ inputData: post, mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);

    const message = await getFirstThreadMessage(
      {
        client: discordClient,
        threadId: post.id,
      },
      logger,
    );

    return {
      post,
      content: message?.content || '',
      images: message?.images || [],
    };
  },
});

const createGithubIssueInputSchema = z.object({
  post: postSchema,
  content: z.string(),
  images: z.array(z.string()),
  areaLabels: z.array(z.string()).describe('Classified area labels from AI'),
  squadLabels: z.array(z.string()).describe('Squad labels derived from area classifications'),
  effortLabel: z.string().nullable().describe('Effort estimate label'),
  impactLabel: z.string().nullable().describe('Impact estimate label'),
});

const createGithubIssueStep = createStep({
  id: 'create-github-issue',
  inputSchema: createGithubIssueInputSchema,
  outputSchema: z.object({
    html_url: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { post, content, images, areaLabels, squadLabels, effortLabel, impactLabel } = inputData;
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();
    const title = post.name;
    const owner = 'mastra-ai';
    const repo = 'mastra';

    // Format the message content
    let bodyContent = content || '';

    // Add images if any exist
    if (images && images.length > 0) {
      const imageMarkdown = images.map((url, index) => `![Screenshot ${index + 1}](${url})`).join('\n\n');

      // Add images after the message content
      if (bodyContent) {
        bodyContent += '\n\n---\n\n' + imageMarkdown;
      } else {
        bodyContent = imageMarkdown;
      }
    }

    // Build labels array - base labels + area labels + squad labels + effort/impact
    const labels = ['status: needs triage', 'discord', ...areaLabels, ...squadLabels];

    if (effortLabel) {
      labels.push(effortLabel);
    }
    if (impactLabel) {
      labels.push(impactLabel);
    }

    if (areaLabels.length > 0) {
      logger?.debug(`Creating GitHub issue with area labels: ${areaLabels.join(', ')}`);
    }
    if (squadLabels.length > 0) {
      logger?.debug(`Creating GitHub issue with squad labels: ${squadLabels.join(', ')}`);
    }
    if (effortLabel || impactLabel) {
      logger?.debug(`Creating GitHub issue with effort: ${effortLabel}, impact: ${impactLabel}`);
    }

    // Create a new issue
    const newIssue = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: `This issue was created from Discord post ${post.id}:\n\n[![Open in Discord](https://img.shields.io/badge/Open_in_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](${post.url})\n\n${bodyContent}`,
      labels,
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
      await thread.send(
        `📝 Created GitHub issue: <${issue.html_url}>\n\n` +
          `🔍 If you're experiencing an error, please provide a [minimal reproducible example](<https://github.com/mastra-ai/mastra/blob/main/CONTRIBUTING.md#minimal-reproduction>) whenever possible to help us resolve it quickly.\n\n` +
          `💡 You can also ask your question in the <#1452669948718616760> channel to potentially get faster help.\n\n` +
          `🙏 Thank you for helping us improve Mastra!`,
      );
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
})
  // Step 1: Fetch Discord message content
  .then(fetchDiscordContentStep)
  // Step 2: Fetch labels from GitHub
  .map(async ({ inputData }) => {
    return {
      title: inputData.post.name,
      content: inputData.content,
    };
  })
  .then(fetchLabelsStep)
  // Step 3: Classify the area using LLM (returns multiple labels)
  .then(classifyAreaStep)
  // Step 4: Label with squad based on area classifications
  .then(labelSquadStep)
  // Step 5: Estimate effort and impact
  .then(estimateEffortImpactStep)
  // Step 6: Create GitHub issue with all labels
  .map(async ({ inputData: classification, getStepResult }) => {
    const discordContent = getStepResult(fetchDiscordContentStep);
    // Extract label names from the classification result
    const areaLabels = classification.labels.map(l => l.label);
    return {
      post: discordContent.post,
      content: discordContent.content,
      images: discordContent.images,
      areaLabels,
      squadLabels: classification.squadLabels,
      effortLabel: classification.effortLabel,
      impactLabel: classification.impactLabel,
    };
  })
  .then(createGithubIssueStep)
  // Step 7: Post back to Discord
  .map(async ({ inputData: issue, getStepResult }) => {
    const discordContent = getStepResult(fetchDiscordContentStep);
    return {
      post: discordContent.post,
      issue,
    };
  })
  .then(createDiscordPostStep)
  .commit();
