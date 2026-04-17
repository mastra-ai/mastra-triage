import type { GitHubIssue, GitHubPullRequest, TriageResult } from "../types";
import { timeAgo, computeStaleness, getCommentCount, getReactionCount, labelColor, truncate, highlightText } from "../utils";
import { useFavorites } from "../context/FavoritesContext";

interface Props {
  item: (GitHubIssue | GitHubPullRequest) & { _kind: "issue" | "pr" };
  onClick: () => void;
  searchQuery?: string;
  isFocused?: boolean;
  triage?: TriageResult | null;
  onToggleHidden: (kind: "issue" | "pr", number: number, hidden: boolean) => void;
}

function StalenessIndicator({ score }: { score: number }) {
  let color = "bg-green-500";
  if (score > 75) color = "bg-red-500";
  else if (score > 50) color = "bg-orange-400";
  else if (score > 25) color = "bg-yellow-400";

  return (
    <div className="flex items-center gap-1.5" title={`Staleness: ${score}/100`}>
      <div className="w-12 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-[#8b949e] w-6">{score}</span>
    </div>
  );
}

export function ItemRow({ item, onClick, searchQuery, isFocused, triage, onToggleHidden }: Props) {
  const isPR = item._kind === "pr";
  const pr = isPR ? (item as GitHubPullRequest) : null;
  const staleness = computeStaleness(item);
  const comments = getCommentCount(item);
  const reactions = getReactionCount(item);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(item._kind, item.number);
  const triageAssignment = triage?.assignments.find(
    (a) => a.itemNumber === item.number && a.itemType === item._kind
  );
  const topDev = triageAssignment?.assignedDevelopers[0];

  const isHidden = !!item.hidden;

  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 px-6 py-3 border-b border-[#21262d] hover:bg-[#161b22] cursor-pointer transition-colors group ${
        isFocused ? "bg-[#161b22] ring-1 ring-inset ring-[#58a6ff44]" : ""
      } ${isHidden ? "opacity-50" : ""}`}
    >
      {/* Favorite checkbox */}
      <div className="mt-1 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }}
          className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
            favorited
              ? "bg-[#58a6ff] border-[#58a6ff] text-white"
              : "border-[#30363d] text-transparent hover:border-[#58a6ff] hover:text-[#58a6ff33] group-hover:border-[#484f58]"
          }`}
          title={favorited ? "Remove from favorites" : "Add to favorites"}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="2,6 5,9 10,3" />
          </svg>
        </button>
      </div>

      {/* Hide toggle */}
      <div className="mt-1 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleHidden(item._kind, item.number, !isHidden); }}
          className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
            isHidden
              ? "border-[#d29922] text-[#d29922] bg-[#d2992222]"
              : "border-[#30363d] text-transparent hover:border-[#d29922] hover:text-[#d29922] group-hover:border-[#484f58] group-hover:text-[#484f58]"
          }`}
          title={isHidden ? "Unhide" : "Hide until next sync"}
        >
          {isHidden ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 1l22 22" />
              <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {/* Type icon */}
      <div className="mt-1 flex-shrink-0">
        {isPR ? (
          <span
            className={`text-lg ${
              pr?.isDraft
                ? "text-[#8b949e]"
                : pr?.reviewDecision === "APPROVED"
                ? "text-[#3fb950]"
                : pr?.reviewDecision === "CHANGES_REQUESTED"
                ? "text-[#f85149]"
                : "text-[#58a6ff]"
            }`}
            title={pr?.isDraft ? "Draft" : pr?.reviewDecision || "Open"}
          >
            ↗
          </span>
        ) : (
          <span className="text-lg text-[#3fb950]" title="Issue">●</span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#e6edf3] group-hover:text-[#58a6ff] transition-colors">
            {searchQuery ? highlightText(item.title, searchQuery) : item.title}
          </span>
          <span className="text-xs text-[#484f58]">#{item.number}</span>
          {pr?.isDraft && (
            <span className="px-1.5 py-0.5 text-[10px] border border-[#30363d] text-[#8b949e] rounded-full">
              Draft
            </span>
          )}
        </div>

        {/* Labels */}
        {item.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.labels.map((label) => {
              const colors = labelColor(label.color);
              return (
                <span
                  key={label.id}
                  className="px-1.5 py-0.5 text-[10px] rounded-full font-medium"
                  style={{ backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.text}33` }}
                >
                  {label.name}
                </span>
              );
            })}
          </div>
        )}

        {/* Meta line */}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8b949e]">
          <span>@{item.author.login}</span>
          <span title={`Created ${item.createdAt}`}>opened {timeAgo(item.createdAt)}</span>
          <span title={`Updated ${item.updatedAt}`}>updated {timeAgo(item.updatedAt)}</span>
          {comments > 0 && <span>💬 {comments}</span>}
          {reactions > 0 && <span>👍 {reactions}</span>}
          {isPR && pr && (
            <span className="text-[#3fb950]">
              +{pr.additions} -{pr.deletions}
            </span>
          )}
          {item.assignees.length > 0 && (
            <span>→ {item.assignees.map((a) => a.login).join(", ")}</span>
          )}
          {topDev && (
            <span className="text-[#388bfd]" title={`Suggested: ${topDev.name} (${topDev.role})`}>
              ◆ {topDev.name}
            </span>
          )}
        </div>

        {/* Body preview */}
        {item.body && (
          <p className="mt-1 text-xs text-[#484f58] leading-relaxed">
            {truncate(item.body.replace(/\r?\n/g, " ").replace(/#{1,6}\s/g, ""), 200)}
          </p>
        )}
      </div>

      {/* Right column: staleness */}
      <div className="flex-shrink-0 mt-1">
        <StalenessIndicator score={staleness} />
      </div>
    </div>
  );
}
