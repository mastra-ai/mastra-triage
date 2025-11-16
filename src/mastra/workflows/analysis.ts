import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { analysisAgent } from "../agents/analysis";
import {
  fetchPostsOutputSchema as fetchThreadsOutputSchema,
  fetchPostsStep as fetchThreadsStep,
} from "./";
import { getDiscordClient } from "../helpers/client";
import { getFirstThreadMessage } from "../helpers/messages";
import { promises as fs } from "fs";
import { join } from "path";

/*
Discord Channel IDs
HELP_CHANNEL="1349006916902191125"
MASTRA_CHANNEL="1310121281177387109"
*/

const analyzeMessages = createStep({
  id: "analyzeMessages",
  inputSchema: fetchThreadsOutputSchema,
  outputSchema: z.object({
    summaryData: z.array(
      z.object({
        category: z.string(),
        summary: z.string(),
        severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
      })
    ),
    summaryTable: z.string(),
  }),
  execute: async ({ inputData }) => {
    const discordClient = await getDiscordClient();

    const postsForAgent = [];
    const postsForAgent = [];

    const postCache: Record<string, string> = {};
    const postCache: Record<string, string> = {};

    console.log("Fetching threads details...");

    for (const thread of inputData.posts) {
      const message = await getFirstThreadMessage({
        client: discordClient,
        threadId: thread.id,
      });

      if (message) {
        postsForAgent.push({
          id: thread.id,
          message,
          name: thread.name,
        });

        postCache[thread.id] = message;
      }
    }

    console.log(`Categorizing ${postsForAgent.length} threads...`);

    const result = await analysisAgent.generate(
      `
            Here is a list of messages you need to categrorize:
            ${postsForAgent
              .map(
                (p) => `
                ID:${p.id} THREAD_NAME:${p.name} MESSAGE:${p.message}
            `
              )
              .join("\n")}

            For each message, return the category that the message belongs to.

            Shape:
            {
                "posts": [
                    {
                        "id": "string",
                        "category": "string"
                    }
                ]
            }
        `,
      {
        structuredOutput: {
          schema: z.object({
            posts: z.array(
              z.object({
                id: z.string(),
                category: z.string(),
              })
            ),
          }),
        },
      }
    );

    console.log(`Grouping threads by category...`);

    const groupedPosts = result.object.posts.reduce(
      (acc, post) => {
        const category = post.category;
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(post);
        return acc;
      },
      {} as Record<string, Array<{ id: string; category: string }>>
    );

    let filePath = join(process.cwd(), "../../", "posts-dump.json");
    await fs.writeFile(
      filePath,
      JSON.stringify(postsForAgent, null, 2),
      "utf-8"
    );

    filePath = join(process.cwd(), "../../", "categorized-posts-dump.json");
    await fs.writeFile(
      filePath,
      JSON.stringify(groupedPosts, null, 2),
      "utf-8"
    );

    const summary = [];
    const summary = [];

    for (const category in groupedPosts) {
      console.log(`Analyzing category: ${category}`);

      const messages = groupedPosts[category]
        .map((post) => postCache[post.id])
        .join("\n");

      const result = await analysisAgent.generate(
        `
      const result = await analysisAgent.generate(
        `
                Analyze the following messages:
                ${messages}
               
                Summarize the messages in a way that explains what the general issue of the category is.

                Based on the summary, rate the severity (based on your judgement) of the issues described from MINOR | MAJOR | CRITICAL.
                Example issues that are CRITICAL are: data loss, security issues, crashes, broken features.
                Example issues that are MAJOR are: performance issues, usability issues, missing features.
                Example issues that are MINOR are: visual issues, typos, minor annoyances, documentation.
                
                Shape:
                {
                    "summary": "string",
                    "severity": "MINOR | MAJOR | CRITICAL"
                }
            `,
        {
          structuredOutput: {
            schema: z.object({
              summary: z.string(),
              severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
            }),
          },
        }
      );

      summary.push({
        category,
        summary: result.object?.summary,
        severity: result.object?.severity,
      });
    }

    const markdownTable = `
    const markdownTable = `
| Category | Count | Severity | Summary |
|----------|-------|----------|---------|
${summary
  .map((item) => {
    const count = groupedPosts[item.category]?.length || 0;
    const severityEmoji =
      item.severity === "MINOR"
        ? "🟢"
        : item.severity === "MAJOR"
          ? "🟡"
          : "🔴";

    return `| ${item.category} | ${count} | ${severityEmoji} | ${item.summary} |`;
  })
  .join("\n")}
        `.trim();

    return {
      summaryData: summary,
      summaryTable: markdownTable,
    };
  },
});

const saveMarkDownToFile = createStep({
  id: "saveMarkDownToFile",
  inputSchema: z.object({
    summaryData: z.array(
      z.object({
        category: z.string(),
        summary: z.string(),
        severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
      })
    ),
    summaryTable: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    console.log("Saving markdown summary to file...");

    const filePath = join(process.cwd(), "../../", "category-summary.md");
    await fs.writeFile(filePath, inputData.summaryTable, "utf-8");
    console.log(`Markdown summary saved to ${filePath}`);

    return { success: true };
  },
});

// Create the workflow
export const discordAnalysisWorkflow = createWorkflow({
  id: "discord-analysis",
  inputSchema: z.object({
    forumChannelId: z
      .string()
      .describe("The ID of the Discord forum channel to fetch threads from"),
    fetchLimit: z.coerce
      .number()
      .optional()
      .default(1)
      .describe("Number of days to fetch threads from"),
  }),
  outputSchema: z.object({
    summaryData: z.array(
      z.object({
        category: z.string(),
        summary: z.string(),
        severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
      })
    ),
    summaryTable: z.string(),
  }),
})
  .then(fetchThreadsStep)
  .then(analyzeMessages)
  .then(saveMarkDownToFile)
  .commit();
