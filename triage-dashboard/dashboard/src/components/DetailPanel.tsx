import { useRef, useCallback, useState } from "react";
import type { GitHubIssue, GitHubPullRequest, AnalysisResult, TriageResult } from "../types";
import { formatDate, timeAgo, computeStaleness, getCommentCount, getReactionCount, labelColor } from "../utils";
import { useFavorites } from "../context/FavoritesContext";

interface Props {
  item: (GitHubIssue | GitHubPullRequest) & { _kind: "issue" | "pr" };
  analysis: AnalysisResult | null;
  triage: TriageResult | null;
  allIssues: GitHubIssue[];
  allPRs: GitHubPullRequest[];
  onClose: () => void;
  onToggleHidden: (kind: "issue" | "pr", number: number, hidden: boolean) => void;
}

export function DetailPanel({ item, analysis, triage, allIssues, allPRs, onClose, onToggleHidden }: Props) {
  const isPR = item._kind === "pr";
  const pr = isPR ? (item as GitHubPullRequest) : null;
  const staleness = computeStaleness(item);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(item._kind, item.number);
  const isHidden = !!item.hidden;
  const [descCollapsed, setDescCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Find analysis data
  const issueAnalysis = analysis?.issueAnalyses.find((a) => a.issueNumber === item.number);
  const prAnalysis = analysis?.prAnalyses.find((a) => a.prNumber === item.number);
  const itemAnalysis = isPR ? prAnalysis : issueAnalysis;

  // Find triage assignment
  const triageAssignment = triage?.assignments.find(
    (a) => a.itemNumber === item.number && a.itemType === item._kind
  );

  // Find linked items
  const linkedPRs = isPR
    ? analysis?.prIssueLinks
        .filter((l) => l.prNumber === item.number)
        .map((l) => ({ ...l, issue: allIssues.find((i) => i.number === l.issueNumber) }))
    : analysis?.prIssueLinks
        .filter((l) => l.issueNumber === item.number)
        .map((l) => ({ ...l, pr: allPRs.find((p) => p.number === l.prNumber) }));

  // Prevent scroll events from propagating to the background
  const panelRef = useRef<HTMLDivElement>(null);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex" onWheel={handleWheel}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel - wider for big monitors */}
      <div
        ref={panelRef}
        className="w-[1100px] max-w-[85vw] bg-[#0d1117] border-l border-[#30363d] overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#161b22] border-b border-[#30363d] px-8 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={isPR ? "text-[#58a6ff] text-lg" : "text-[#3fb950] text-lg"}>
                  {isPR ? "↗" : "●"}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`#${item.number}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-sm text-[#8b949e] hover:text-[#58a6ff] transition-colors cursor-pointer"
                  title="Click to copy"
                >
                  {copied ? "Copied!" : `#${item.number}`}
                </button>
                {pr?.isDraft && (
                  <span className="px-1.5 py-0.5 text-[10px] border border-[#30363d] text-[#8b949e] rounded-full">
                    Draft
                  </span>
                )}
              </div>
              <h2 className="text-xl font-semibold text-white mt-1.5 leading-snug">
                {item.title}
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md border border-[#30363d] text-[#484f58] hover:text-[#58a6ff] hover:border-[#58a6ff] transition-all"
                title="View on GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
              </a>
              <button
                onClick={() => toggleFavorite(item)}
                className={`p-2 rounded-md border transition-all ${
                  favorited
                    ? "bg-[#58a6ff22] border-[#58a6ff] text-[#58a6ff]"
                    : "border-[#30363d] text-[#484f58] hover:text-[#58a6ff] hover:border-[#58a6ff]"
                }`}
                title={favorited ? "Remove from favorites" : "Add to favorites"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={favorited ? "#58a6ff" : "none"} stroke="currentColor" strokeWidth="2">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                </svg>
              </button>
              <button
                onClick={() => onToggleHidden(item._kind, item.number, !isHidden)}
                className={`p-2 rounded-md border transition-all ${
                  isHidden
                    ? "bg-[#d2992222] border-[#d29922] text-[#d29922]"
                    : "border-[#30363d] text-[#484f58] hover:text-[#d29922] hover:border-[#d29922]"
                }`}
                title={isHidden ? "Unhide" : "Hide until next sync"}
              >
                {isHidden ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 1l22 22" />
                    <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
              <button
                onClick={onClose}
                className="p-2 text-[#8b949e] hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-5 mt-3 text-sm text-[#8b949e]">
            <span>@{item.author.login}</span>
            <span>Created {formatDate(item.createdAt)}</span>
            <span>Updated {timeAgo(item.updatedAt)}</span>
            <span>Comments: {getCommentCount(item)}</span>
            <span>Reactions: {getReactionCount(item)}</span>
            {isPR && pr && (
              <>
                <span className="text-[#3fb950]">+{pr.additions}</span>
                <span className="text-[#f85149]">-{pr.deletions}</span>
                <span>{pr.changedFiles} files</span>
              </>
            )}
          </div>
        </div>

        <div className="px-8 py-6 space-y-4">
          {/* Compact metadata strip: staleness, labels, assignees — all inline */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Staleness */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">Staleness</span>
              <div className="w-24 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    staleness > 75 ? "bg-red-500" : staleness > 50 ? "bg-orange-400" : staleness > 25 ? "bg-yellow-400" : "bg-green-500"
                  }`}
                  style={{ width: `${staleness}%` }}
                />
              </div>
              <span className="text-xs font-mono text-[#8b949e]">{staleness}</span>
            </div>

            {/* Divider */}
            {(item.labels.length > 0 || item.assignees.length > 0) && (
              <span className="text-[#30363d]">|</span>
            )}

            {/* Labels — inline */}
            {item.labels.map((label) => {
              const colors = labelColor(label.color);
              return (
                <span
                  key={label.id}
                  className="px-2 py-0.5 text-[10px] rounded-full font-medium leading-tight"
                  style={{ backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.text}33` }}
                >
                  {label.name}
                </span>
              );
            })}

            {/* Assignees — inline */}
            {item.assignees.map((a) => (
              <span key={a.login} className="px-2 py-0.5 text-[10px] bg-[#21262d] text-[#e6edf3] rounded">
                @{a.login}
              </span>
            ))}
          </div>

          {/* AI Analysis + PR info + Linked items — compact row */}
          {(itemAnalysis || (linkedPRs && linkedPRs.length > 0) || (isPR && pr)) && (
            <div className="flex flex-wrap gap-4">
              {/* AI Analysis */}
              {itemAnalysis && (
                <div className="flex-1 min-w-[280px] bg-[#161b22] border border-[#30363d] rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="text-[10px] font-semibold text-[#bc8cff] uppercase tracking-wider">
                      AI Analysis
                    </h3>
                    {"category" in itemAnalysis && (
                      <>
                        <span className="px-1.5 py-0.5 text-[10px] bg-[#bc8cff22] text-[#bc8cff] rounded-full">
                          {itemAnalysis.category}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] bg-[#d2992222] text-[#d29922] rounded-full">
                          {itemAnalysis.priority}
                        </span>
                      </>
                    )}
                    {"riskLevel" in itemAnalysis && (
                      <span
                        className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                          itemAnalysis.riskLevel === "high"
                            ? "bg-[#f8514922] text-[#f85149]"
                            : itemAnalysis.riskLevel === "medium"
                            ? "bg-[#d2992222] text-[#d29922]"
                            : "bg-[#3fb95022] text-[#3fb950]"
                        }`}
                      >
                        Risk: {itemAnalysis.riskLevel}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#e6edf3] leading-relaxed">{itemAnalysis.summary}</p>
                </div>
              )}

              {/* PR-specific info */}
              {isPR && pr && (
                <div className="flex-1 min-w-[280px]">
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <div className="bg-[#161b22] rounded p-2">
                      <span className="text-[#8b949e]">Branch:</span>{" "}
                      <span className="text-[#e6edf3] font-mono">{pr.headRefName}</span>
                    </div>
                    <div className="bg-[#161b22] rounded p-2">
                      <span className="text-[#8b949e]">Base:</span>{" "}
                      <span className="text-[#e6edf3] font-mono">{pr.baseRefName}</span>
                    </div>
                    <div className="bg-[#161b22] rounded p-2">
                      <span className="text-[#8b949e]">Review:</span>{" "}
                      <span className={
                        pr.reviewDecision === "APPROVED" ? "text-[#3fb950]"
                        : pr.reviewDecision === "CHANGES_REQUESTED" ? "text-[#f85149]"
                        : "text-[#d29922]"
                      }>
                        {pr.reviewDecision || "Pending"}
                      </span>
                    </div>
                    <div className="bg-[#161b22] rounded p-2">
                      <span className="text-[#8b949e]">Mergeable:</span>{" "}
                      <span className="text-[#e6edf3]">{pr.mergeable || "Unknown"}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Suggested Experts */}
          {triageAssignment && triageAssignment.assignedDevelopers.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">
                Suggested Experts
              </h3>
              <div className="flex flex-wrap gap-3">
                {triageAssignment.assignedDevelopers.map((dev) => (
                  <div
                    key={dev.name}
                    className="flex-1 min-w-[220px] bg-[#161b22] border border-[#30363d] rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-[#e6edf3]">{dev.name}</span>
                      <span className="text-[10px] text-[#8b949e] font-mono">({dev.score})</span>
                    </div>
                    <p className="text-[11px] text-[#8b949e] mb-1.5">{dev.role}</p>
                    <div className="flex flex-wrap gap-1">
                      {dev.matchedTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[10px] bg-[#388bfd22] text-[#388bfd] rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked items — compact */}
          {linkedPRs && linkedPRs.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">
                {isPR ? "Linked Issues" : "Linked PRs"}
              </h3>
              <div className="flex flex-wrap gap-2">
                {linkedPRs.map((link, i) => {
                  const linked = isPR
                    ? ("issue" in link ? link.issue : null)
                    : ("pr" in link ? link.pr : null);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-xs"
                    >
                      <span className={isPR ? "text-[#3fb950]" : "text-[#58a6ff]"}>
                        #{isPR ? link.issueNumber : link.prNumber}
                      </span>
                      <span className="text-[#e6edf3]">
                        {linked?.title || "Unknown"}
                      </span>
                      <span className="text-[#8b949e]">
                        {Math.round(link.confidence * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Description + Comments side by side — 50/50 split */}
          <div className="grid grid-cols-2 gap-6">
            {/* Description */}
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
                  Description
                </h3>
                {item.body && item.body.length > 300 && (
                  <button
                    onClick={() => setDescCollapsed((c) => !c)}
                    className="text-[10px] text-[#58a6ff] hover:underline"
                  >
                    {descCollapsed ? "Expand" : "Collapse"}
                  </button>
                )}
              </div>
              <div
                className={`bg-[#161b22] border border-[#21262d] rounded-lg p-5 text-sm text-[#e6edf3] whitespace-pre-wrap break-words overflow-y-auto leading-relaxed transition-all ${
                  descCollapsed ? "max-h-[100px]" : "max-h-[600px]"
                }`}
              >
                {item.body || "No description provided."}
              </div>
            </div>

            {/* Comments */}
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                Comments ({item.comments?.length || 0})
              </h3>
              {item.comments && item.comments.length > 0 ? (
                <div className="space-y-3 overflow-y-auto max-h-[600px]">
                  {item.comments.map((comment) => (
                    <div key={comment.id} className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-[#e6edf3]">
                          @{comment.author?.login || "unknown"}
                        </span>
                        <span className="text-xs text-[#484f58]">
                          {timeAgo(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-[#8b949e] whitespace-pre-wrap break-words leading-relaxed">
                        {comment.body}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-5 text-sm text-[#484f58]">
                  No comments yet.
                </div>
              )}
            </div>
          </div>

          {/* Bottom GitHub link */}
          <div className="pt-3 border-t border-[#21262d]">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#58a6ff] hover:underline"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              View on GitHub →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
