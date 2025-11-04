import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../shared/github';

const owner = 'mastra-ai';
const repo = 'mastra';

const initialInput = z.object({
  owner: z.string().default(owner),
  repo: z.string().default(repo),
  issueNumber: z.number(),
});
const triageOutput = z.object({
  product_area: z.string(),
  assignee: z.string(),
  reason: z.string(),
  github_username: z.string(),
});

const fetchPullRequestsStep = createStep({
  id: 'fetch-pull-request',
  inputSchema: initialInput,
  outputSchema: z.object({
    title: z.string(),
    body: z.string().nullable(),
  }),
  execute: async ({ inputData }) => {
    const octokit = getGithubClient();

    const issue = await octokit.rest.issues.get({
      owner: inputData.owner,
      repo: inputData.repo,
      issue_number: inputData.issueNumber,
    });

    return {
      title: issue.data.title,
      body: issue.data.body ?? null,
    };
  },
});

const callTriageAgentStep = createStep({
  id: 'call-triage-agent',
  inputSchema: z.object({
    title: z.string(),
    body: z.string().nullable(),
  }),
  outputSchema: triageOutput,
  async execute({ inputData, mastra }) {
    const prompt = `Issue Title: ${inputData.title}
Issue Body: ${inputData.body ?? ''}`;

    const traigeAgent = mastra.getAgentById('triageAgent');
    const result = await traigeAgent.generate(prompt, {
      structuredOutput: {
        schema: triageOutput,
      },
    });

    return result.object;
  },
});

const wrapUpStep = createStep({
  id: 'wrap-up',
  inputSchema: triageOutput,
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ inputData, getInitData }) => {
    const octokit = getGithubClient();

    const { owner, repo, issueNumber } = getInitData();

    // Label the issue
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: Number(issueNumber),
      labels: [inputData.product_area, 'status: needs triage'],
    });

    const userName = inputData.github_username.startsWith('@')
      ? inputData.github_username.slice(1)
      : inputData.github_username;

    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: Number(issueNumber),
      assignees: [userName],
    });

    console.log(`Assigned ${inputData.github_username} to issue #${PR}`);

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: Number(issueNumber),
      body: `Thank you for reporting this issue! We have assigned it to @${userName} and will look into it as soon as possible.`,
    });

    console.log(`Commented on issue #${issueNumber}`);

    return { success: true };
  },
});

export const triageWorkflow = createWorkflow({
  id: 'triage',
  inputSchema: initialInput,
  outputSchema: triageOutput,
  steps: [fetchPullRequestsStep, callTriageAgentStep, wrapUpStep],
})
  .then(fetchPullRequestsStep)
  .then(callTriageAgentStep)
  .then(wrapUpStep)
  .commit();
