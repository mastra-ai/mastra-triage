import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  TextChannel,
  Message,
  ChannelType,
  ForumChannel,
  GuildMember,
  ThreadChannel,
} from 'discord.js';

// When fetching messages with options, it returns a Collection

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

// Create a Discord client instance
let client: Client | null = null;

// Function to initialize the Discord client
async function getDiscordClient(): Promise<Client> {
  if (client && client.isReady()) {
    console.log('Using existing Discord client');
    return client;
  }

  console.log('Creating new Discord client');
  // Create a new client if one doesn't exist or isn't ready
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message],
  });

  // Log in to Discord
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set in environment variables');
  }

  console.log('Logging in to Discord...');
  return new Promise((resolve, reject) => {
    client!.once('ready', () => {
      console.log(`Logged in as ${client!.user?.tag}`);
      resolve(client!);
    });

    client!.once('error', error => {
      console.error('Discord client error:', error);
      reject(error);
    });

    client!.login(token).catch(error => {
      console.error('Discord login error:', error);
      reject(error);
    });
  });
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
async function fetchMessages(
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

// Tool for scraping Discord messages
export const discordScraperTool = createTool({
  id: 'discord-scraper-tool',
  description: 'Scrapes messages from a Discord help forum',
  inputSchema: z.object({
    channelId: z.string().describe('Discord channel ID to scrape'),
    startDate: z.string().optional().describe('Start date for message retrieval (ISO format)'),
    endDate: z.string().optional().describe('End date for message retrieval (ISO format)'),
    timeRange: z.string().optional().describe('Relative time range like "past 24 hours", "past week", "past month"'),
  }),
  execute: async ({ context }) => {
    console.log('Scraping Discord messages...');

    let { channelId, startDate, endDate, timeRange } = context;

    // Handle relative time ranges
    if (timeRange && (!startDate || !endDate)) {
      const now = new Date();
      const endDateObj = new Date(now);
      let startDateObj = new Date(now);

      // Parse common time ranges
      if (timeRange.includes('hour')) {
        const hours = parseInt(timeRange.match(/\d+/)?.[0] || '24');
        startDateObj.setHours(startDateObj.getHours() - hours);
      } else if (timeRange.includes('day') || timeRange.includes('24 hour')) {
        const days = parseInt(timeRange.match(/\d+/)?.[0] || '1');
        startDateObj.setDate(startDateObj.getDate() - days);
      } else if (timeRange.includes('week')) {
        const weeks = parseInt(timeRange.match(/\d+/)?.[0] || '1');
        startDateObj.setDate(startDateObj.getDate() - weeks * 7);
      } else if (timeRange.includes('month')) {
        const months = parseInt(timeRange.match(/\d+/)?.[0] || '1');
        startDateObj.setMonth(startDateObj.getMonth() - months);
      }

      // Format dates as ISO strings
      startDate = startDateObj.toISOString();
      endDate = endDateObj.toISOString();

      console.log(`Calculated date range from "${timeRange}": ${startDate} to ${endDate}`);
    }

    console.log('Date range: ', startDate, endDate);

    if (!process.env.DISCORD_BOT_TOKEN) {
      throw new Error('DISCORD_BOT_TOKEN is not set in environment variables');
    }

    // Get the Discord client
    const discordClient = await getDiscordClient();

    // Use Discord API to fetch messages
    const channelMessages = await fetchMessages(discordClient, channelId, startDate, endDate);

    // Combine and sort all messages by timestamp
    const allMessages = channelMessages
      .flat()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return allMessages;
  },
});
