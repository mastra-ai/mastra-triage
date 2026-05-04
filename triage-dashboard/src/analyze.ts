import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type {
  GitHubIssue,
  GitHubPullRequest,
  AnalysisResult,
  IssueAnalysis,
  PRAnalysis,
  PRIssueLink,
  DuplicateGroup,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

// ── Load data ──

function loadJSON<T>(file: string): T {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`${file} not found. Run 'npm run fetch' first.`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ── OpenAI setup ──

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function chat(
  systemPrompt: string,
  userPrompt: string,
  model = "gpt-4o-mini"
): Promise<string> {
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });
  return res.choices[0].message.content || "{}";
}

// ── Helpers ──

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function getLastActivity(item: GitHubIssue | GitHubPullRequest): string {
  const dates = [item.updatedAt];
  if (item.comments?.length) {
    dates.push(item.comments[item.comments.length - 1].createdAt);
  }
  if ("reviews" in item && (item as GitHubPullRequest).reviews?.length) {
    const reviews = (item as GitHubPullRequest).reviews;
    dates.push(reviews[reviews.length - 1].submittedAt);
  }
  return dates.sort().pop()!;
}

function issueSummaryForAI(issue: GitHubIssue): string {
  const commentSummary = issue.comments
    ?.slice(0, 5)
    .map((c) => `  [${c.author?.login}]: ${c.body?.slice(0, 150)}`)
    .join("\n") || "";
  return [
    `#${issue.number}: ${issue.title}`,
    `Author: @${issue.author.login} | Labels: ${issue.labels.map((l) => l.name).join(", ") || "none"}`,
    `Created: ${issue.createdAt} | Updated: ${issue.updatedAt} | Comments: ${issue.comments?.length || 0}`,
    `Body: ${issue.body?.slice(0, 400) || "empty"}`,
    commentSummary ? `Recent comments:\n${commentSummary}` : "",
  ].filter(Boolean).join("\n");
}

function prSummaryForAI(pr: GitHubPullRequest): string {
  const commentSummary = pr.comments
    ?.slice(0, 3)
    .map((c) => `  [${c.author?.login}]: ${c.body?.slice(0, 150)}`)
    .join("\n") || "";
  const reviewSummary = pr.reviews
    ?.slice(0, 3)
    .map((r) => `  [${r.author?.login}] ${r.state}: ${r.body?.slice(0, 100)}`)
    .join("\n") || "";
  return [
    `PR #${pr.number}: ${pr.title}`,
    `Author: @${pr.author.login} | Branch: ${pr.headRefName} → ${pr.baseRefName}`,
    `Labels: ${pr.labels.map((l) => l.name).join(", ") || "none"}`,
    `Created: ${pr.createdAt} | Updated: ${pr.updatedAt} | Draft: ${pr.isDraft}`,
    `+${pr.additions} -${pr.deletions} (${pr.changedFiles} files) | Review: ${pr.reviewDecision || "pending"}`,
    `Body: ${pr.body?.slice(0, 400) || "empty"}`,
    reviewSummary ? `Reviews:\n${reviewSummary}` : "",
    commentSummary ? `Comments:\n${commentSummary}` : "",
  ].filter(Boolean).join("\n");
}

// ── Analysis functions ──

async function analyzeIssuesBatch(issues: GitHubIssue[]): Promise<IssueAnalysis[]> {
  const summaries = issues.map(issueSummaryForAI).join("\n---\n");

  const system = `You are a GitHub issue triage assistant for the Mastra open-source project (AI framework in TypeScript).
Analyze each issue and return JSON with an "analyses" array containing objects with these fields:
- issueNumber: number
- category: one of "bug", "feature-request", "enhancement", "question", "documentation", "performance", "security", "devex", "other"
- priority: one of "critical", "high", "medium", "low", "none"
- priorityReason: brief explanation (1 sentence)
- staleness: { score: 0-100, factors: string[], lastMeaningfulActivity: ISO date }
- summary: 1-2 sentence summary of the issue
- suggestedLabels: string[]
- relatedIssues: number[] (other issue numbers from this batch that seem related)

For staleness, consider: days since last activity, whether there's been meaningful discussion, if assigned, if there's a clear path forward.
For priority, consider: number of reactions/comments (community interest), severity, whether it blocks other work, security implications.`;

  const raw = await chat(system, summaries);
  const parsed = JSON.parse(raw);
  return parsed.analyses || [];
}

async function analyzePRsBatch(prs: GitHubPullRequest[]): Promise<PRAnalysis[]> {
  const summaries = prs.map(prSummaryForAI).join("\n---\n");

  const system = `You are a GitHub PR triage assistant for the Mastra open-source project (AI framework in TypeScript).
Analyze each PR and return JSON with an "analyses" array containing objects with these fields:
- prNumber: number
- summary: 1-2 sentence summary of the PR
- staleness: { score: 0-100, factors: string[], lastMeaningfulActivity: ISO date }
- reviewStatus: brief assessment of review state
- riskLevel: "low", "medium", or "high"
- riskReason: brief explanation

For staleness, consider: days since last activity, review status, whether changes requested were addressed.
For risk, consider: size of changes, whether it touches core code, test coverage implications.`;

  const raw = await chat(system, summaries);
  const parsed = JSON.parse(raw);
  return parsed.analyses || [];
}

async function findPRIssueLinks(
  issues: GitHubIssue[],
  prs: GitHubPullRequest[]
): Promise<PRIssueLink[]> {
  // Build compact issue index
  const issueIndex = issues
    .map((i) => `#${i.number}: ${i.title} [${i.labels.map((l) => l.name).join(",")}]`)
    .join("\n");

  const prIndex = prs
    .map(
      (p) =>
        `PR #${p.number}: ${p.title} (branch: ${p.headRefName}) [${p.labels.map((l) => l.name).join(",")}] body: ${p.body?.slice(0, 200)}`
    )
    .join("\n");

  const system = `You are analyzing a GitHub repository to find links between pull requests and issues.
Given a list of open issues and open PRs, identify which PRs are likely addressing which issues.
Look for:
- PR titles/descriptions mentioning issue numbers (e.g., "fixes #123", "closes #456")
- PR branch names referencing issue numbers
- Semantic similarity between PR descriptions and issue descriptions
- PRs and issues with matching labels or topics

Return JSON with a "links" array of objects: { prNumber, issueNumber, confidence (0-1), reason }
Only include links with confidence >= 0.3. Be thorough but accurate.`;

  const raw = await chat(
    system,
    `ISSUES:\n${issueIndex}\n\nPULL REQUESTS:\n${prIndex}`,
    "gpt-4o-mini"
  );
  const parsed = JSON.parse(raw);
  return parsed.links || [];
}

async function findDuplicates(issues: GitHubIssue[]): Promise<DuplicateGroup[]> {
  const issueIndex = issues
    .map(
      (i) =>
        `#${i.number}: ${i.title} | Labels: ${i.labels.map((l) => l.name).join(",")} | ${i.body?.slice(0, 150)}`
    )
    .join("\n");

  const system = `You are analyzing GitHub issues to find duplicates or very closely related issues.
Group issues that describe the same problem or feature request.
Return JSON with a "groups" array of objects: { canonical: number (the best/oldest/most-detailed issue), duplicates: number[], reason: string }
Only include groups where you're fairly confident the issues are duplicates or very closely related. Don't over-group.`;

  const raw = await chat(system, issueIndex, "gpt-4o-mini");
  const parsed = JSON.parse(raw);
  return parsed.groups || [];
}

// ── Main ──

async function main() {
  console.log("🤖 Mastra OSS Triage — AI Analysis");
  console.log(`   Time: ${new Date().toISOString()}\n`);

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set. Create a .env file or export it.");
    process.exit(1);
  }

  const issues = loadJSON<GitHubIssue[]>("issues.json");
  const prs = loadJSON<GitHubPullRequest[]>("pull-requests.json");
  console.log(`   Loaded ${issues.length} issues and ${prs.length} PRs\n`);

  // Process in batches to stay within token limits
  const ISSUE_BATCH = 20;
  const PR_BATCH = 15;

  // 1. Analyze issues
  console.log("📋 Analyzing issues...");
  const allIssueAnalyses: IssueAnalysis[] = [];
  for (let i = 0; i < issues.length; i += ISSUE_BATCH) {
    const batch = issues.slice(i, i + ISSUE_BATCH);
    console.log(
      `  Batch ${Math.floor(i / ISSUE_BATCH) + 1}/${Math.ceil(issues.length / ISSUE_BATCH)} (${batch.length} issues)...`
    );
    try {
      const analyses = await analyzeIssuesBatch(batch);
      allIssueAnalyses.push(...analyses);
    } catch (err) {
      console.error(`  ⚠ Batch failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`  ✓ ${allIssueAnalyses.length} issue analyses\n`);

  // 2. Analyze PRs
  console.log("🔀 Analyzing PRs...");
  const allPRAnalyses: PRAnalysis[] = [];
  for (let i = 0; i < prs.length; i += PR_BATCH) {
    const batch = prs.slice(i, i + PR_BATCH);
    console.log(
      `  Batch ${Math.floor(i / PR_BATCH) + 1}/${Math.ceil(prs.length / PR_BATCH)} (${batch.length} PRs)...`
    );
    try {
      const analyses = await analyzePRsBatch(batch);
      allPRAnalyses.push(...analyses);
    } catch (err) {
      console.error(`  ⚠ Batch failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`  ✓ ${allPRAnalyses.length} PR analyses\n`);

  // 3. Find PR-Issue links
  console.log("🔗 Finding PR-Issue links...");
  let prIssueLinks: PRIssueLink[] = [];
  try {
    prIssueLinks = await findPRIssueLinks(issues, prs);
    console.log(`  ✓ ${prIssueLinks.length} links found\n`);
  } catch (err) {
    console.error(`  ⚠ Link analysis failed:`, err instanceof Error ? err.message : err);
  }

  // Merge links from PR analyses
  for (const pa of allPRAnalyses) {
    if (pa.linkedIssues) {
      for (const link of pa.linkedIssues) {
        if (!prIssueLinks.some((l) => l.prNumber === link.prNumber && l.issueNumber === link.issueNumber)) {
          prIssueLinks.push(link);
        }
      }
    }
  }

  // 4. Find duplicates
  console.log("🔍 Finding duplicate issues...");
  let duplicateGroups: DuplicateGroup[] = [];
  try {
    duplicateGroups = await findDuplicates(issues);
    console.log(`  ✓ ${duplicateGroups.length} duplicate groups found\n`);
  } catch (err) {
    console.error(`  ⚠ Duplicate analysis failed:`, err instanceof Error ? err.message : err);
  }

  // 5. Compute stats
  const staleThreshold = 60;
  const staleIssues = allIssueAnalyses.filter((a) => a.staleness.score >= staleThreshold);
  const stalePRs = allPRAnalyses.filter((a) => a.staleness.score >= staleThreshold);
  const unreviewedPRs = prs.filter(
    (p) => !p.isDraft && (!p.reviewDecision || p.reviewDecision === "REVIEW_REQUIRED")
  );

  const result: AnalysisResult = {
    generatedAt: new Date().toISOString(),
    issueAnalyses: allIssueAnalyses,
    prAnalyses: allPRAnalyses,
    prIssueLinks,
    duplicateGroups,
    stats: {
      totalOpenIssues: issues.length,
      totalOpenPRs: prs.length,
      staleIssuesCount: staleIssues.length,
      stalePRsCount: stalePRs.length,
      unreviewedPRsCount: unreviewedPRs.length,
      avgIssueAge: Math.round(
        issues.reduce((s, i) => s + daysSince(i.createdAt), 0) / (issues.length || 1)
      ),
      avgPRAge: Math.round(
        prs.reduce((s, p) => s + daysSince(p.createdAt), 0) / (prs.length || 1)
      ),
    },
  };

  writeFileSync(join(DATA_DIR, "analysis.json"), JSON.stringify(result, null, 2));

  console.log("✅ Analysis complete!");
  console.log(`   Issue analyses: ${allIssueAnalyses.length}`);
  console.log(`   PR analyses:    ${allPRAnalyses.length}`);
  console.log(`   PR-Issue links: ${prIssueLinks.length}`);
  console.log(`   Duplicate groups: ${duplicateGroups.length}`);
  console.log(`   Stale issues:   ${staleIssues.length}`);
  console.log(`   Stale PRs:      ${stalePRs.length}`);
  console.log(`   Output: data/analysis.json`);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
