import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GitHubIssue,
  GitHubPullRequest,
  AnalysisResult,
  TriageAssignment,
  AssignedDeveloper,
  TriageResult,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

// ── Expertise map types ──

interface ExpertiseContributor {
  name: string;
  commits: number;
}

interface ExpertiseTag {
  lead: string;
  description: string;
  contributors: ExpertiseContributor[];
}

interface DeveloperExpertise {
  tags: Record<string, ExpertiseTag>;
  developers: Record<string, { role: string; top_tags: string[] }>;
}

// ── Helpers ──

function loadJSON<T>(file: string): T {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`${file} not found in data/.`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match an item's labels (actual + AI-suggested) and category against
 * the expertise tag names. Returns the list of matched tag names.
 */
function matchTags(
  labels: string[],
  suggestedLabels: string[],
  category: string | undefined,
  tagNames: string[]
): string[] {
  const matched = new Set<string>();
  const allLabels = [...labels, ...suggestedLabels];

  for (const tag of tagNames) {
    const normTag = normalize(tag);
    for (const label of allLabels) {
      const normLabel = normalize(label);
      if (
        normLabel === normTag ||
        normTag.includes(normLabel) ||
        normLabel.includes(normTag)
      ) {
        matched.add(tag);
      }
    }
  }

  // Category-based fallback mapping
  if (category) {
    const categoryMap: Record<string, string[]> = {
      documentation: ["Documentation"],
      performance: ["Observability (AI Telemetry)"],
      security: ["Authentication"],
      devex: ["CLI", "Getting Started"],
    };
    for (const tag of categoryMap[category] || []) {
      matched.add(tag);
    }
  }

  return Array.from(matched);
}

/**
 * Score developers by total commits across all matched expertise tags.
 * Returns a ranked list (highest score first).
 */
function scoreDevelopers(
  matchedTags: string[],
  expertise: DeveloperExpertise
): AssignedDeveloper[] {
  const scores = new Map<string, { score: number; tags: Set<string> }>();

  for (const tag of matchedTags) {
    const tagData = expertise.tags[tag];
    if (!tagData) continue;

    for (const contributor of tagData.contributors) {
      const existing = scores.get(contributor.name) || {
        score: 0,
        tags: new Set<string>(),
      };
      existing.score += contributor.commits;
      existing.tags.add(tag);
      scores.set(contributor.name, existing);
    }
  }

  return Array.from(scores.entries())
    .map(([name, data]) => ({
      name,
      role: expertise.developers[name]?.role || "Contributor",
      matchedTags: Array.from(data.tags),
      score: data.score,
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Main ──

function main() {
  console.log("👥 Mastra OSS Triage — Developer Assignment");
  console.log(`   Time: ${new Date().toISOString()}\n`);

  const issues = loadJSON<GitHubIssue[]>("issues.json");
  const prs = loadJSON<GitHubPullRequest[]>("pull-requests.json");
  const expertise = loadJSON<DeveloperExpertise>("developer-expertise.json");
  console.log(`   Loaded ${issues.length} issues, ${prs.length} PRs, ${Object.keys(expertise.tags).length} expertise tags\n`);

  let analysis: AnalysisResult | null = null;
  try {
    analysis = loadJSON<AnalysisResult>("analysis.json");
    console.log("   Using AI analysis data for enriched matching\n");
  } catch {
    console.log("   analysis.json not found, proceeding with label-only matching\n");
  }

  const tagNames = Object.keys(expertise.tags);
  const assignments: TriageAssignment[] = [];

  // Process issues
  console.log("📋 Assigning developers to issues...");
  for (const issue of issues) {
    const labels = issue.labels.map((l) => l.name);
    const issueAnalysis = analysis?.issueAnalyses.find(
      (a) => a.issueNumber === issue.number
    );
    const suggestedLabels = issueAnalysis?.suggestedLabels || [];
    const category = issueAnalysis?.category;

    const matched = matchTags(labels, suggestedLabels, category, tagNames);
    const ranked = scoreDevelopers(matched, expertise);

    assignments.push({
      itemNumber: issue.number,
      itemType: "issue",
      assignedDevelopers: ranked.slice(0, 2),
      matchedTags: matched,
    });
  }

  // Process PRs
  console.log("🔀 Assigning reviewers to PRs...");
  for (const pr of prs) {
    const labels = pr.labels.map((l) => l.name);
    const matched = matchTags(labels, [], undefined, tagNames);
    const ranked = scoreDevelopers(matched, expertise);

    assignments.push({
      itemNumber: pr.number,
      itemType: "pr",
      assignedDevelopers: ranked.slice(0, 2),
      matchedTags: matched,
    });
  }

  const result: TriageResult = {
    generatedAt: new Date().toISOString(),
    assignments,
  };

  writeFileSync(join(DATA_DIR, "triage.json"), JSON.stringify(result, null, 2));

  const assigned = assignments.filter((a) => a.assignedDevelopers.length > 0).length;
  const unmatched = assignments.filter((a) => a.assignedDevelopers.length === 0).length;

  console.log(`\n✅ Triage complete!`);
  console.log(`   Total items:  ${assignments.length}`);
  console.log(`   Assigned:     ${assigned}`);
  console.log(`   No match:     ${unmatched}`);
  console.log(`   Output:       data/triage.json`);
}

main();
