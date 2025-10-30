import {
  Client,
  Collection,
  TextChannel,
  Message,
  ChannelType,
  ForumChannel,
  GuildMember,
  ThreadChannel,
} from 'discord.js';
import { BOT_TOKEN } from '../constants';

// Helper function to fetch all messages with pagination
async function fetchMessagesWithPagination(
  messageManager: TextChannel['messages'] | ThreadChannel['messages'],
  startDate?: string,
  endDate?: string,
  label: string = 'messages',
): Promise<Collection<string, Message>> {
  const messages = new Collection<string, Message>();
  let lastMessage: Message | undefined;
  let batchCount = 0;

  while (true) {
    const options = {
      limit: 100,
      before: lastMessage?.id,
    };

    const batch = (await messageManager.fetch(options)) as unknown as Collection<string, Message>;
    batchCount++;
    // If we got no messages, we're done
    if (!batch || batch.size === 0) break;

    // Process each message
    batch.forEach(msg => {
      const timestamp = msg.createdAt.getTime();
      const isInRange =
        (!startDate || timestamp >= new Date(startDate).getTime()) &&
        (!endDate || timestamp <= new Date(endDate).getTime());
      if (isInRange) {
        messages.set(msg.id, msg);
      }
    });

    // Get the last message for pagination
    lastMessage = batch.last() || undefined;
    if (!lastMessage) break;

    // Check if we need to fetch more
    if (batch.size < 100 || (startDate && lastMessage.createdAt.getTime() < new Date(startDate).getTime())) {
      break;
    }
  }

  if (messages.size > 0) {
    console.log(`Found ${messages.size} messages in ${label}`);
  }
  return messages;
}

// Function to check if a member has Core Team or Admin role
function isTeamMember(member: GuildMember | null): boolean {
  if (!member) return false;
  // Check if the member has either Core Team or Admin role
  const hasTeamRole = member.roles.cache.some(role => role.name === 'Core Team');
  const hasAdminRole = member.roles.cache.some(role => role.name === 'Admin');
  //   const roles = Array.from(member.roles.cache.values()).map(r => r.name);
  //   console.log(
  //     `User ${member.user.username} (${member.user.id}) roles: ${roles.join(', ')}. ` +
  //     `Is team member: ${hasTeamRole || hasAdminRole} (Core Team: ${hasTeamRole}, Admin: ${hasAdminRole})`,
  //   );
  return hasTeamRole || hasAdminRole;
}

// Function to fetch messages from a Discord channel
export async function fetchMessages(
  discordClient: Client,
  channelId: string,
  startDate?: string,
  endDate?: string,
): Promise<any[]> {
  try {
    console.log(`Fetching messages from channel ${channelId}`);

    // Get the channel
    const channel = (await discordClient.channels.fetch(channelId)) as TextChannel | ForumChannel;
    if (!channel) {
      throw new Error(`Channel with ID ${channelId} not found`);
    }

    let messages: Collection<string, Message>;

    // Handle forum channels differently
    if (channel.type === ChannelType.GuildForum) {
      const threads = await (channel as ForumChannel).threads.fetch();

      // Fetch all messages from each active thread
      const threadMessages = await Promise.all(
        threads.threads.map(async thread => {
          return fetchMessagesWithPagination(thread.messages, startDate, endDate, `messages in thread ${thread.name}`);
        }),
      );

      // Combine all messages
      messages = threadMessages.reduce((acc, msgs) => {
        msgs.forEach(msg => acc.set(msg.id, msg));
        return acc;
      }, new Collection<string, Message>());
    } else {
      // Regular channel - fetch all messages in range
      messages = await fetchMessagesWithPagination(channel.messages, startDate, endDate, 'messages in channel');
    }
    // Log total message count at the end
    if (messages.size > 0) {
      console.log(`Total messages found: ${messages.size}`);
    }

    // Convert to our format and filter out team members
    const formattedMessages = await Promise.all(
      messages.map(async msg => {
        // For forum messages, we need to fetch member directly since msg.member is null
        let isTeam = false;
        if (channel.guild) {
          try {
            const member = await channel.guild.members.fetch(msg.author.id);
            isTeam = isTeamMember(member);
          } catch {
            console.log(
              `Could not fetch member info for user ${msg.author.username} (${msg.author.id}). This can happen if the user left the server or the bot lacks permissions.`,
            );
            // If we can't fetch the member, assume they're not team to avoid excluding potentially relevant messages
            isTeam = false;
          }
        }

        // Skip messages from team members
        if (isTeam) {
          return null;
        }

        return {
          id: msg.id,
          content: msg.content,
          author: msg.author.username,
          timestamp: msg.createdAt.toISOString(),
          channelId: msg.channelId,
        };
      }),
    );

    // Filter out null values and apply date filters
    let filteredMessages = formattedMessages.filter(msg => msg !== null) as any[];

    console.log({
      startDate,
      endDate,
      filteredMessagesCount: filteredMessages.length,
    });

    return filteredMessages;
  } catch (error) {
    console.error('Error fetching Discord messages:', error);
    throw error;
  }
}

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

export async function getFirstThreadMessage({
  client,
  threadId,
}: {
  client: Client;
  threadId: string;
}): Promise<string | null> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('DISCORD_BOT_TOKEN is not set in environment variables');
    }

    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) {
      console.error(`Channel ${threadId} is not a thread or couldn't be found`);
      return null;
    }

    // Fetch the starter message (the message that started the thread)
    const starterMessage = await thread.fetchStarterMessage();
    if (!starterMessage) {
      console.log('No starter message found for thread:', threadId);
      return null;
    }
    return starterMessage.content || null;
  } catch (error) {
    console.error('Error fetching thread message:', error);
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
    throw new Error('DISCORD_BOT_TOKEN is not set in environment variables');
  }

  try {
    // Wait for the client to be ready
    if (!discordClient.isReady()) {
      await new Promise(resolve => discordClient.once('ready', resolve));
    }

    // Get the forum channel
    const channel = await discordClient.channels.fetch(forumChannelId);

    if (!channel || !channel.isThreadOnly()) {
      throw new Error('Channel not found or not a forum channel');
    }

    const forumChannel = channel as unknown as ForumChannel;

    // Fetch active threads
    const activeThreads = await forumChannel.threads.fetchActive();

    // Combine active and archived threads
    const allThreads = [...Array.from(activeThreads.threads.values())];

    // Calculate the timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24 * 8 * fetchLimit);

    // Map to the return type and filter threads from the last 24 hours
    return allThreads
      .map(thread => ({
        id: thread.id,
        name: thread.name,
        createdAt: thread.createdAt || new Date(),
        messageCount: thread.messageCount || 0,
        archived: thread.archived || false,
        locked: thread.locked || false,
        url: thread.url,
      }))
      .filter(thread => thread.createdAt >= twentyFourHoursAgo)
      .reverse();
  } catch (error) {
    console.error('Error fetching forum posts:', error);
    throw error;
  }
}
