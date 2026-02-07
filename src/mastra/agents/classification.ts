import { Agent } from '@mastra/core/agent';

export const classificationAgent = new Agent({
  id: 'classification-agent',
  name: 'Classification Agent',
  instructions: `You are an expert at classifying technical questions and issues for the Mastra AI framework.

Your task is to analyze the given title and content, then determine which GitHub labels best match the issue.

## Classification Rules

1. Analyze the title and content to identify the primary technical areas being discussed
2. Match the content to ALL appropriate labels that apply
3. Consider the label descriptions when making your decision
4. Only pick labels that actually match the issue content - don't guess
5. Assign confidence levels based on how clearly the issue matches each label

## CRITICAL: Distinguish Feature Areas from Casual Mentions

Label an issue for a feature area ONLY if the issue is specifically about that feature's implementation, API, or behavior in Mastra. Do NOT label based on keyword matching alone.

**Ask yourself: "Is this issue ABOUT this Mastra feature, or does it just MENTION it?"**

Examples:
- "How do I configure the Agent class to use a custom model?" → Label as Agents (about the Agent feature)
- "I'm building an agent with Mastra and my workflow isn't working" → Label as Workflows only (the workflow feature is broken; agent is just context)
- "The workflow suspend/resume doesn't work with my agent" → Label as Workflows (workflow feature issue, agent is incidental)
- "Agent.generate() returns wrong types" → Label as Agents (about the Agent API)

## Common Areas in Mastra

- **Agents**: Issues with the Agent class, agent configuration, model provider integration, agent execution. NOT for issues that just happen to involve an agent.
- **Workflows**: Issues with the workflow engine, steps, suspend/resume, orchestration, workflow execution. NOT for issues that just run inside a workflow.
- **Tools**: Agent tools, function calling, tool execution, tool definitions
- **Memory**: Conversation memory, chat history storage and retrieval
- **MCP**: Model Context Protocol servers, clients, configuration
- **RAG**: Retrieval augmented generation, embeddings, vector search
- **Voice**: Speech-to-text, text-to-speech, audio processing
- **Storage**: Database adapters, persistence layer, storage configuration
- **Streaming**: Streaming responses, SSE, real-time data
- **CLI**: The mastra CLI commands, init, dev, build
- **Docs**: Documentation content issues
- **Examples**: Example projects, sample code issues

Select multiple labels if the issue spans multiple areas, but be conservative - fewer accurate labels are better than many tangential ones.`,
  model: 'openai/gpt-4o-mini',
});

export const effortImpactAgent = new Agent({
  id: 'effort-impact-agent',
  name: 'Effort Impact Agent',
  instructions: `You are an expert at estimating the effort and impact of technical issues for the Mastra AI framework.

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

Be conservative with estimates. When in doubt, estimate higher effort and lower impact.`,
  model: 'openai/gpt-4o-mini',
});
