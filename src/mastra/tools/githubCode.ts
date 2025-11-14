import { createTool } from '@mastra/core';
import { z } from 'zod';
import { getGithubClient } from '../shared/github';

const MASTRA_OWNER = 'graysonhicks';
const MASTRA_REPO = 'mastra';
console.log('MASTRA_OWNER', MASTRA_OWNER);
// Tool to search through Mastra source code
export const searchMastraCodeTool = createTool({
  id: 'search-mastra-code',
  description: 'Search through the Mastra source code repository. Use this to find relevant code, functions, classes, or implementations. If totalCount is 0, stop using this tool and try other tools like issue search, docs, or examples instead.',
  inputSchema: z.object({
    query: z.string().describe('The search query (e.g., "Agent class", "workflow execute", "memory storage")'),
    path: z.string().optional().describe('Optional path to limit search to a specific directory (e.g., "packages/core")'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      path: z.string(),
      url: z.string(),
      snippet: z.string(),
    })),
    totalCount: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ context: input }) => {
    const octokit = getGithubClient();
    
    try {
      // Build the search query
      let searchQuery = `${input.query} repo:${MASTRA_OWNER}/${MASTRA_REPO}`;
      if (input.path) {
        searchQuery += ` path:${input.path}`;
      }

      const { data } = await octokit.rest.search.code({
        q: searchQuery,
        per_page: input.maxResults || 5,
      });

      console.log('Search results:', data);

      const results = data.items.map(item => ({
        path: item.path,
        url: item.html_url,
        snippet: item.text_matches?.[0]?.fragment || 'No snippet available',
      }));

      return {
        results,
        totalCount: data.total_count,
      };
    } catch (error) {
      console.error('Error searching Mastra code:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        results: [],
        totalCount: 0,
        error: `Search failed: ${errorMessage}. This may indicate API rate limits or repository access issues.`,
      };
    }
  },
});

// Tool to read a specific file from Mastra repository
export const readMastraFileTool = createTool({
  id: 'read-mastra-file',
  description: 'Read the contents of a specific file from the Mastra repository. Use ONLY after code search identifies a relevant file. For large files, you may get truncated content - focus on the key sections shown.',
  inputSchema: z.object({
    path: z.string().describe('The file path in the repository (e.g., "packages/core/src/agent/index.ts")'),
    ref: z.string().optional().default('main').describe('Git ref (branch, tag, or commit) to read from'),
  }),
  outputSchema: z.object({
    content: z.string(),
    path: z.string(),
    url: z.string(),
    size: z.number(),
  }),
  execute: async ({ context: input }) => {
    const octokit = getGithubClient();
    
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: MASTRA_OWNER,
        repo: MASTRA_REPO,
        path: input.path,
        ref: input.ref,
      });

      // GitHub API returns content as base64
      if ('content' in data && data.type === 'file') {
        let content = Buffer.from(data.content, 'base64').toString('utf-8');
        
        // For large files, show beginning (imports/types) and end (exports/main logic)
        const maxChars = 3500;
        
        if (content.length > maxChars) {
          const firstPart = content.substring(0, 2000);
          const lastPart = content.substring(content.length - 1500);
          content = firstPart + '\n\n...[File truncated - showing key sections. Original size: ' + data.size + ' bytes. Middle section omitted.]\n\n' + lastPart;
        }
        
        return {
          content,
          path: data.path,
          url: data.html_url || '',
          size: data.size,
        };
      }

      throw new Error('Path is not a file or content not available');
    } catch (error) {
      throw new Error(`Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

// Tool to search for related GitHub issues
export const searchMastraIssuesTool = createTool({
  id: 'search-mastra-issues',
  description: 'Search for related issues and discussions in the Mastra repository. Use this to find similar problems or existing solutions.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    state: z.enum(['open', 'closed', 'all']).optional().default('all').describe('Issue state to search'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      number: z.number(),
      title: z.string(),
      state: z.string(),
      url: z.string(),
      body: z.string().nullable(),
      labels: z.array(z.string()),
    })),
    totalCount: z.number(),
  }),
  execute: async ({ context: input }) => {
    const octokit = getGithubClient();
    
    try {
      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: `${input.query} repo:${MASTRA_OWNER}/${MASTRA_REPO} is:issue state:${input.state}`,
        per_page: input.maxResults || 5,
        sort: 'updated',
      });

      const results = data.items.map(item => {
        // Truncate long issue bodies to prevent token overflow (keep ~500 chars per issue)
        let body = item.body || null;
        const maxBodyChars = 500;
        
        if (body && body.length > maxBodyChars) {
          body = body.substring(0, maxBodyChars) + '...[truncated]';
        }
        
        return {
          number: item.number,
          title: item.title,
          state: item.state,
          url: item.html_url,
          body,
          labels: item.labels.map(label => typeof label === 'string' ? label : label.name || ''),
        };
      });

      return {
        results,
        totalCount: data.total_count,
      };
    } catch (error) {
      console.error('Error searching Mastra issues:', error);
      return {
        results: [],
        totalCount: 0,
      };
    }
  },
});

// Tool to get package information
export const getMastraPackageInfoTool = createTool({
  id: 'get-mastra-package-info',
  description: 'Get information about a specific Mastra package, including its package.json and main exports.',
  inputSchema: z.object({
    packageName: z.string().describe('Package name (e.g., "@mastra/core", "@mastra/memory")'),
  }),
  outputSchema: z.object({
    packageJson: z.string().nullable(),
    readme: z.string().nullable(),
    version: z.string().nullable(),
  }),
  execute: async ({ context: input }) => {
    const octokit = getGithubClient();
    
    try {
      // Extract package path from name (e.g., "@mastra/core" -> "packages/core")
      const packagePath = input.packageName.replace('@mastra/', 'packages/');
      
      // Fetch package.json
      let packageJson = null;
      let version = null;
      try {
        const { data: pkgData } = await octokit.rest.repos.getContent({
          owner: MASTRA_OWNER,
          repo: MASTRA_REPO,
          path: `${packagePath}/package.json`,
        });
        
        if ('content' in pkgData) {
          packageJson = Buffer.from(pkgData.content, 'base64').toString('utf-8');
          const parsed = JSON.parse(packageJson);
          version = parsed.version;
        }
      } catch (e) {
        // Package.json might not exist
      }

      // Fetch README
      let readme = null;
      try {
        const { data: readmeData } = await octokit.rest.repos.getContent({
          owner: MASTRA_OWNER,
          repo: MASTRA_REPO,
          path: `${packagePath}/README.md`,
        });
        
        if ('content' in readmeData) {
          readme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
        }
      } catch (e) {
        // README might not exist
      }

      return {
        packageJson,
        readme,
        version,
      };
    } catch (error) {
      throw new Error(`Error fetching package info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

