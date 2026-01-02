import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { classificationAgent, effortImpactAgent } from './agents/classification';
import { analysisAgent } from './agents/analysis';
import { threadClassifierAgent } from './agents/thread-classifier';
import { categorySummaryAgent } from './agents/category-summary';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
import { triageWorkflow } from './workflows/triage';
import { githubIssueManagerWorkflow } from './workflows/githubIssueManager';
import { discordSyncWorkflow } from './workflows/discordSync';
import { classificationWorkflow } from './workflows/classification';
import { discordAnalysisWorkflow } from './workflows/analysis';
import { forumThreadAnalysisWorkflow } from './workflows/forum-thread-analysis';
import { MastraJwtAuth } from '@mastra/auth';

export const mastra = new Mastra({
  agents: { classificationAgent, effortImpactAgent, analysisAgent, threadClassifierAgent, categorySummaryAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  bundler: {
    externals: ['discord.js', '@mastra/auth'],
  },
  workflows: {
    classificationWorkflow,
    discordToGithubWorkflow,
    triageWorkflow,
    githubIssueManagerWorkflow,
    discordSyncWorkflow,
    // Manual trigger workflows for reporting (used by Romain and Abhi)
    discordAnalysisWorkflow,
    forumThreadAnalysisWorkflow,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.MASTRA_DEV === 'true' ? 'debug' : 'info',
  }),
  observability: {
    default: {
      enabled: true,
    }
  },
  server: {
    experimental_auth:
      process.env.MASTRA_DEV === 'true'
        ? undefined
        : new MastraJwtAuth({
            secret: process.env.MASTRA_JWT_SECRET,
          }),
  },
});
