import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GitHubIssue,
  GitHubPullRequest,
  FetchMetadata,
  AnalysisResult,
  TriageResult,
  TriageData,
} from "./types.js";

export * from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

function loadJSON<T>(filename: string): T | null {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function getIssues(): GitHubIssue[] {
  return loadJSON<GitHubIssue[]>("issues.json") ?? [];
}

export function getPullRequests(): GitHubPullRequest[] {
  return loadJSON<GitHubPullRequest[]>("pull-requests.json") ?? [];
}

export function getMetadata(): FetchMetadata | null {
  return loadJSON<FetchMetadata>("metadata.json");
}

export function getAnalysis(): AnalysisResult | null {
  return loadJSON<AnalysisResult>("analysis.json");
}

export function getTriage(): TriageResult | null {
  return loadJSON<TriageResult>("triage.json");
}

export function getTriageData(): TriageData {
  return {
    metadata: getMetadata() ?? {
      fetchedAt: "unknown",
      repo: "mastra-ai/mastra",
      issueCount: 0,
      prCount: 0,
    },
    issues: getIssues(),
    pullRequests: getPullRequests(),
    analysis: getAnalysis(),
  };
}
