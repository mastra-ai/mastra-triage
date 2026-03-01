import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type Message } from 'discord.js';
import { getDiscordClient } from '../shared/discord';

const moderationDecisionSchema = z.object({
  action: z.enum(['allow', 'warn', 'redirect', 'delete', 'escalate']),
  reason: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(1),
  safeReply: z.string(),
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

const MOD_ACTION_WARN = 'mod_warn';
const MOD_ACTION_DELETE = 'mod_delete';

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

function quoteMessageContent(content: string, maxLength = 1500): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const clipped = normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
  return `>>> ${clipped || '[no text content]'}`;
}

function getActionColor(action: z.infer<typeof moderationDecisionSchema>['action']): number {
  switch (action) {
    case 'allow':
      return 0x2ecc71;
    case 'warn':
      return 0xf1c40f;
    case 'redirect':
      return 0x3498db;
    case 'delete':
      return 0xe74c3c;
    case 'escalate':
      return 0x9b59b6;
    default:
      return 0x95a5a6;
  }
}

function buildUserDm(baseMessage: string, originalMessage: string): string {
  return `${baseMessage}\n\nYour message:\n${quoteMessageContent(originalMessage)}`;
}

function buildModeratorComponents(
  guildId: string,
  channelId: string,
  messageId: string,
  messageUrl: string,
  decisionAction: z.infer<typeof moderationDecisionSchema>['action'],
  disabled = false,
): ActionRowBuilder<ButtonBuilder>[] {
  const actionButtons: ButtonBuilder[] = [];

  if (decisionAction !== 'delete') {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(`${MOD_ACTION_WARN}:${channelId}:${messageId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Reply in Thread')
        .setDisabled(disabled),
    );
  }

  if (decisionAction !== 'delete') {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(`${MOD_ACTION_DELETE}:${channelId}:${messageId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Delete + DM')
        .setDisabled(disabled),
    );
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (actionButtons.length > 0) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons));
  }

  const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open Message')
      .setURL(messageUrl || `https://discord.com/channels/${guildId}/${channelId}/${messageId}`),
  );

  rows.push(linkRow);
  return rows;
}

async function applyWarnInThread(
  message: Message,
  safeReply: string,
  action: 'warn' | 'redirect',
  logger?: ReturnType<Mastra['getLogger']>,
): Promise<boolean> {
  const warningMessage = buildUserDm(safeReply, message.content);
  const threadPrefix = action === 'redirect' ? 'help-guidance' : 'warning';

  if (message.channel.isThread() && message.channel.isSendable()) {
    await message.channel.send(`<@${message.author.id}>\n${warningMessage}`).catch(error => {
      logger?.error('Failed to send warning in thread', error);
      return null;
    });
    return true;
  }

  await message
    .startThread({
      name: `${threadPrefix}-${message.author.username}`.slice(0, 100),
    })
    .then(thread => thread.send(`<@${message.author.id}>\n${warningMessage}`))
    .catch(error => {
      logger?.error('Failed to create warning thread', error);
      return null;
    });

  return true;
}

async function logModerationDecision(
  message: Message,
  decision: z.infer<typeof moderationDecisionSchema>,
  logger?: ReturnType<Mastra['getLogger']>,
): Promise<void> {
  if (decision.action === 'allow' || decision.action === 'redirect') {
    return;
  }

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

  const content = quoteMessageContent(message.content, 1000);
  const embed = new EmbedBuilder()
    .setTitle('Moderation decision')
    .setColor(getActionColor(decision.action))
    .setDescription(content)
    .addFields(
      { name: 'Mode', value: DISCORD_MODERATION_DRY_RUN ? 'dry-run' : 'enforced', inline: true },
      { name: 'Action', value: decision.action, inline: true },
      { name: 'Severity', value: decision.severity, inline: true },
      { name: 'Confidence', value: String(decision.confidence), inline: true },
      { name: 'User', value: `<@${message.author.id}>`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Reason', value: decision.reason.slice(0, 1024) },
      {
        name: 'Recommended moderator action',
        value:
          decision.action === 'escalate'
            ? 'Review and decide manually (no user-facing action was taken automatically).'
            : `Already applied automatically: ${decision.action}`,
      },
    )
    .setFooter({ text: `Message ID: ${message.id}` })
    .setTimestamp(new Date(message.createdTimestamp));

  const components = buildModeratorComponents(
    message.guild?.id ?? '0',
    message.channelId,
    message.id,
    message.url,
    decision.action,
  );

  await logChannel.send({ embeds: [embed], components }).catch(error => {
    logger?.error('Failed to send moderation decision to log channel', error);
    return null;
  });
}

async function applyDecision(
  message: Message,
  decision: z.infer<typeof moderationDecisionSchema>,
  logger?: ReturnType<Mastra['getLogger']>,
): Promise<void> {
  if (decision.action === 'allow') {
    return;
  }

  if (DISCORD_MODERATION_DRY_RUN) {
    return;
  }

  if (decision.action === 'warn' || decision.action === 'redirect') {
    const warnMessage =
      decision.safeReply ||
      (decision.action === 'redirect'
        ? "You'll likely get faster help in <#1452669948718616760>. If AI can't solve it, create a thread in <#1349006916902191125>."
        : 'Please keep discussion respectful and follow the server rules.');
    await applyWarnInThread(message, warnMessage, decision.action, logger);
    return;
  }

  if (decision.action === 'delete') {
    await message.delete().catch(() => null);

    const deleteMessage = buildUserDm(
      decision.safeReply || 'Your message was removed because it violates server rules.',
      message.content,
    );

    await message.author.send(deleteMessage).catch(() => null);
    return;
  }

  if (decision.action === 'escalate') {
    return;
  }
}

function parseModAction(customId: string): { action: string; channelId: string; messageId: string } | null {
  const [action, channelId, messageId] = customId.split(':');
  if (!action || !channelId || !messageId) return null;
  if (![MOD_ACTION_WARN, MOD_ACTION_DELETE].includes(action)) return null;
  return { action, channelId, messageId };
}

function getDecisionActionFromLogMessage(
  interaction: ButtonInteraction,
): z.infer<typeof moderationDecisionSchema>['action'] {
  const value = interaction.message.embeds[0]?.fields.find(field => field.name === 'Action')?.value;
  if (value === 'allow' || value === 'warn' || value === 'redirect' || value === 'delete' || value === 'escalate') {
    return value;
  }
  return 'warn';
}

async function handleModeratorAction(interaction: ButtonInteraction, logger?: ReturnType<Mastra['getLogger']>): Promise<void> {
  if (!interaction.guildId || interaction.channelId !== DISCORD_MOD_LOG_CHANNEL_ID) {
    return;
  }

  const parsed = parseModAction(interaction.customId);
  if (!parsed) return;

  const { action, channelId, messageId } = parsed;

  await interaction.deferReply({ ephemeral: true });

  const sourceChannel = await interaction.client.channels.fetch(channelId).catch(error => {
    logger?.error('Failed to fetch source channel for moderator action', error);
    return null;
  });

  if (!sourceChannel || !sourceChannel.isTextBased() || !('messages' in sourceChannel)) {
    await interaction.editReply('Could not access the original channel.');
    return;
  }

  const sourceMessage = await sourceChannel.messages.fetch(messageId).catch(error => {
    logger?.error('Failed to fetch source message for moderator action', error);
    return null;
  });

  if (!sourceMessage) {
    await interaction.editReply('Could not find the original message. It may have been deleted already.');
    return;
  }

  if (action === MOD_ACTION_WARN) {
    await applyWarnInThread(sourceMessage, 'Please keep discussion respectful and follow the server rules.', 'warn', logger);
    await interaction.editReply('Posted a warning in a thread.');
  }

  if (action === MOD_ACTION_DELETE) {
    const deleteMessage = buildUserDm('A moderator removed your message because it violates server rules.', sourceMessage.content);
    await sourceMessage.delete().catch(() => null);
    await sourceMessage.author.send(deleteMessage).catch(() => null);
    await interaction.editReply('Deleted message and notified user via DM.');
  }


  const messageUrl = sourceMessage.url || `https://discord.com/channels/${interaction.guildId}/${channelId}/${messageId}`;
  const decisionAction = getDecisionActionFromLogMessage(interaction);
  const components = buildModeratorComponents(interaction.guildId, channelId, messageId, messageUrl, decisionAction, true);
  await interaction.message.edit({ components }).catch(error => {
    logger?.error('Failed to disable moderator action buttons', error);
    return null;
  });
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

  discordClient.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) {
      return;
    }

    await handleModeratorAction(interaction, logger).catch(error => {
      logger?.error('Failed to handle moderator action interaction', error);
    });
  });

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
      await applyDecision(message, decision, logger);
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
