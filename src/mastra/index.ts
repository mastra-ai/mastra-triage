import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { classificationAgent, effortImpactAgent } from './agents/classification';
import { analysisAgent } from './agents/analysis';
import { threadClassifierAgent } from './agents/thread-classifier';
import { categorySummaryAgent } from './agents/category-summary';
import { moderationAgent } from './agents/moderation';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
import { triageWorkflow } from './workflows/triage';
import { githubIssueManagerWorkflow } from './workflows/githubIssueManager';
import { discordSyncWorkflow } from './workflows/discordSync';
import { classificationWorkflow } from './workflows/classification';
import { discordAnalysisWorkflow } from './workflows/analysis';
import { forumThreadAnalysisWorkflow } from './workflows/forum-thread-analysis';
import { MastraJwtAuth } from '@mastra/auth';
import { MastraPlatformExporter, MastraStorageExporter, Observability } from '@mastra/observability';
import { initializeDiscordModerationBot } from './bots/discord-moderation';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';

export const mastra = new Mastra({
  agents: {
    classificationAgent,
    effortImpactAgent,
    analysisAgent,
    threadClassifierAgent,
    categorySummaryAgent,
    moderationAgent,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  bundler: {
    externals: true,
  },
  workflows: {
    // Keys must match each workflow's `id`. Nested runs (foreach/branch) resolve
    // the parent with getWorkflow(workflow.id), not the variable name.
    [classificationWorkflow.id]: classificationWorkflow,
    [discordToGithubWorkflow.id]: discordToGithubWorkflow,
    [triageWorkflow.id]: triageWorkflow,
    [githubIssueManagerWorkflow.id]: githubIssueManagerWorkflow,
    [discordSyncWorkflow.id]: discordSyncWorkflow,
    // Manual trigger workflows for reporting (used by Romain and Abhi)
    [discordAnalysisWorkflow.id]: discordAnalysisWorkflow,
    [forumThreadAnalysisWorkflow.id]: forumThreadAnalysisWorkflow,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.MASTRA_DEV === 'true' ? 'debug' : 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists traces to storage for Mastra Studio
          new MastraPlatformExporter()
        ],
      },
    },
  }),
  server: {
    auth:
      process.env.MASTRA_DEV === 'true'
        ? undefined
        : new MastraJwtAuth({
            secret: process.env.MASTRA_JWT_SECRET,
          }),
  },
});

void initializeDiscordModerationBot(mastra);
