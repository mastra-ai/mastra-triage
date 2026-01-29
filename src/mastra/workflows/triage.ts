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
 * Final step: Apply all labels to the GitHub issue
 */
const applyLabelsStep = createStep({
  id: 'apply-labels',
  inputSchema: classificationOutputSchema,
  outputSchema: outputSchema,
  execute: async ({ inputData, getInitData, mastra }) => {
    const logger = mastra?.getLogger();
    const octokit = getGithubClient();
    const { owner, repo, issueNumber } = getInitData();

    // Get existing labels on the issue to avoid duplicates
    const existingIssue = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: Number(issueNumber),
    });
    const existingLabels = existingIssue.data.labels.map(l => (typeof l === 'string' ? l : l.name || ''));

    // Remove existing effort/impact labels to avoid duplicates
    const labelsToRemove = existingLabels.filter(
      l => l.toLowerCase().startsWith('effort:') || l.toLowerCase().startsWith('impact:'),
    );
    for (const label of labelsToRemove) {
      try {
        await octokit.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: Number(issueNumber),
          name: label,
        });
        logger?.debug(`Removed existing label: ${label}`);
      } catch {
        // Label might not exist, ignore
      }
    }

    // Build labels array from classification results
    const areaLabels = inputData.labels.map(l => l.label);
    const labels = ['status: needs triage', ...areaLabels, ...inputData.squadLabels];

    if (inputData.effortLabel) {
      labels.push(inputData.effortLabel);
    }
    if (inputData.impactLabel) {
      labels.push(inputData.impactLabel);
    }

    // Label the issue
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: Number(issueNumber),
      labels,
    });

    logger?.info(`Labeled issue #${issueNumber} with: ${labels.join(', ')}`);

    // Find the primary squad for the comment
    const primarySquad = inputData.squadLabels[0] || 'the team';

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: Number(issueNumber),
      body:
        `Thank you for reporting this issue! We have labeled it for ${primarySquad} and we will look into it as soon as possible.\n\n` +
        `If you're experiencing an error, please provide a [minimal reproducible example](https://github.com/mastra-ai/mastra/blob/main/CONTRIBUTING.md#minimal-reproduction) whenever possible to help us resolve it quickly.`,
    });

    logger?.info(`Commented on issue #${issueNumber}`);

    return {
      issueNumber,
      result: {
        labels,
      },
    };
  },
});

/**
 * Triage Workflow
 *
 * Fetches a GitHub issue, classifies it using the shared classification workflow steps,
 * and applies all appropriate labels including:
 * - Area labels (e.g., "area: workflows", "area: agents")
 * - Squad labels (e.g., "trio-tnt", "trio-tb")
 * - Effort labels (e.g., "effort: low", "effort: high")
 * - Impact labels (e.g., "impact: low", "impact: high")
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
  // Step 6: Apply all labels to the issue
  .then(applyLabelsStep)
  .commit();
