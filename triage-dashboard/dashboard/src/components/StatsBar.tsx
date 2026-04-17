import type { GitHubIssue, GitHubPullRequest, FetchMetadata } from "../types";
import { daysSince, computeStaleness } from "../utils";

interface Props {
  issues: GitHubIssue[];
  prs: GitHubPullRequest[];
  metadata: FetchMetadata | null;
}

export function StatsBar({ issues, prs, metadata }: Props) {
  const staleIssues = issues.filter((i) => computeStaleness(i) > 60).length;
  const stalePRs = prs.filter((p) => computeStaleness(p) > 60).length;
  const draftPRs = prs.filter((p) => p.isDraft).length;
  const unreviewedPRs = prs.filter(
    (p) => !p.isDraft && (!p.reviewDecision || p.reviewDecision === "REVIEW_REQUIRED")
  ).length;

  const avgIssueAge =
    issues.length > 0
      ? Math.round(issues.reduce((sum, i) => sum + daysSince(i.createdAt), 0) / issues.length)
      : 0;
  const avgPRAge =
    prs.length > 0
      ? Math.round(prs.reduce((sum, p) => sum + daysSince(p.createdAt), 0) / prs.length)
      : 0;

  const stats = [
    { label: "Open Issues", value: issues.length, color: "text-green-400" },
    { label: "Open PRs", value: prs.length, color: "text-blue-400" },
    { label: "Stale Issues", value: staleIssues, color: "text-orange-400" },
    { label: "Stale PRs", value: stalePRs, color: "text-orange-400" },
    { label: "Draft PRs", value: draftPRs, color: "text-gray-400" },
    { label: "Needs Review", value: unreviewedPRs, color: "text-red-400" },
    { label: "Avg Issue Age", value: `${avgIssueAge}d`, color: "text-purple-400" },
    { label: "Avg PR Age", value: `${avgPRAge}d`, color: "text-purple-400" },
  ];

  return (
    <div className="border-b border-[#30363d] bg-[#161b22] px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold text-white">
          Mastra OSS Triage
        </h1>
        {metadata && (
          <span className="text-xs text-[#8b949e]">
            Last fetched: {new Date(metadata.fetchedAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-[#8b949e]">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
