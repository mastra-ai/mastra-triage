import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDiscordClient } from '../shared/discord';
import { ForumChannel } from 'discord.js';
import { postSchema } from '../shared/post';

export const inputSchema = z.object({
  forumChannelId: z.string(),
  fetchLimit: z.coerce.number().optional().default(1),
});

export const outputSchema = z.object({
  success: z.boolean(),
  posts: z.array(postSchema),
});

export const fetchForumPosts = createTool({
  id: 'fetch-posts',
  description: 'Fetch forum posts from a Discord channel',
  inputSchema,
  outputSchema,
  execute: async (inputData, { mastra }) => {
    const logger = mastra?.getLogger();
    const discordClient = await getDiscordClient(logger);

    try {
      // Get the forum channel
      const channel = await discordClient.channels.fetch(inputData.forumChannelId);

      if (!channel || !channel.isThreadOnly()) {
        throw new Error('Channel not found or not a forum channel');
      }

      const forumChannel = channel as unknown as ForumChannel;
      const availableTags = await forumChannel.availableTags;
      const availableTagsMap = new Map(availableTags.map(tag => [tag.id, tag.name]));

      // Fetch active threads
      const activeThreads = await forumChannel.threads.fetchActive();

      // Combine active and archived threads
      const allThreads = [...Array.from(activeThreads.threads.values())];

      // Calculate the start date based on fetchLimit (in days)
      const startDate = new Date();
      startDate.setHours(startDate.getHours() - 24 * inputData.fetchLimit);

      // Map to the return type and filter threads from the last 24 hours
      const mappedThreads = allThreads
        .map(thread => ({
          id: thread.id,
          name: thread.name,
          createdAt: thread.createdAt || new Date(),
          messageCount: thread.messageCount || 0,
          archived: thread.archived || false,
          locked: thread.locked || false,
          url: thread.url,
          tags: thread.appliedTags.map(tag => availableTagsMap.get(tag) || tag),
        }))
        .filter(thread => thread.createdAt >= startDate)
        .reverse();

      logger?.info(`Found ${mappedThreads.length} posts`);
      return { success: true, posts: mappedThreads };
    } catch (error) {
      logger?.error('Error fetching forum posts:', error);
      throw error;
    }
  },
});
