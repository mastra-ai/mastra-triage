// ── GitHub primitives ──

export interface GitHubUser {
  login: string;
  id?: number;
  url?: string;
  avatarUrl?: string;
}

export interface GitHubLabel {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface GitHubMilestone {
  number: number;
  title: string;
  description: string;
  dueOn: string | null;
  state: string;
}

export interface GitHubReactionGroup {
  content: string;
  totalCount: number;
  users: GitHubUser[];
}

export interface GitHubComment {
  id: string;
  author: GitHubUser;
  body: string;
  createdAt: string;
  updatedAt: string;
  reactionGroups: GitHubReactionGroup[];
}

export interface GitHubReview {
  id: string;
  author: GitHubUser;
  body: string;
  state: string; // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
  submittedAt: string;
}

export interface GitHubFile {
  path: string;
  additions: number;
  deletions: number;
}

// ── Issues ──

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  stateReason: string | null;
  author: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  milestone: GitHubMilestone | null;
  comments: GitHubComment[];
  reactionGroups: GitHubReactionGroup[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
  isPinned: boolean;
  closedByPullRequestsReferences: { number: number; title: string; url: string }[];
}

// ── Pull Requests ──

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  author: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  milestone: GitHubMilestone | null;
  comments: GitHubComment[];
  reviews: GitHubReview[];
  reactionGroups: GitHubReactionGroup[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergedBy: GitHubUser | null;
  url: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: GitHubFile[];
  headRefName: string;
  baseRefName: string;
  reviewDecision: string;
  mergeable: string;
}

// ── AI Analysis ──

export type IssuePriority = "critical" | "high" | "medium" | "low" | "none";

export type IssueCategory =
  | "bug"
  | "feature-request"
  | "enhancement"
  | "question"
  | "documentation"
  | "performance"
  | "security"
  | "devex"
  | "other";

export interface StalenessScore {
  score: number; // 0-100, higher = more stale
  factors: string[];
  lastMeaningfulActivity: string; // ISO date
}

export interface PRIssueLink {
  prNumber: number;
  issueNumber: number;
  confidence: number; // 0-1
  reason: string;
}

export interface DuplicateGroup {
  canonical: number; // the "main" issue number
  duplicates: number[];
  reason: string;
}

export interface IssueAnalysis {
  issueNumber: number;
  category: IssueCategory;
  priority: IssuePriority;
  priorityReason: string;
  staleness: StalenessScore;
  summary: string;
  suggestedLabels: string[];
  relatedIssues: number[];
}

export interface PRAnalysis {
  prNumber: number;
  summary: string;
  staleness: StalenessScore;
  linkedIssues: PRIssueLink[];
  reviewStatus: string;
  riskLevel: "low" | "medium" | "high";
  riskReason: string;
}

export interface AnalysisResult {
  generatedAt: string;
  issueAnalyses: IssueAnalysis[];
  prAnalyses: PRAnalysis[];
  prIssueLinks: PRIssueLink[];
  duplicateGroups: DuplicateGroup[];
  stats: {
    totalOpenIssues: number;
    totalOpenPRs: number;
    staleIssuesCount: number;
    stalePRsCount: number;
    unreviewedPRsCount: number;
    avgIssueAge: number;
    avgPRAge: number;
  };
}

// ── Triage (developer assignment) ──

export interface AssignedDeveloper {
  name: string;
  role: string;
  matchedTags: string[];
  score: number;
}

export interface TriageAssignment {
  itemNumber: number;
  itemType: "issue" | "pr";
  assignedDevelopers: AssignedDeveloper[];
  matchedTags: string[];
}

export interface TriageResult {
  generatedAt: string;
  assignments: TriageAssignment[];
}

// ── Exported data shape ──

export interface FetchMetadata {
  fetchedAt: string;
  repo: string;
  issueCount: number;
  prCount: number;
}

export interface TriageData {
  metadata: FetchMetadata;
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  analysis: AnalysisResult | null;
}
