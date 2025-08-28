import { z } from "zod";
import { getDiscordClient } from "../helpers/client";
import { createStep } from "@mastra/core/workflows";
import { fetchForumPosts } from "../helpers/messages";
import { BOT_TOKEN } from "../constants";

export const fetchPostsOutputSchema = z.object({
    success: z.boolean(),
    posts: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            url: z.string(),
        })
    ),
});

export const fetchPostsStep = createStep({
    id: "fetch-posts",
    inputSchema: z.object({
        forumChannelId: z.string(),
        fetchLimit: z.coerce.number().optional().default(1),
    }),
    outputSchema: fetchPostsOutputSchema,
    execute: async ({ inputData }) => {
        // Initialize Discord client with necessary intents
        const discordClient = await getDiscordClient()

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