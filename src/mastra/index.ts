import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { triageAgent } from './agents/triage';
import { firstPassAnalysisAgent } from './agents/firstPassAnalysis';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
import { createGithubIssueWorkflow } from './workflows/discordToGithub/createGithubIssue';
import { discordAnalysisWorkflow } from './workflows/analysis';
import { firstPassAnalysisWorkflow } from './workflows/firstPassAnalysis';
import { MastraJwtAuth } from '@mastra/auth';
import { triageWorkflow } from './workflows/triage';

export const mastra = new Mastra({
  agents: { 
    triageAgent,
    firstPassAnalysisAgent,
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
    firstPassAnalysisWorkflow,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  }),
  server: {
    // experimental_auth: new MastraJwtAuth({
    //   secret: process.env.MASTRA_JWT_SECRET,
    // }),
  },
});
