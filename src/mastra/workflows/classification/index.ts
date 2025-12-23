import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getRepoLabels } from '../../shared/github';
import { categories } from '../../constants';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';

/**
 * Input schema for classification
 */
export const classificationInputSchema = z.object({
  title: z.string().describe('Title of the issue or thread'),
  content: z.string().describe('Content/body of the issue or thread'),
});

export type ClassificationInput = z.infer<typeof classificationInputSchema>;

/**
 * Schema for a single label classification
 */
const labelClassificationSchema = z.object({
  label: z.string().describe('The exact label name from the list'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Classification confidence'),
});

/**
 * Output schema for classification - supports multiple labels including squad labels
 */
export const classificationOutputSchema = z.object({
  labels: z.array(labelClassificationSchema).describe('Array of classified labels'),
  squadLabels: z.array(z.string()).describe('Squad labels derived from area classifications'),
  effortLabel: z.string().nullable().describe('Effort estimate label'),
  impactLabel: z.string().nullable().describe('Impact estimate label'),
  reasoning: z.string().describe('Explanation for the classification'),
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

/**
 * Step: Fetch available labels from GitHub
 */
const fetchLabelsStep = createStep({
  id: 'fetch-labels',
  inputSchema: classificationInputSchema,
  outputSchema: z.object({
    title: z.string(),
    content: z.string(),
    labels: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullable(),
      }),
    ),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    let labels: { name: string; description: string | null }[] = [];
    try {
      labels = await getRepoLabels();
    } catch (error) {
      logger?.error('Failed to fetch GitHub labels:', error);
    }

    return {
      title: inputData.title,
      content: inputData.content,
      labels,
    };
  },
});

/**
 * System prompt for the classification step
 */
const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert at classifying technical questions and issues for the Mastra AI framework.

Your task is to analyze the given title and content, then determine which GitHub labels best match the issue.

## Classification Rules

1. Analyze the title and content to identify the primary technical areas being discussed
2. Match the content to ALL appropriate labels that apply
3. Consider the label descriptions when making your decision
4. Only pick labels that actually match the issue content - don't guess
5. Assign confidence levels based on how clearly the issue matches each label

## Common Areas in Mastra

- **Agents**: AI agents, LLM integration, model providers (OpenAI, Anthropic, etc.)
- **Workflows**: Workflow engine, steps, orchestration, suspend/resume
- **Tools**: Agent tools, function calling, tool execution
- **Memory**: Conversation memory, chat history
- **MCP**: Model Context Protocol
- **RAG**: Retrieval augmented generation, embeddings, vector search
- **Voice**: Speech-to-text, text-to-speech, audio
- **Storage**: Databases, persistence, data storage
- **Streaming**: Real-time responses, SSE, streaming
- **CLI**: Command line interface, mastra commands
- **Docs**: Documentation issues
- **Examples**: Example projects, sample code

Select multiple labels if the issue spans multiple areas.`;

/**
 * Step: Classify issue/thread area using LLM
 * Filters out squad (trio-*), effort, and impact labels - those are handled by other steps
 * Returns multiple area labels if they are all applicable
 */
const classifyAreaStep = createStep({
  id: 'classify-area',
  inputSchema: z.object({
    title: z.string(),
    content: z.string(),
    labels: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullable(),
      }),
    ),
  }),
  outputSchema: z.object({
    labels: z.array(labelClassificationSchema),
    reasoning: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { title, content, labels } = inputData;

    // Filter out labels that are handled by other steps:
    // - trio-* labels (squad labels)
    // - effort:* labels
    // - impact:* labels
    const areaLabels = labels.filter(l => {
      const name = l.name.toLowerCase();
      return !name.startsWith('trio-') && !name.startsWith('effort:') && !name.startsWith('impact:');
    });

    if (areaLabels.length === 0) {
      return {
        labels: [],
        reasoning: 'No area labels available for classification',
      };
    }

    // Format labels for the prompt
    const labelList = areaLabels
      .map(l => `- "${l.name}"${l.description ? `: ${l.description}` : ''}`)
      .join('\n');

    const prompt = `Here are the available GitHub labels for this repository:

${labelList}

Please classify this issue/question and select ALL appropriate labels from the list above.

**Title:** ${title}

**Content:**
${content}

**Instructions:**
- Select multiple labels if the issue spans multiple areas (e.g., a bug in the workflow engine might get both "area: workflows" and "bug")
- Only include labels you are confident about (medium or high confidence)
- Don't include labels that are only tangentially related
- Only return labels from the list provided above`;

    try {
      const result = await generateObject({
        model: openai('gpt-4o-mini'),
        system: CLASSIFICATION_SYSTEM_PROMPT,
        prompt,
        schema: z.object({
          labels: z
            .array(
              z.object({
                label: z.string().describe('The exact label name from the list'),
                confidence: z.enum(['high', 'medium', 'low']).describe('Classification confidence'),
              }),
            )
            .describe('Array of applicable labels with confidence levels'),
          reasoning: z.string().describe('Brief explanation of why these labels were chosen'),
        }),
      });

      const classification = result.object;

      // Filter to only include valid labels that exist in the filtered area labels
      // and have at least medium confidence
      const validLabels = classification.labels.filter(l => {
        const exists = areaLabels.some(repoLabel => repoLabel.name === l.label);
        if (!exists) {
          logger?.warn(`Label "${l.label}" not found in repo, skipping`);
        }
        return exists && (l.confidence === 'high' || l.confidence === 'medium');
      });

      logger?.debug(
        `Classified "${title}" with ${validLabels.length} labels: ${validLabels.map(l => l.label).join(', ')}`,
      );

      return {
        labels: validLabels,
        reasoning: classification.reasoning,
      };
    } catch (error) {
      logger?.error('Error classifying:', error);
      return {
        labels: [],
        reasoning: `Error during classification: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});

/**
 * Maps area labels to their corresponding squad based on the categories constant.
 * Returns unique squad labels for the classified areas.
 */
function getSquadsForLabels(labels: string[]): string[] {
  const squads = new Set<string>();

  for (const label of labels) {
    // Normalize the label for matching (e.g., "area: workflows" -> "workflows")
    const normalizedLabel = label.toLowerCase().replace(/^area:\s*/i, '').trim();

    // Find matching category by name or keywords
    for (const category of categories) {
      const categoryNameLower = category.name.toLowerCase();
      const keywordsLower = category.keywords.map(k => k.toLowerCase());

      // Match by exact category name or if label contains the category name
      if (
        categoryNameLower === normalizedLabel ||
        normalizedLabel.includes(categoryNameLower) ||
        keywordsLower.some(keyword => normalizedLabel.includes(keyword) || keyword.includes(normalizedLabel))
      ) {
        squads.add(category.squad);
        break;
      }
    }
  }

  return Array.from(squads);
}

/**
 * Step: Label with squad based on classified area labels
 * Uses the categories constant to map areas to their responsible squads
 */
const labelSquadStep = createStep({
  id: 'label-squad',
  inputSchema: z.object({
    labels: z.array(labelClassificationSchema),
    reasoning: z.string(),
  }),
  outputSchema: z.object({
    labels: z.array(labelClassificationSchema),
    squadLabels: z.array(z.string()),
    reasoning: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { labels, reasoning } = inputData;

    // Extract just the label names
    const labelNames = labels.map(l => l.label);

    // Get squad labels based on the classified area labels
    const squadLabels = getSquadsForLabels(labelNames);

    if (squadLabels.length > 0) {
      logger?.debug(`Assigned squads for labels [${labelNames.join(', ')}]: ${squadLabels.join(', ')}`);
    } else {
      logger?.debug(`No squad mapping found for labels: ${labelNames.join(', ')}`);
    }

    return {
      labels,
      squadLabels,
      reasoning,
    };
  },
});

/**
 * System prompt for effort/impact estimation
 */
const EFFORT_IMPACT_SYSTEM_PROMPT = `You are an expert at estimating the effort and impact of technical issues for the Mastra AI framework.

Your task is to analyze the given issue and estimate:

1. **Effort**: How much work is required to address this issue?
   - Consider: code complexity, scope of changes, testing requirements, documentation needs
   - Low: Quick fix, typo, small config change, simple bug
   - Medium: Moderate code changes, new small feature, bug requiring investigation
   - High: Major feature, architectural changes, significant refactoring

2. **Impact**: How much value does resolving this issue provide?
   - Consider: number of users affected, severity of the problem, strategic importance
   - Low: Edge case, minor inconvenience, affects few users
   - Medium: Affects subset of users, moderate improvement, nice-to-have
   - High: Affects many users, critical bug, blocking issue, security concern

Be conservative with estimates. When in doubt, estimate higher effort and lower impact.`;

/**
 * Step: Estimate effort and impact using LLM
 * Uses separate LLM call to avoid biasing area classification
 */
const estimateEffortImpactStep = createStep({
  id: 'estimate-effort-impact',
  inputSchema: z.object({
    labels: z.array(labelClassificationSchema),
    squadLabels: z.array(z.string()),
    reasoning: z.string(),
  }),
  outputSchema: classificationOutputSchema,
  execute: async ({ inputData, mastra, getStepResult }) => {
    const logger = mastra?.getLogger();
    const { labels, squadLabels, reasoning } = inputData;

    // Get the original title and content from the fetch-labels step
    const fetchLabelsResult = getStepResult(fetchLabelsStep);
    const { title, content, labels: allLabels } = fetchLabelsResult;

    // Filter to only effort and impact labels
    const effortLabels = allLabels.filter(l => l.name.toLowerCase().startsWith('effort:'));
    const impactLabels = allLabels.filter(l => l.name.toLowerCase().startsWith('impact:'));

    // If no effort/impact labels exist in the repo, skip estimation
    if (effortLabels.length === 0 && impactLabels.length === 0) {
      logger?.debug('No effort/impact labels found in repo, skipping estimation');
      return {
        labels,
        squadLabels,
        effortLabel: null,
        impactLabel: null,
        reasoning,
      };
    }

    const effortLabelList = effortLabels
      .map(l => `- "${l.name}"${l.description ? `: ${l.description}` : ''}`)
      .join('\n');

    const impactLabelList = impactLabels
      .map(l => `- "${l.name}"${l.description ? `: ${l.description}` : ''}`)
      .join('\n');

    const prompt = `Estimate the effort and impact for this issue.

**Title:** ${title}

**Content:**
${content}

${effortLabels.length > 0 ? `**Available Effort Labels:**\n${effortLabelList}\n` : ''}
${impactLabels.length > 0 ? `**Available Impact Labels:**\n${impactLabelList}\n` : ''}

Select exactly ONE effort label and ONE impact label from the lists above (if available).
Provide brief reasoning for each estimate.`;

    try {
      const result = await generateObject({
        model: openai('gpt-4o-mini'),
        system: EFFORT_IMPACT_SYSTEM_PROMPT,
        prompt,
        schema: z.object({
          effortLabel: z
            .string()
            .nullable()
            .describe('The exact effort label name from the list, or null if no effort labels available'),
          impactLabel: z
            .string()
            .nullable()
            .describe('The exact impact label name from the list, or null if no impact labels available'),
          effortReasoning: z.string().describe('Brief explanation for the effort estimate'),
          impactReasoning: z.string().describe('Brief explanation for the impact estimate'),
        }),
      });

      const estimation = result.object;

      // Validate that selected labels exist
      const validEffortLabel =
        estimation.effortLabel && effortLabels.some(l => l.name === estimation.effortLabel)
          ? estimation.effortLabel
          : null;

      const validImpactLabel =
        estimation.impactLabel && impactLabels.some(l => l.name === estimation.impactLabel)
          ? estimation.impactLabel
          : null;

      if (validEffortLabel) {
        logger?.debug(`Estimated effort: ${validEffortLabel} - ${estimation.effortReasoning}`);
      }
      if (validImpactLabel) {
        logger?.debug(`Estimated impact: ${validImpactLabel} - ${estimation.impactReasoning}`);
      }

      return {
        labels,
        squadLabels,
        effortLabel: validEffortLabel,
        impactLabel: validImpactLabel,
        reasoning,
      };
    } catch (error) {
      logger?.error('Error estimating effort/impact:', error);
      return {
        labels,
        squadLabels,
        effortLabel: null,
        impactLabel: null,
        reasoning,
      };
    }
  },
});

/**
 * Classification Workflow
 *
 * Takes a title and content, classifies it using an LLM,
 * and returns all applicable GitHub labels plus squad assignments.
 *
 * This workflow can be extended with additional classification steps
 * such as sentiment analysis, priority detection, duplicate detection, etc.
 */
export const classificationWorkflow = createWorkflow({
  id: 'classification',
  inputSchema: classificationInputSchema,
  outputSchema: classificationOutputSchema,
})
  .then(fetchLabelsStep)
  .then(classifyAreaStep)
  .then(labelSquadStep)
  .then(estimateEffortImpactStep)
  .commit();

// Re-export steps for use in other workflows
export { classifyAreaStep, fetchLabelsStep, labelSquadStep, estimateEffortImpactStep };
