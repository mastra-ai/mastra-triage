import { createTool } from '@mastra/core';
import { z } from 'zod';
import { mastraDocsClient } from '../mcp/mastra-docs-client';

/**
 * Wrapper around the MCP docs tool that returns SUMMARIZED results
 * to prevent token overflow in agent context
 */
export const searchMastraDocsTool = createTool({
  id: 'search-mastra-docs',
  description: 'Search Mastra documentation. Returns relevant excerpts only, not full docs. Use specific paths like "reference/agents/" or keywords from the issue.',
  inputSchema: z.object({
    paths: z.array(z.string()).describe('Specific doc paths to search (e.g., ["reference/agents/", "workflows/"])'),
    keywords: z.array(z.string()).optional().describe('Keywords to filter results (e.g., ["memory", "context"])'),
  }),
  outputSchema: z.object({
    summary: z.string(),
    relevantSections: z.array(z.object({
      path: z.string(),
      excerpt: z.string(),
    })),
    fullDocsSize: z.string(),
  }),
  execute: async ({ context: input }) => {
    // Get the actual MCP tools
    const mcpTools = await mastraDocsClient.getTools();
    const mastraDocsTool = mcpTools['mastra_mastraDocs'];
    
    if (!mastraDocsTool) {
      throw new Error('MCP docs tool not available');
    }

    try {
      // Call the MCP tool
      const result = await mastraDocsTool.execute({
        context: {
          paths: input.paths,
          queryKeywords: input.keywords,
        },
      });

      // The result is likely a string with all the docs
      const fullDocs = typeof result === 'string' ? result : JSON.stringify(result);
      const fullSize = `${(fullDocs.length / 1024).toFixed(1)} KB`;

      // Extract relevant sections based on keywords
      const relevantSections: Array<{ path: string; excerpt: string }> = [];
      
      if (input.keywords && input.keywords.length > 0) {
        // Split docs into sections
        const sections = fullDocs.split(/^# /m);
        
        for (const section of sections) {
          // Check if section contains any keywords
          const lowerSection = section.toLowerCase();
          const matchedKeywords = input.keywords.filter(kw => 
            lowerSection.includes(kw.toLowerCase())
          );

          if (matchedKeywords.length > 0) {
            // Extract a reasonable excerpt (first 500 chars)
            const lines = section.split('\n');
            const title = lines[0] || 'Unknown';
            const content = lines.slice(1, 15).join('\n'); // First ~15 lines
            
            relevantSections.push({
              path: title.trim(),
              excerpt: content.substring(0, 800) + (content.length > 800 ? '...[truncated]' : ''),
            });
          }
        }
      }

      // If no keywords or no matches, take first few sections
      if (relevantSections.length === 0) {
        const lines = fullDocs.split('\n');
        relevantSections.push({
          path: input.paths[0],
          excerpt: lines.slice(0, 30).join('\n') + '\n...[Full docs truncated. Use more specific keywords to get relevant sections]',
        });
      }

      // Limit to top 3 sections to keep context small
      const limitedSections = relevantSections.slice(0, 3);

      return {
        summary: `Found ${relevantSections.length} relevant sections in ${input.paths.join(', ')}. Full docs size: ${fullSize}. Showing top ${limitedSections.length} sections.`,
        relevantSections: limitedSections,
        fullDocsSize: fullSize,
      };
    } catch (error) {
      console.error('Error calling MCP docs:', error);
      return {
        summary: `Error accessing docs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        relevantSections: [],
        fullDocsSize: '0 KB',
      };
    }
  },
});

