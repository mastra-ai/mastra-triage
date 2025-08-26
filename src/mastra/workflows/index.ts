import { createStep, createWorkflow } from "@mastra/core/workflows";
import { Octokit } from "octokit";
import {
  Client,
  GatewayIntentBits,
  type TextChannel,
  type ForumChannel,
  type ThreadChannel,
  type Message,
} from "discord.js";
import { z } from "zod";

const octokit = new Octokit({
  auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
});

// Login to Discord with your bot token
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

interface FetchForumPostsOptions {
  forumChannelId: string;
  fetchLimit: number;
  limit?: number; // Number of posts to fetch (1-100, default: 50)
  activeOnly?: boolean; // Only fetch active (unarchived) threads
  includeMessages?: boolean; // Whether to include the first message of each thread
  discordClient: Client;
}

interface ForumPost {
  id: string;
  name: string;
  createdAt: Date;
  messageCount: number;
  archived: boolean;
  locked: boolean;
  starterMessage?: Message;
  url: string;
}

async function getFirstThreadMessage({
  client,
  threadId,
}: {
  client: Client;
  threadId: string;
}): Promise<string | null> {
  try {
    if (!BOT_TOKEN) {
      throw new Error("DISCORD_BOT_TOKEN is not set in environment variables");
    }

    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) {
      console.error(`Channel ${threadId} is not a thread or couldn't be found`);
      return null;
    }

    // Fetch the starter message (the message that started the thread)
    const starterMessage = await thread.fetchStarterMessage();
    if (!starterMessage) {
      console.log("No starter message found for thread:", threadId);
      return null;
    }
    return starterMessage.content || null;
  } catch (error) {
    console.error("Error fetching thread message:", error);
    return null;
  }
}

/**
 * Fetches forum posts from a Discord forum channel
 * @param options Configuration for fetching forum posts
 * @returns Promise with an array of forum posts
 */
export async function fetchForumPosts({
  forumChannelId,
  fetchLimit,
  discordClient,
}: FetchForumPostsOptions): Promise<ForumPost[]> {
  if (!BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not set in environment variables");
  }

  try {
    // Wait for the client to be ready
    if (!discordClient.isReady()) {
      await new Promise((resolve) => discordClient.once("ready", resolve));
    }

    // Get the forum channel
    const channel = await discordClient.channels.fetch(forumChannelId);

    if (!channel || !channel.isThreadOnly()) {
      throw new Error("Channel not found or not a forum channel");
    }

    const forumChannel = channel as unknown as ForumChannel;

    // Fetch active threads
    const activeThreads = await forumChannel.threads.fetchActive();

    // Combine active and archived threads
    const allThreads = [...Array.from(activeThreads.threads.values())];

    // Calculate the timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(
      twentyFourHoursAgo.getHours() - 24 * 8 * fetchLimit
    );

    // Map to the return type and filter threads from the last 24 hours
    return allThreads
      .map((thread) => ({
        id: thread.id,
        name: thread.name,
        createdAt: thread.createdAt || new Date(),
        messageCount: thread.messageCount || 0,
        archived: thread.archived || false,
        locked: thread.locked || false,
        url: thread.url,
      }))
      .filter((thread) => thread.createdAt >= twentyFourHoursAgo)
      .reverse();
  } catch (error) {
    console.error("Error fetching forum posts:", error);
    throw error;
  }
}

let discordClient: Client;

const fetchPostsStep = createStep({
  id: "fetch-posts",
  inputSchema: z.object({
    forumChannelId: z.string(),
    fetchLimit: z.coerce.number().optional().default(1),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    posts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
      })
    ),
  }),
  execute: async ({ inputData }) => {
    // Initialize Discord client with necessary intents
    discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    if (!BOT_TOKEN) {
      console.warn("DISCORD_BOT_TOKEN is not set in environment variables");
    } else {
      discordClient.login(BOT_TOKEN).catch(console.error);
    }

    const posts = await fetchForumPosts({
      ...inputData,
      discordClient,
    });
    console.log(`Found ${posts.length} posts`);
    return { success: true, posts };
  },
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
