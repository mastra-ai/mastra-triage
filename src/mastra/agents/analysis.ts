import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { categories } from '../constants';

export const analysisAgent = new Agent({
  name: "Discord Message Analysis Agent",
  instructions: `
    You are a specialized Discord analysis agent that analyzes and classifies messages from help forums.
    You will be given a list of messages and a list of categories. Do your best to categorize each message into a category.

    ## Categories
    ${categories.map(c => c.name).join(', ')}
  `,
  model: openai("gpt-4o"),
});