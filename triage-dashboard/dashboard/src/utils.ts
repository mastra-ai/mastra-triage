import { createElement } from "react";
import type { GitHubIssue, GitHubPullRequest, GitHubComment, GitHubReview } from "./types";

export function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeAgo(dateStr: string): string {
  const days = daysSince(dateStr);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function getLastActivity(item: GitHubIssue | GitHubPullRequest): string {
  const dates = [item.updatedAt];
  if (item.comments?.length) {
    dates.push(item.comments[item.comments.length - 1].createdAt);
  }
  if ("reviews" in item && item.reviews?.length) {
    dates.push((item.reviews as GitHubReview[])[item.reviews.length - 1].submittedAt);
  }
  return dates.sort().pop()!;
}

export function computeStaleness(item: GitHubIssue | GitHubPullRequest): number {
  const lastActivity = getLastActivity(item);
  const days = daysSince(lastActivity);
  // 0-100 score, logarithmic scale
  // 7 days = ~20, 30 days = ~50, 90 days = ~75, 365 days = ~95
  return Math.min(100, Math.round(Math.log(days + 1) / Math.log(365) * 100));
}

export function getReactionCount(item: GitHubIssue | GitHubPullRequest): number {
  if (!item.reactionGroups) return 0;
  return item.reactionGroups.reduce((sum, rg) => sum + (rg.totalCount || rg.users?.length || 0), 0);
}

export function labelColor(hex: string): { bg: string; text: string } {
  // Convert hex to RGB, determine if light or dark
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    bg: `#${hex}22`,
    text: luminance > 0.5 ? `#${hex}` : `#${hex}dd`,
  };
}

export function truncate(str: string, max: number): string {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

export function isPR(item: GitHubIssue | GitHubPullRequest): item is GitHubPullRequest {
  return "headRefName" in item;
}

export function getAllAuthors(issues: GitHubIssue[], prs: GitHubPullRequest[]): string[] {
  const authors = new Set<string>();
  for (const i of issues) authors.add(i.author.login);
  for (const p of prs) authors.add(p.author.login);
  return [...authors].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function getAllLabels(issues: GitHubIssue[], prs: GitHubPullRequest[]): string[] {
  const labels = new Set<string>();
  for (const i of issues) i.labels.forEach((l) => labels.add(l.name));
  for (const p of prs) p.labels.forEach((l) => labels.add(l.name));
  return [...labels].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function getCommentCount(item: GitHubIssue | GitHubPullRequest): number {
  let count = item.comments?.length || 0;
  if ("reviews" in item) {
    count += ((item as GitHubPullRequest).reviews?.length || 0);
  }
  return count;
}

export function highlightText(text: string, query: string) {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part)
      ? createElement("mark", { key: i, className: "bg-[#58a6ff33] text-[#58a6ff] rounded px-0.5" }, part)
      : part
  );
}
