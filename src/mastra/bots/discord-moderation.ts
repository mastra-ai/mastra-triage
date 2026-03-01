import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import type { Message } from 'discord.js';
import { getDiscordClient } from '../shared/discord';

const moderationDecisionSchema = z.object({
  action: z.enum(['allow', 'warn', 'delete', 'escalate']),
  reason: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(1),
  safeReply: z.string().nullable(),
});

const DISCORD_MODERATION_ENABLED = (process.env.DISCORD_MODERATION_ENABLED ?? 'true') === 'true';
const DISCORD_MODERATION_DRY_RUN = (process.env.DISCORD_MODERATION_DRY_RUN ?? 'false') !== 'false';
const DISCORD_MODERATION_CHANNEL_IDS = (
  process.env.DISCORD_MODERATION_CHANNEL_IDS ?? '1309558648476930100'
)
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const DISCORD_MOD_LOG_CHANNEL_ID = process.env.DISCORD_MOD_LOG_CHANNEL_ID ?? '1310115623090520098';

let isStarted = false;

function shouldSkipMessage(message: Message): boolean {
  if (message.author.bot) return true;
  if (!message.inGuild()) return true;
  if (!message.content?.trim()) return true;

  if (DISCORD_MODERATION_CHANNEL_IDS.length > 0 && !DISCORD_MODERATION_CHANNEL_IDS.includes(message.channelId)) {
    return true;
  }

  return false;
}

async function logModerationDecision(
  message: Message,
  decision: z.infer<typeof moderationDecisionSchema>,
  logger?: ReturnType<Mastra['getLogger']>,
): Promise<void> {
  if (!DISCORD_MOD_LOG_CHANNEL_ID) {
    logger?.warn('DISCORD_MOD_LOG_CHANNEL_ID is not set; moderation decisions will not be logged');
    return;
  }

  if (!message.client.isReady()) {
    logger?.warn('Discord client is not ready; skipped moderation log');
    return;
  }

  const logChannel = await message.client.channels.fetch(DISCORD_MOD_LOG_CHANNEL_ID).catch(error => {
    logger?.error('Failed to fetch moderation log channel', error);
    return null;
  });

  if (!logChannel || !('isTextBased' in logChannel) || !logChannel.isTextBased() || !logChannel.isSendable()) {
    logger?.warn('Moderation log channel is unavailable or not sendable');
    return;
  }

  const content = [
    `**Moderation decision** (${DISCORD_MODERATION_DRY_RUN ? 'dry-run' : 'enforced'})`,
    `Action: ${decision.action}`,
    `Severity: ${decision.severity}`,
    `Confidence: ${decision.confidence}`,
    `Reason: ${decision.reason}`,
    `User: <@${message.author.id}>`,
    `Channel: <#${message.channelId}>`,
    `Message: ${message.url}`,
  ].join('\n');

  await logChannel.send(content).catch(error => {
    logger?.error('Failed to send moderation decision to log channel', error);
    return null;
  });
}

async function applyDecision(message: Message, decision: z.infer<typeof moderationDecisionSchema>): Promise<void> {
  if (decision.action === 'allow') {
    return;
  }

  if (DISCORD_MODERATION_DRY_RUN) {
    return;
  }

  if (decision.action === 'warn') {
    await message.author
      .send(decision.safeReply || 'Please keep discussion respectful and follow the server rules.')
      .catch(() => null);
    return;
  }

  if (decision.action === 'delete') {
    await message.delete().catch(() => null);
    await message.author
      .send(decision.safeReply || 'Your message was removed because it violates server rules.')
      .catch(() => null);
    return;
  }

  if (decision.action === 'escalate') {
    return;
  }
}

export async function initializeDiscordModerationBot(mastra: Mastra): Promise<void> {
  if (isStarted || !DISCORD_MODERATION_ENABLED) {
    return;
  }

  const logger = mastra.getLogger();
  const moderationAgent = mastra.getAgentById('moderation-agent');

  if (!moderationAgent) {
    logger?.warn('Discord moderation is enabled but moderationAgent was not found');
    return;
  }

  const discordClient = await getDiscordClient(logger);

  discordClient.on('messageCreate', async message => {
    if (shouldSkipMessage(message)) {
      return;
    }

    const prompt = [
      'Moderate this Discord message according to policy.',
      `Guild: ${message.guild?.name ?? 'unknown'}`,
      `Channel: ${'name' in message.channel ? message.channel.name : message.channelId}`,
      `Author: ${message.author.username}`,
      `Message: ${message.content}`,
    ].join('\n');

    try {
      const result = await moderationAgent.generate(prompt, {
        structuredOutput: {
          schema: moderationDecisionSchema,
        },
      });

      const decision = result.object;
      await applyDecision(message, decision);
      await logModerationDecision(message, decision, logger);
    } catch (error) {
      logger?.error('Failed to moderate Discord message', error);
    }
  });

  isStarted = true;

  logger?.info(
    `Discord moderation listener started (${DISCORD_MODERATION_DRY_RUN ? 'dry-run' : 'enforced'})${
      DISCORD_MODERATION_CHANNEL_IDS.length > 0 ? ` for ${DISCORD_MODERATION_CHANNEL_IDS.length} channels` : ' for all channels'
    }${DISCORD_MOD_LOG_CHANNEL_ID ? `; log channel: ${DISCORD_MOD_LOG_CHANNEL_ID}` : '; log channel not configured'}`,
  );
}
