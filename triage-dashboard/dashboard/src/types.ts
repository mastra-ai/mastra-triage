// Mirror of the types from the main package, for dashboard use

export interface GitHubUser {
  login: string;
  id?: string | number;
  url?: string;
  avatarUrl?: string;
  is_bot?: boolean;
  name?: string;
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
  updatedAt?: string;
  reactionGroups?: GitHubReactionGroup[];
}

export interface GitHubReview {
  id: string;
  author: GitHubUser;
  body: string;
  state: string;
  submittedAt: string;
}

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
  hidden?: boolean;
}

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
  headRefName: string;
  baseRefName: string;
  reviewDecision: string;
  mergeable: string;
  hidden?: boolean;
}

export interface FetchMetadata {
  fetchedAt: string;
  repo: string;
  issueCount: number;
  prCount: number;
}

// Analysis types (for when AI analysis is available)
export type IssuePriority = "critical" | "high" | "medium" | "low" | "none";
export type IssueCategory =
  | "bug" | "feature-request" | "enhancement" | "question"
  | "documentation" | "performance" | "security" | "devex" | "other";

export interface IssueAnalysis {
  issueNumber: number;
  category: IssueCategory;
  priority: IssuePriority;
  priorityReason: string;
  staleness: { score: number; factors: string[]; lastMeaningfulActivity: string };
  summary: string;
  suggestedLabels: string[];
  relatedIssues: number[];
}

export interface PRAnalysis {
  prNumber: number;
  summary: string;
  staleness: { score: number; factors: string[]; lastMeaningfulActivity: string };
  linkedIssues: { prNumber: number; issueNumber: number; confidence: number; reason: string }[];
  reviewStatus: string;
  riskLevel: "low" | "medium" | "high";
  riskReason: string;
}

export interface DuplicateGroup {
  canonical: number;
  duplicates: number[];
  reason: string;
}

export interface AnalysisResult {
  generatedAt: string;
  issueAnalyses: IssueAnalysis[];
  prAnalyses: PRAnalysis[];
  prIssueLinks: { prNumber: number; issueNumber: number; confidence: number; reason: string }[];
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

// Triage (developer assignment)

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

// Filter/sort state
export type SortField = "created" | "updated" | "comments" | "reactions" | "staleness";
export type SortDirection = "asc" | "desc";
export type ViewMode = "issues" | "prs" | "all";

export interface FilterState {
  search: string;
  authors: string[];
  labels: string[];
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  showDrafts: boolean;
  showHidden: boolean;
  dateFrom: string;
  dateTo: string;
}
