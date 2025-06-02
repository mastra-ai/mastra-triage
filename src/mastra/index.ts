
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { triageAgent } from './agents/triage';
import { registerApiRoute } from '@mastra/core/server';

export const mastra = new Mastra({
  agents: { triageAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    apiRoutes: [
      registerApiRoute('/discord-triage', {
        method: 'POST',
        handler: async (c) => {
          const body = await c.req.json();
          console.log(body, '###')
          return c.json({});
        },
      }),
    ]
  },
});
