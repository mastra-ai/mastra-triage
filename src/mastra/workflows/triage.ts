import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../shared/github';
import { getMemberByLogin } from '../constants/members';

const owner = 'mastra-ai';
const repo = 'mastra';

const initialInput = z.object({
  owner: z.string().default(owner),
  repo: z.string().default(repo),
  issueNumber: z.number(),
});
const triageOutput = z.object({
  product_area: z.string(),
  squad: z.string(),
  assignees: z.array(z.string()),
  reason: z.string(),
});

const outputSchema = z.object({
  issueNumber: z.boolean(),
  result: z.object({
    assignees: z.array(z.string()),
    labels: z.array(z.string()),
  }),
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
  outputSchema: outputSchema,
  execute: async ({ inputData, getInitData }) => {
    const octokit = getGithubClient();

    const { owner, repo, issueNumber } = getInitData();

    const labels = [inputData.product_area, 'status: needs triage', inputData.squad];
    // Label the issue
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: Number(issueNumber),
      labels,
    });

    const assignees = inputData.assignees.map(assignee => getMemberByLogin(assignee)!.login).filter(Boolean);

    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: Number(issueNumber),
      assignees,
    });

    console.log(`Assigned ${assignees.join(', ')} to issue #${issueNumber}`);

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: Number(issueNumber),
      body: 
      `Thank you for reporting this issue! We have assigned it to the ${inputData.squad} and we will look into it as soon as possible.\n\n`+
      `🔍 If you're experiencing an error, please provide a [minimal reproducible example](https://github.com/mastra-ai/mastra/blob/main/CONTRIBUTING.md#minimal-reproduction) to help us resolve it quickly.`,
    });

    console.log(`Commented on issue #${issueNumber}`);

    return {
      issueNumber,
      result: {
        assignees,
        labels,
      },
    };
  },
});

export const triageWorkflow = createWorkflow({
  id: 'triage',
  inputSchema: initialInput,
  outputSchema: outputSchema,
  steps: [fetchPullRequestsStep, callTriageAgentStep, wrapUpStep],
})
  .then(fetchPullRequestsStep)
  .then(callTriageAgentStep)
  .then(wrapUpStep)
  .commit();
