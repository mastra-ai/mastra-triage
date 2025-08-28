import { getDiscordClient } from "./client";
import { fetchMessages } from "./messages";

export async function scrapeDiscordMessages({ channelId, startDate, endDate, timeRange }: { channelId: string, startDate: string, endDate: string, timeRange?: string }) {
    console.log('Scraping Discord messages...');

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
}