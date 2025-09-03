import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { triageAgent } from './agents/triage';
import { discordToGithubWorkflow } from './workflows/discordToGithub';
// import { createGithubIssueWorkflow } from './workflows/discordToGithub/createGithubIssue';

export const mastra = new Mastra({
  agents: { triageAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  workflows: {
    discordToGithubWorkflow,
    // createGithubIssueWorkflow,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
