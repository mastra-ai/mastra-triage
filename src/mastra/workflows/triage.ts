import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getGithubClient } from '../shared/github';
import {
  fetchLabelsStep,
  classifyAreaStep,
  labelSquadStep,
  estimateEffortImpactStep,
  classificationOutputSchema,
} from './classification';

const owner = 'mastra-ai';
const repo = 'mastra';

const initialInput = z.object({
  owner: z.string().default(owner),
  repo: z.string().default(repo),
  issueNumber: z.number(),
});

const outputSchema = z.object({
  issueNumber: z.number(),
  result: z.object({
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
  }),
});

/**
 * Step 1: Fetch the GitHub issue details
 */
const fetchIssueStep = createStep({
  id: 'fetch-issue',
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

/**
 * Final step: Report the classification result without touching the issue
 */
const completeTriageStep = createStep({
  id: 'complete-triage',
  inputSchema: classificationOutputSchema,
  outputSchema: outputSchema,
  execute: async ({ inputData, getInitData, mastra }) => {
    const logger = mastra?.getLogger();
    const { issueNumber } = getInitData<any>();

    const labels = inputData.labels.map(l => l.label);
    const primarySquad = inputData.squadLabels[0] || 'the team';

    logger?.info(`Classified issue #${issueNumber} for ${primarySquad}: ${labels.join(', ') || 'no area labels'}`);

    return {
      issueNumber,
      result: {
        labels,
        assignees: [],
      },
    };
  },
});

/**
 * Triage Workflow
 *
 * Fetches and classifies a GitHub issue, then reports the classification result.
 * The workflow is read-only: it never writes to the issue.
 */
export const triageWorkflow = createWorkflow({
  id: 'triage',
  inputSchema: initialInput,
  outputSchema: outputSchema,
})
  // Step 1: Fetch the issue details
  .then(fetchIssueStep)
  // Step 2: Transform to classification input format and fetch labels
  .map(async ({ inputData }) => {
    return {
      title: inputData.title,
      content: inputData.body || '',
    };
  })
  .then(fetchLabelsStep)
  // Step 3: Classify the area using LLM
  .then(classifyAreaStep)
  // Step 4: Derive squad labels from area classifications
  .then(labelSquadStep)
  // Step 5: Estimate effort and impact
  .then(estimateEffortImpactStep)
  // Step 6: Report the classification result
  .then(completeTriageStep)
  .commit();
