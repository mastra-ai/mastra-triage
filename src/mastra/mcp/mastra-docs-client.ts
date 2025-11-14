import { MCPClient } from '@mastra/mcp';

export const mastraDocsClient = new MCPClient({
  id: 'mastra-docs-client',
  servers: {
    mastra: {
      command: 'npx',
      args: ['-y', '@mastra/mcp-docs-server'],
    },
  },
});

