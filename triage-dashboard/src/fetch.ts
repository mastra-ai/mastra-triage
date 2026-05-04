import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GitHubIssue,
  GitHubPullRequest,
  FetchMetadata,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const REPO = "mastra-ai/mastra";

function gh(args: string): string {
  const cmd = `gh ${args}`;
  const short = cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
  console.log(`  → ${short}`);
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 100 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (err: any) {
    const stderr = err.stderr?.toString().slice(0, 300) || "unknown error";
    console.error(`  ✗ Failed: ${stderr}`);
    throw err;
  }
}

const ISSUE_FIELDS = [
  "number", "title", "body", "state", "stateReason", "author",
  "assignees", "labels", "milestone", "comments", "reactionGroups",
  "createdAt", "updatedAt", "closedAt", "url", "isPinned",
  "closedByPullRequestsReferences",
].join(",");

// Bulk PR fields — no comments/reviews/files/reactionGroups (causes 502 on bulk)
const PR_FIELDS_BULK = [
  "number", "title", "body", "state", "author", "assignees", "labels",
  "milestone", "createdAt", "updatedAt", "closedAt", "mergedAt", "mergedBy",
  "url", "isDraft", "additions", "deletions", "changedFiles",
  "headRefName", "baseRefName", "reviewDecision", "mergeable",
].join(",");

function fetchAllIssues(): GitHubIssue[] {
  console.log("\n📋 Fetching open issues...");
  const raw = gh(
    `issue list --repo ${REPO} --state open --limit 500 --json ${ISSUE_FIELDS}`
  );
  const issues: GitHubIssue[] = JSON.parse(raw);
  console.log(`  ✓ ${issues.length} issues`);
  return issues;
}

function fetchAllPRs(): GitHubPullRequest[] {
  console.log("\n🔀 Fetching open pull requests...");

  // Step 1: Bulk metadata
  console.log("  Step 1/2: Fetching PR metadata...");
  const raw = gh(
    `pr list --repo ${REPO} --state open --limit 500 --json ${PR_FIELDS_BULK}`
  );
  const prs: GitHubPullRequest[] = JSON.parse(raw);
  console.log(`  ✓ ${prs.length} PRs`);

  // Step 2: Per-PR comments & reviews
  console.log(`  Step 2/2: Fetching comments & reviews for ${prs.length} PRs...`);
  let ok = 0;
  let fail = 0;
  for (const pr of prs) {
    try {
      const detail = gh(
        `pr view ${pr.number} --repo ${REPO} --json comments,reviews,reactionGroups`
      );
      const d = JSON.parse(detail);
      pr.comments = d.comments || [];
      pr.reviews = d.reviews || [];
      pr.reactionGroups = d.reactionGroups || [];
      ok++;
    } catch {
      pr.comments = [];
      pr.reviews = [];
      pr.reactionGroups = [];
      fail++;
    }
    pr.files = []; // not fetching file details
    if ((ok + fail) % 50 === 0 || ok + fail === prs.length) {
      console.log(`    ${ok + fail}/${prs.length} (${fail} failed)`);
    }
  }
  console.log(`  ✓ Enriched ${ok} PRs (${fail} skipped)`);
  return prs;
}

function main() {
  console.log("🚀 Mastra OSS Triage — Fetch");
  console.log(`   ${REPO} | ${new Date().toISOString()}\n`);

  mkdirSync(DATA_DIR, { recursive: true });

  const issues = fetchAllIssues();
  const pullRequests = fetchAllPRs();

  const metadata: FetchMetadata = {
    fetchedAt: new Date().toISOString(),
    repo: REPO,
    issueCount: issues.length,
    prCount: pullRequests.length,
  };

  writeFileSync(join(DATA_DIR, "issues.json"), JSON.stringify(issues, null, 2));
  writeFileSync(join(DATA_DIR, "pull-requests.json"), JSON.stringify(pullRequests, null, 2));
  writeFileSync(join(DATA_DIR, "metadata.json"), JSON.stringify(metadata, null, 2));

  console.log(`\n✅ Done! ${issues.length} issues + ${pullRequests.length} PRs → data/`);
}

main();
