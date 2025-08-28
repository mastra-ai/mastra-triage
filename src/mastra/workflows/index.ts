import { createStep, createWorkflow } from "@mastra/core/workflows";
import { Octokit } from "octokit";
import { z } from "zod";
import { fetchPostsStep } from "./shared";
import { getDiscordClient } from "../helpers/client";
import { getFirstThreadMessage } from "../helpers/messages";

const octokit = new Octokit({
  auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
});

const processPostsStep = createStep({
  id: "process-posts",
  inputSchema: z.object({
    success: z.boolean(),
    posts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
      })
    ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const discordClient = await getDiscordClient();
    const owner = "mastra-ai";
    const repo = "mastra";

    console.log(`Processing ${inputData.posts.length} posts`);
    for (const post of inputData.posts.slice(20)) {
      console.log(`Processing post ${post.name}`);
      console.log(post.url);

      const title = `[DISCORD:${post.id}] ${post.name}`;

      // Search for existing issues with the post ID in the title
      const { data: searchResults } = await octokit.request(
        "GET /search/issues",
        {
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
          advanced_search: "true",
          q: `is:issue is:open in:title "[DISCORD:${post.id}]" repo:${owner}/${repo}`,
          per_page: 1,
          sort: "updated",
          order: "desc",
        }
      );

      if (searchResults.items && searchResults.items.length > 0) {
        console.log(`Found existing issue: ${searchResults.items[0].html_url}`);
      } else {
        console.log("No existing issue found, creating a new one");

        const message = await getFirstThreadMessage({
          client: discordClient,
          threadId: post.id,
        });

        console.log(message);

        // Create a new issue
        const newIssue = await octokit.rest.issues.create({
          owner,
          repo,
          title,
          body: `This issue was created from Discord post: ${post.url}\n\n${message}`,
          labels: ["status: needs triage"],
        });

        console.log(`Created new issue: ${newIssue.data.html_url}`);

        // Send a message back to the Discord thread
        try {
          const thread = await discordClient.channels.fetch(post.id);
          if (thread?.isThread()) {
            await thread.send(
              `📝 Created GitHub issue: ${newIssue.data.html_url}`
            );
          }
        } catch (error) {
          console.error("Failed to send message to Discord thread:", error);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { success: true };
  },
});

export const discordToGithubWorkflow = createWorkflow({
  id: "discord-to-github",
  inputSchema: z.object({
    forumChannelId: z.string(),
    fetchLimit: z.coerce.number().optional().default(1),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
});

discordToGithubWorkflow.then(fetchPostsStep).then(processPostsStep).commit();
