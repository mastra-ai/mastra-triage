import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { triageAgent } from './agents/triage';
import { firstPassAnalysisAgent } from './agents/firstPassAnalysis';
import { sarcasticAgent } from './agents/sarcastic';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
import { createGithubIssueWorkflow } from './workflows/discordToGithub/createGithubIssue';
import { discordAnalysisWorkflow } from './workflows/analysis';
import { MastraJwtAuth } from '@mastra/auth';
import { triageWorkflow } from './workflows/triage';

export const mastra = new Mastra({
  agents: { 
    triageAgent,
    firstPassAnalysisAgent,
    sarcasticAgent,
  },

  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  bundler: {
    externals: ['discord.js'],
  },
  workflows: {
    discordToGithubWorkflow,
    createGithubIssueWorkflow,
    discordAnalysisWorkflow,
    triageWorkflow,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  }),
  observability: {
   default: {enabled: true}
  },
  server: {
    // experimental_auth: new MastraJwtAuth({
    //   secret: process.env.MASTRA_JWT_SECRET,
    // }),
  },
});
