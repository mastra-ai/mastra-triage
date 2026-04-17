import { useState } from "react";
import { useFavorites, type FavoriteItem } from "../context/FavoritesContext";
import type { GitHubPullRequest } from "../types";
import { timeAgo, computeStaleness, labelColor } from "../utils";

interface Props {
  onClose: () => void;
  onOpenChat: () => void;
  onSelectItem: (item: FavoriteItem) => void;
}

function FavoriteRow({
  item,
  onRemove,
  onSelect,
}: {
  item: FavoriteItem;
  onRemove: () => void;
  onSelect: () => void;
}) {
  const isPR = item._kind === "pr";
  const pr = isPR ? (item as GitHubPullRequest) : null;
  const staleness = computeStaleness(item);

  return (
    <div className="flex items-start gap-3 p-4 bg-[#0d1117] border border-[#21262d] rounded-lg hover:border-[#30363d] transition-colors group">
      <div className="flex-shrink-0 mt-0.5">
        {isPR ? (
          <span
            className={`text-base ${
              pr?.isDraft ? "text-[#8b949e]" : pr?.reviewDecision === "APPROVED" ? "text-[#3fb950]" : "text-[#58a6ff]"
            }`}
          >
            ↗
          </span>
        ) : (
          <span className="text-base text-[#3fb950]">●</span>
        )}
      </div>

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[#e6edf3] group-hover:text-[#58a6ff] transition-colors">
            {item.title}
          </span>
          <span className="text-xs text-[#484f58]">#{item.number}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-[#8b949e]">
          <span>@{item.author.login}</span>
          <span>updated {timeAgo(item.updatedAt)}</span>
          <span>staleness: {staleness}/100</span>
        </div>
        {item.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.labels.slice(0, 5).map((label) => {
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
            {item.labels.length > 5 && (
              <span className="text-[10px] text-[#484f58]">+{item.labels.length - 5} more</span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onRemove}
        className="flex-shrink-0 text-[#484f58] hover:text-[#f85149] transition-colors p-1"
        title="Remove from favorites"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export function FavoritesPanel({ onClose, onOpenChat, onSelectItem }: Props) {
  const { favorites, removeFavorite, clearFavorites } = useFavorites();

  const issueCount = favorites.filter((f) => f._kind === "issue").length;
  const prCount = favorites.filter((f) => f._kind === "pr").length;

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const showCopyFeedback = (msg: string) => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(null), 1500);
  };

  const exportMarkdown = () => {
    const lines = favorites.map((f) => {
      const kind = f._kind === "pr" ? "PR" : "Issue";
      return `- [${kind} #${f.number}](${f.url}) ${f.title} (by @${f.author.login})`;
    });
    const text = `## Favorites from Mastra OSS Triage\n\n${lines.join("\n")}`;
    navigator.clipboard.writeText(text);
    showCopyFeedback("Markdown copied!");
  };

  const exportUrls = () => {
    const text = favorites.map((f) => f.url).join("\n");
    navigator.clipboard.writeText(text);
    showCopyFeedback("URLs copied!");
  };

  const exportStandup = () => {
    const issues = favorites.filter((f) => f._kind === "issue");
    const prs = favorites.filter((f) => f._kind === "pr");
    const lines: string[] = [];
    if (issues.length > 0) {
      lines.push("**Issues:**");
      issues.forEach((f) => lines.push(`- [ ] #${f.number} ${f.title}`));
    }
    if (prs.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("**PRs:**");
      prs.forEach((f) => lines.push(`- [ ] #${f.number} ${f.title}`));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    showCopyFeedback("Standup checklist copied!");
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-[720px] max-w-full bg-[#0d1117] border-l border-[#30363d] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#58a6ff" stroke="none">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
            <div>
              <h2 className="text-lg font-semibold text-white">Favorites</h2>
              <p className="text-xs text-[#8b949e]">
                {favorites.length} item{favorites.length !== 1 ? "s" : ""}
                {issueCount > 0 && ` · ${issueCount} issue${issueCount !== 1 ? "s" : ""}`}
                {prCount > 0 && ` · ${prCount} PR${prCount !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white text-xl leading-none">
            ×
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-[#21262d] flex-wrap">
          <button
            onClick={onOpenChat}
            disabled={favorites.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#238636] text-white rounded-md hover:bg-[#2ea043] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Analyze with AI
          </button>
          <button
            onClick={exportMarkdown}
            disabled={favorites.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-xs text-[#e6edf3] border border-[#30363d] rounded-md hover:bg-[#21262d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Markdown
          </button>
          <button
            onClick={exportUrls}
            disabled={favorites.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-xs text-[#e6edf3] border border-[#30363d] rounded-md hover:bg-[#21262d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            URLs
          </button>
          <button
            onClick={exportStandup}
            disabled={favorites.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-xs text-[#e6edf3] border border-[#30363d] rounded-md hover:bg-[#21262d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Standup
          </button>
          {copyFeedback && (
            <span className="text-xs text-[#3fb950] animate-pulse">{copyFeedback}</span>
          )}
          <div className="flex-1" />
          {favorites.length > 0 && (
            <button
              onClick={clearFavorites}
              className="text-xs text-[#f85149] hover:text-[#ff7b72] transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {favorites.length === 0 ? (
            <div className="text-center py-16">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1" className="mx-auto mb-4">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
              <p className="text-[#8b949e] text-sm">No favorites yet</p>
              <p className="text-[#484f58] text-xs mt-1">
                Click the checkbox on any issue or PR to add it here
              </p>
            </div>
          ) : (
            favorites.map((item) => (
              <FavoriteRow
                key={`${item._kind}-${item.number}`}
                item={item}
                onRemove={() => removeFavorite(item._kind, item.number)}
                onSelect={() => onSelectItem(item)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
