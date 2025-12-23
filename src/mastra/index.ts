import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { classificationAgent, effortImpactAgent } from './agents/classification';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
import { triageWorkflow } from './workflows/triage';
import { githubIssueManagerWorkflow } from './workflows/githubIssueManager';
import { discordSyncWorkflow } from './workflows/discordSync';
import { classificationWorkflow } from './workflows/classification';
import { MastraJwtAuth } from '@mastra/auth';

export const mastra = new Mastra({
  agents: { classificationAgent, effortImpactAgent },
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
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.MASTRA_DEV === 'true' ? 'debug' : 'info',
  }),
  server: {
    experimental_auth:
      process.env.MASTRA_DEV === 'true'
        ? undefined
        : new MastraJwtAuth({
            secret: process.env.MASTRA_JWT_SECRET,
          }),
  },
});
