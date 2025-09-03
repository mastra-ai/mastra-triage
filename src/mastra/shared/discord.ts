import { IMastraLogger } from '@mastra/core/logger';
import { Client, GatewayIntentBits } from 'discord.js';

let discordClientPromise: Promise<Client> | null = null;

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

async function createDiscordClient(logger?: IMastraLogger) {
  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  if (!BOT_TOKEN) {
    console.warn('DISCORD_BOT_TOKEN is not set in environment variables');
  } else {
    await discordClient.login(BOT_TOKEN).catch(err => {
      logger?.error('Error logging in to Discord', err);
    });
  }

  if (!discordClient.isReady()) {
    await new Promise(resolve => discordClient.once('ready', resolve));
  }

  return discordClient;
}

export async function getDiscordClient(logger?: IMastraLogger) {
  if (!discordClientPromise) {
    discordClientPromise = createDiscordClient(logger);
  }

  return discordClientPromise;
}
