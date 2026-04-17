import { useState } from "react";
import type { FilterState, SortField, ViewMode, GitHubIssue } from "../types";

interface Props {
  filters: FilterState;
  allAuthors: string[];
  allLabels: string[];
  totalResults: number;
  hiddenCount: number;
  setSearch: (s: string) => void;
  setViewMode: (v: ViewMode) => void;
  setSortField: (f: SortField) => void;
  toggleSort: () => void;
  setShowDrafts: (v: boolean) => void;
  setShowHidden: (v: boolean) => void;
  toggleAuthor: (a: string) => void;
  toggleLabel: (l: string) => void;
  setDateFrom: (d: string) => void;
  setDateTo: (d: string) => void;
  clearFilters: () => void;
  issues: GitHubIssue[];
  onSelectItem: (item: GitHubIssue & { _kind: "issue" }) => void;
}

export function FilterBar({
  filters,
  allAuthors,
  allLabels,
  totalResults,
  hiddenCount,
  setSearch,
  setViewMode,
  setSortField,
  toggleSort,
  setShowDrafts,
  setShowHidden,
  toggleAuthor,
  toggleLabel,
  setDateFrom,
  setDateTo,
  clearFilters,
  issues,
  onSelectItem,
}: Props) {
  const [showAuthors, setShowAuthors] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [authorSearch, setAuthorSearch] = useState("");
  const [labelSearch, setLabelSearch] = useState("");
  const [rookieLoading, setRookieLoading] = useState(false);
  const [rookieSuggestion, setRookieSuggestion] = useState<{ issue: GitHubIssue; reason: string } | null>(null);
  const [rookieError, setRookieError] = useState<string | null>(null);

  const handleRookieMode = async () => {
    const apiKey = localStorage.getItem("mastra-openai-api-key");
    if (!apiKey) {
      setRookieError("Set your OpenAI API key first (Favorites \u2192 Analyze with AI)");
      setTimeout(() => setRookieError(null), 4000);
      return;
    }
    if (issues.length === 0) {
      setRookieError("No issues available to scan");
      setTimeout(() => setRookieError(null), 3000);
      return;
    }

    setRookieLoading(true);
    setRookieSuggestion(null);
    setRookieError(null);

    try {
      const issueList = issues
        .map((i) => {
          const labels = i.labels.map((l) => l.name).join(", ");
          return `#${i.number}: ${i.title}${labels ? ` [${labels}]` : ""}`;
        })
        .join("\n");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You help new contributors find good first issues in open-source projects. Given a list of open issues, pick the ONE issue that looks easiest and most practical for someone with limited context about the codebase. Prefer documentation fixes, typos, small enhancements, or issues labeled 'good first issue'. Avoid complex features, large refactors, or security-sensitive work. Respond with JSON: { \"issueNumber\": <number>, \"reason\": \"<1-2 sentence explanation>\" }",
            },
            {
              role: "user",
              content: `Here are the open issues:\n${issueList}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No response from AI");

      const parsed = JSON.parse(content);
      const matchedIssue = issues.find((i) => i.number === parsed.issueNumber);
      if (matchedIssue) {
        setRookieSuggestion({ issue: matchedIssue, reason: parsed.reason });
      } else {
        throw new Error("AI suggested an issue that wasn't found");
      }
    } catch (err) {
      setRookieError(err instanceof Error ? err.message : "Failed to get suggestion");
      setTimeout(() => setRookieError(null), 5000);
    } finally {
      setRookieLoading(false);
    }
  };

  const viewModes: { value: ViewMode; label: string }[] = [
    { value: "all", label: "All" },
    { value: "issues", label: "Issues" },
    { value: "prs", label: "PRs" },
  ];

  const sortOptions: { value: SortField; label: string }[] = [
    { value: "updated", label: "Updated" },
    { value: "created", label: "Created" },
    { value: "comments", label: "Comments" },
    { value: "reactions", label: "Reactions" },
    { value: "staleness", label: "Staleness" },
  ];

  const filteredAuthors = allAuthors.filter((a) =>
    a.toLowerCase().includes(authorSearch.toLowerCase())
  );
  const filteredLabels = allLabels.filter((l) =>
    l.toLowerCase().includes(labelSearch.toLowerCase())
  );

  const hasActiveFilters =
    filters.search ||
    filters.authors.length > 0 ||
    filters.labels.length > 0 ||
    filters.dateFrom ||
    filters.dateTo ||
    !filters.showDrafts;

  return (
    <div className="border-b border-[#30363d] bg-[#0d1117] px-6 py-3 space-y-3">
      {/* Row 1: Search + View Mode + Sort */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search issues & PRs..."
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-[#e6edf3] placeholder-[#484f58] focus:border-[#58a6ff] focus:outline-none"
          />
        </div>

        <div className="relative">
          <button
            onClick={handleRookieMode}
            disabled={rookieLoading}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded-md transition-colors ${
              rookieSuggestion
                ? "border-[#3fb950] text-[#3fb950] bg-[#3fb95011]"
                : "border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#58a6ff]"
            } disabled:opacity-50`}
            title="AI suggests the easiest issue for a new contributor"
          >
            {rookieLoading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
            Rookie Mode
          </button>

          {/* Rookie Mode result popup */}
          {rookieSuggestion && (
            <div className="absolute z-50 mt-1 w-80 bg-[#161b22] border border-[#3fb95044] rounded-lg shadow-lg p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-semibold text-[#3fb950] uppercase tracking-wider">Suggested First Issue</span>
                <button
                  onClick={() => setRookieSuggestion(null)}
                  className="text-[#484f58] hover:text-white text-sm leading-none"
                >
                  x
                </button>
              </div>
              <div className="mb-2">
                <span className="text-xs text-[#484f58]">#{rookieSuggestion.issue.number}</span>
                <p className="text-sm font-medium text-[#e6edf3] mt-0.5">{rookieSuggestion.issue.title}</p>
              </div>
              <p className="text-xs text-[#8b949e] mb-3 leading-relaxed">{rookieSuggestion.reason}</p>
              <button
                onClick={() => {
                  onSelectItem({ ...rookieSuggestion.issue, _kind: "issue" });
                  setRookieSuggestion(null);
                }}
                className="w-full text-center px-3 py-1.5 text-xs font-medium bg-[#238636] text-white rounded-md hover:bg-[#2ea043] transition-colors"
              >
                View Issue
              </button>
            </div>
          )}

          {/* Error/info popup */}
          {rookieError && (
            <div className="absolute z-50 mt-1 w-72 bg-[#161b22] border border-[#f8514944] rounded-lg shadow-lg p-3">
              <p className="text-xs text-[#f85149]">{rookieError}</p>
            </div>
          )}
        </div>

        <div className="flex items-center border border-[#30363d] rounded-md overflow-hidden">
          {viewModes.map((vm) => (
            <button
              key={vm.value}
              onClick={() => setViewMode(vm.value)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                filters.viewMode === vm.value
                  ? "bg-[#21262d] text-white"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              {vm.label}
            </button>
          ))}
        </div>

        <select
          value={filters.sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          className="bg-[#21262d] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-[#e6edf3] focus:outline-none"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Sort: {opt.label}
            </option>
          ))}
        </select>

        <button
          onClick={toggleSort}
          className="px-2 py-1.5 border border-[#30363d] rounded-md text-sm text-[#8b949e] hover:text-white transition-colors"
          title={filters.sortDirection === "desc" ? "Descending" : "Ascending"}
        >
          {filters.sortDirection === "desc" ? "↓" : "↑"}
        </button>

        <span className="text-sm text-[#8b949e]">{totalResults} results</span>
      </div>

      {/* Row 2: Filter pills + dropdowns */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Author dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowAuthors(!showAuthors); setShowLabels(false); }}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${
              filters.authors.length > 0
                ? "border-[#58a6ff] text-[#58a6ff] bg-[#58a6ff11]"
                : "border-[#30363d] text-[#8b949e] hover:text-white"
            }`}
          >
            Authors{filters.authors.length > 0 ? ` (${filters.authors.length})` : ""}
          </button>
          {showAuthors && (
            <div className="absolute z-50 mt-1 w-64 bg-[#161b22] border border-[#30363d] rounded-md shadow-lg max-h-64 overflow-y-auto">
              <div className="p-2">
                <input
                  type="text"
                  placeholder="Filter authors..."
                  value={authorSearch}
                  onChange={(e) => setAuthorSearch(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none"
                  autoFocus
                />
              </div>
              {filteredAuthors.slice(0, 30).map((a) => (
                <button
                  key={a}
                  onClick={() => toggleAuthor(a)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#21262d] ${
                    filters.authors.includes(a) ? "text-[#58a6ff]" : "text-[#e6edf3]"
                  }`}
                >
                  {filters.authors.includes(a) ? "✓ " : "  "}
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Label dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowLabels(!showLabels); setShowAuthors(false); }}
            className={`px-3 py-1 text-xs border rounded-full transition-colors ${
              filters.labels.length > 0
                ? "border-[#58a6ff] text-[#58a6ff] bg-[#58a6ff11]"
                : "border-[#30363d] text-[#8b949e] hover:text-white"
            }`}
          >
            Labels{filters.labels.length > 0 ? ` (${filters.labels.length})` : ""}
          </button>
          {showLabels && (
            <div className="absolute z-50 mt-1 w-72 bg-[#161b22] border border-[#30363d] rounded-md shadow-lg max-h-64 overflow-y-auto">
              <div className="p-2">
                <input
                  type="text"
                  placeholder="Filter labels..."
                  value={labelSearch}
                  onChange={(e) => setLabelSearch(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none"
                  autoFocus
                />
              </div>
              {filteredLabels.slice(0, 30).map((l) => (
                <button
                  key={l}
                  onClick={() => toggleLabel(l)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#21262d] ${
                    filters.labels.includes(l) ? "text-[#58a6ff]" : "text-[#e6edf3]"
                  }`}
                >
                  {filters.labels.includes(l) ? "✓ " : "  "}
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date range */}
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="bg-[#0d1117] border border-[#30363d] rounded-md px-2 py-1 text-xs text-[#8b949e] focus:outline-none"
          placeholder="From"
        />
        <span className="text-xs text-[#484f58]">to</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="bg-[#0d1117] border border-[#30363d] rounded-md px-2 py-1 text-xs text-[#8b949e] focus:outline-none"
          placeholder="To"
        />

        {/* Draft toggle */}
        <label className="flex items-center gap-1 text-xs text-[#8b949e] cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showDrafts}
            onChange={(e) => setShowDrafts(e.target.checked)}
            className="accent-[#58a6ff]"
          />
          Drafts
        </label>

        {/* Hidden toggle */}
        <label className="flex items-center gap-1 text-xs text-[#8b949e] cursor-pointer" title="Show items you've hidden until the next sync">
          <input
            type="checkbox"
            checked={filters.showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="accent-[#d29922]"
          />
          Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
        </label>

        {/* Clear */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-1 text-xs text-[#f85149] border border-[#f8514933] rounded-full hover:bg-[#f8514911] transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Active filter pills */}
      {(filters.authors.length > 0 || filters.labels.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {filters.authors.map((a) => (
            <span
              key={a}
              onClick={() => toggleAuthor(a)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-[#58a6ff22] text-[#58a6ff] rounded-full cursor-pointer hover:bg-[#58a6ff33]"
            >
              @{a} ×
            </span>
          ))}
          {filters.labels.map((l) => (
            <span
              key={l}
              onClick={() => toggleLabel(l)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-[#3fb95022] text-[#3fb950] rounded-full cursor-pointer hover:bg-[#3fb95033]"
            >
              {l} ×
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
