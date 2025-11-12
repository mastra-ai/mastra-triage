import { createTool } from '@mastra/core';
import { z } from 'zod';
import { mastraDocsClient } from '../mcp/mastra-docs-client';

// MCP tool for searching Mastra documentation
export const searchMastraDocsTool = createTool({
  id: 'search-mastra-docs',
  description: 'Search the Mastra documentation for guides, references, and examples. Use this to find relevant documentation for user questions. Available paths include: agents/, workflows/, tools-mcp/, memory/, rag/, reference/, etc.',
  inputSchema: z.object({
    paths: z.array(z.string()).describe('Documentation paths to fetch (e.g., ["agents/", "workflows/", "reference/agents/"])'),
    queryKeywords: z.array(z.string()).optional().describe('Keywords from the user query to help match documentation'),
  }),
  outputSchema: z.object({
    results: z.string().describe('The documentation content found'),
  }),
  execute: async ({ context: input }) => {
    try {
      // Get tools from the MCP client - returns an object, not an array
      const tools = await mastraDocsClient.getTools();
      
      // Convert to array and find the mastraDocs tool by ID
      const toolsArray = Object.values(tools);
      const mastraDocsTool = toolsArray.find((t: any) => t.id === 'mastraDocs_mastraDocs');
      
      if (!mastraDocsTool) {
        return {
          results: 'Mastra docs tool not found. Make sure @mastra/mcp-docs-server is installed.',
        };
      }

      // Call the tool - MCP tools need arguments wrapped in 'context'
      const result = await mastraDocsTool.execute({
        context: {
          paths: input.paths,
          queryKeywords: input.queryKeywords || [],
        },
      });

      return {
        results: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      };
    } catch (error) {
      console.error('Error calling MCP docs tool:', error);
      return {
        results: `Error searching docs: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure @mastra/mcp-docs-server is installed.`,
      };
    }
  },
});

// MCP tool for searching Mastra examples
export const searchMastraExamplesTool = createTool({
  id: 'search-mastra-examples',
  description: 'Search for code examples from the Mastra examples directory. Use this to find working code samples. You can search by example name or keywords.',
  inputSchema: z.object({
    example: z.string().optional().describe('Name of specific example to fetch (e.g., "memory-todo-agent", "workflow-with-memory"), or leave empty to list all'),
    queryKeywords: z.array(z.string()).optional().describe('Keywords to find relevant examples (e.g., ["memory", "agent"])'),
  }),
  outputSchema: z.object({
    results: z.string().describe('The example code or list of examples'),
  }),
  execute: async ({ context: input }) => {
    try {
      // Get tools from the MCP client - returns an object, not an array
      const tools = await mastraDocsClient.getTools();
      
      // Convert to array and find the mastraExamples tool by ID
      const toolsArray = Object.values(tools);
      const mastraExamplesTool = toolsArray.find((t: any) => t.id === 'mastraDocs_mastraExamples');
      
      if (!mastraExamplesTool) {
        return {
          results: 'Mastra examples tool not found. Make sure @mastra/mcp-docs-server is installed.',
        };
      }

      // Call the tool - MCP tools need arguments wrapped in 'context'
      const result = await mastraExamplesTool.execute({
        context: {
          example: input.example,
          queryKeywords: input.queryKeywords || [],
        },
      });

      return {
        results: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      };
    } catch (error) {
      console.error('Error calling MCP examples tool:', error);
      return {
        results: `Error searching examples: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure @mastra/mcp-docs-server is installed.`,
      };
    }
  },
});
