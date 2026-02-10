import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { fetchForumPosts } from '../../tools/fetchForumPosts';
import { postSchema } from '../../shared/post';
import { getGithubClient } from '../../shared/github';
import { createGithubIssueWorkflow } from './createGithubIssue';

const owner = 'mastra-ai';
const repo = 'mastra';

const getGithubIssueStep = createStep({
  id: 'get-github-issue',
  inputSchema: postSchema,
  outputSchema: z.object({
    hasIssue: z.boolean(),
  }),
  execute: async ({ inputData: post, mastra }) => {
    const octokit = getGithubClient();

    // Search for existing issues with the discord label and post ID in body
    // OR the old format with post ID in title (backwards compatible)
    const { data: searchResults } = await octokit.request('GET /search/issues', {
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
      advanced_search: 'true',
      q: `is:issue (label:discord "${post.id}" OR in:title "[DISCORD:${post.id}]") repo:${owner}/${repo}`,
      per_page: 1,
      sort: 'updated',
      order: 'desc',
    });

    const hasIssue = searchResults.items.length > 0;
    if (hasIssue) {
      const logger = mastra?.getLogger();
      logger?.debug(`Found existing issue: ${searchResults.items[0].html_url}`);
    }
    return { hasIssue };
  },
});

const processPostWorkflow = createWorkflow({
  id: 'process-post',
  inputSchema: postSchema,
  outputSchema: z.object({
    success: z.boolean(),
  }),
  steps: [getGithubIssueStep, createGithubIssueWorkflow],
})
  .sleep(1000)
  .then(getGithubIssueStep)
  .map(async ({ getInitData }) => {
    return getInitData<any>() as z.infer<typeof postSchema>;
  })
  .branch([
    [
      async ({ inputData, getStepResult }) => {
        const { hasIssue } = getStepResult(getGithubIssueStep);
        if (hasIssue) {
          return false;
        }

        const { tags } = inputData;
        return !tags.includes('skip-github');
      },
      createStep(createGithubIssueWorkflow as any),
    ],
    [
      async ({ inputData, getStepResult }) => {
        const { hasIssue } = getStepResult(getGithubIssueStep);
        const { tags } = inputData;

        return hasIssue;
      },
      createStep({
        id: 'has-issue',
        inputSchema: postSchema,
        outputSchema: z.object({
          success: z.boolean(),
          id: z.string(),
        }),
        execute: async ({ inputData }) => {
          return { success: true, id: inputData.id };
        },
      }),
    ],
    [
      async ({ inputData, getStepResult }) => {
        const { hasIssue } = getStepResult(getGithubIssueStep);
        const { tags } = inputData;

        return !hasIssue && tags.includes('skip-github');
      },
      createStep({
        id: 'skip-github',
        inputSchema: postSchema,
        outputSchema: z.object({
          success: z.boolean(),
          id: z.string(),
          tags: z.array(z.string()),
        }),
        execute: async ({ inputData }) => {
          const { tags, id } = inputData;

          return { success: true, id, tags };
        },
      }),
    ],
  ])
  .commit();

const fetchPostsStep = createStep(fetchForumPosts);

export const discordToGithubWorkflow = createWorkflow({
  id: 'discord-to-github',
  inputSchema: z.object({
    forumChannelId: z.string(),
    fetchLimit: z.coerce.number().optional().default(1),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
})
  .then(fetchPostsStep)
  .map(async ({ inputData: { posts } }) => {
    return posts;
  })
  .foreach(processPostWorkflow, { concurrency: 1 })
  .commit();
