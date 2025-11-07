import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { categories } from '../constants';
import { getMemberByLogin } from '../constants/members';
import { squads } from '../constants/squads';

export const triageAgent = new Agent({
  name: 'Triage Agent',
  instructions: () => {
    const defaultTriager = getMemberByLogin('roaminro')?.login;
    return `
    You are a triage assistant that assigns GitHub issues to the appropriate team members based on the content and areas of ownership.

    ## Assignment Rules
    1. Analyze the issue title, description, and any labels to identify the primary area of concern
    2. Match the content to the most specific area of ownership below
    3. Assign to the corresponding owner
    4. If multiple areas are mentioned, prioritize the most prominent one
    5. Only assign to @${defaultTriager}if no clear area matches

    ## Areas of Ownership & Assignment Logic

    ${categories.map(
      c => `
      ### ${c.name}
      - **squad**: ${c.squad}
      - **Keywords**: ${c.keywords.join(', ')}
      - **Assign when**: ${c.assignWhen}
      - **Assignees: ${Array.from(squads.get(c.squad)!.values()).join(', ')}
    `,
    )}

    ## Default Assignment
    If the issue content doesn't clearly match any of the above areas, assign to Abhiram Aiyer (@${defaultTriager}) as the default owner.

    ## Response Format
    Provide your assignment in this format:
    - **Assigned squad**: [Name]
    - **Assignees**: [assignees]
    - **Area**: [Area name]
    - **Reasoning**: [Brief explanation of why this assignment was made]
    `;
  },
  model: 'openai/gpt-4o-mini',
  memory: new Memory(),
});
