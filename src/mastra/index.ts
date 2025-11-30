import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { triageAgent } from './agents/triage';
import { analysisAgent } from './agents/analysis';
import { threadClassifierAgent } from './agents/thread-classifier';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
import { createGithubIssueWorkflow } from './workflows/discordToGithub/createGithubIssue';
import { discordAnalysisWorkflow } from './workflows/analysis';
import { triageWorkflow } from './workflows/triage';
import { githubIssueManagerWorkflow } from './workflows/githubIssueManager';
import { forumThreadAnalysisWorkflow } from './workflows/forum-thread-analysis';
import { MastraJwtAuth } from '@mastra/auth';
import { discordSyncWorkflow } from './workflows/discordSync';

export const mastra = new Mastra({
  agents: { triageAgent, analysisAgent, threadClassifierAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  bundler: {
    externals: ['discord.js', "@mastra/auth"],
  },
  workflows: {
    discordToGithubWorkflow,
    createGithubIssueWorkflow,
    discordAnalysisWorkflow,
    triageWorkflow,
    githubIssueManagerWorkflow,
    forumThreadAnalysisWorkflow,
    discordSyncWorkflow,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  }),
  server: {
    experimental_auth: new MastraJwtAuth({
      secret: process.env.MASTRA_JWT_SECRET,
    }),
  },
});
