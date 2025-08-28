import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { analysisAgent } from '../agents/analysis';
import { fetchPostsOutputSchema, fetchPostsStep } from './shared';
import { getDiscordClient } from '../helpers/client';
import { getFirstThreadMessage } from '../helpers/messages';


const analyzeMessages = createStep({
    id: 'analyzeMessages',
    inputSchema: fetchPostsOutputSchema,
    outputSchema: z.object({
        summaryData: z.array(z.object({
            category: z.string(),
            summary: z.string(),
            severity: z.enum(['POOR', 'FAIR', 'EXCELLENT']),
        })),
        summaryTable: z.string(),
    }),
    execute: async ({ inputData }) => {
        const discordClient = await getDiscordClient();

        const postsForAgent = []

        const postCache: Record<string, string> = {};

        console.log('Fetching threads...');

        for (const post of inputData.posts) {
            const message = await getFirstThreadMessage({
                client: discordClient,
                threadId: post.id,
            });

            if (message) {
                postsForAgent.push({
                    id: post.id,
                    message,
                    name: post.name,
                })

                postCache[post.id] = message;
            }
        }

        console.log(`Processing ${postsForAgent.length} posts`);

        const result = await analysisAgent.generate(`
            Analyze the following message:
            ${postsForAgent.map(p => `
                ID:${p.id}: ${p.name}: ${p.message}
            `).join('\n')}
            Return the category that this message belongs to.

            Shape:
            {
                "posts": [
                    {
                        "id": "string",
                        "category": "string"
                    }
                ]
            }
        `, {
            output: z.object({
                posts: z.array(z.object({
                    id: z.string(),
                    category: z.string(),
                }))
            }),
        });

        console.log('Categorized posts:', result.object.posts);

        // Group posts by category
        const groupedPosts = result.object.posts.reduce((acc, post) => {
            const category = post.category;
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(post);
            return acc;
        }, {} as Record<string, Array<{ id: string, category: string }>>);

        console.log('Posts grouped by category:', groupedPosts);


        const summary = [];

        for (const category in groupedPosts) {
            console.log(`Category: ${category}`);

            const messages = groupedPosts[category].map(post => postCache[post.id]).join('\n')

            const result = await analysisAgent.generate(`
                Analyze the following messages:
                ${messages}
               
                Summarize the messages in a way that explains what the general issue of the category is.
                Rate the severity based on your judgement of the messages from POOR | FAIR | EXCELLENT

                Shape:
                {
                    "summary": "string",
                    "severity": "POOR | FAIR | EXCELLENT"
                }
            `, {
                output: z.object({
                    summary: z.string(),
                    severity: z.enum(['POOR', 'FAIR', 'EXCELLENT']),
                }),
            });

            summary.push({
                category,
                summary: result.object.summary,
                severity: result.object.severity,
            });
        }

        const markdownTable = `
| Category | Count | Severity | Summary |
|----------|-------|----------|---------|
${summary.map(item => {
            const count = groupedPosts[item.category]?.length || 0;
            const severityEmoji = item.severity === 'EXCELLENT' ? '🟢' :
                item.severity === 'FAIR' ? '🟡' : '🔴';
            return `| ${item.category} | ${count} | ${severityEmoji} ${item.severity} | ${item.summary} |`;
        }).join('\n')}
        `.trim();

        console.log('\n=== CATEGORY ANALYSIS SUMMARY ===');
        console.log(markdownTable);

        return {
            summaryData: summary,
            summaryTable: markdownTable
        }
    },
});

// Create the workflow
export const discordAnalysisWorkflow = createWorkflow({
    id: 'discord-analysis',
    inputSchema: z.object({
        forumChannelId: z.string(),
        fetchLimit: z.coerce.number().optional().default(1),
    }),
    outputSchema: z.object({
        summaryData: z.array(z.object({
            category: z.string(),
            summary: z.string(),
            severity: z.enum(['POOR', 'FAIR', 'EXCELLENT']),
        })),
        summaryTable: z.string(),
    }),
}).then(fetchPostsStep).then(analyzeMessages).commit();
