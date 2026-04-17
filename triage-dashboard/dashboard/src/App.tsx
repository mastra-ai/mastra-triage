import { useState, useEffect, useCallback, useRef } from "react";
import type { GitHubIssue, GitHubPullRequest } from "./types";
import { useTriageData } from "./hooks/useTriageData";
import { useFilters } from "./hooks/useFilters";
import { getAllAuthors, getAllLabels } from "./utils";
import { StatsBar } from "./components/StatsBar";
import { FilterBar } from "./components/FilterBar";
import { ItemRow } from "./components/ItemRow";
import { DetailPanel } from "./components/DetailPanel";
import { FavoritesBar } from "./components/FavoritesBar";
import { FavoritesPanel } from "./components/FavoritesPanel";
import { AIChatPanel } from "./components/AIChatPanel";
import type { FavoriteItem } from "./context/FavoritesContext";

function App() {
  const { issues, pullRequests, metadata, analysis, triage, loading, error, setHidden } = useTriageData();
  const {
    filters,
    filtered,
    setSearch,
    setViewMode,
    setSortField,
    toggleSort,
    setShowDrafts,
    setShowHidden,
    setDateFrom,
    setDateTo,
    toggleAuthor,
    toggleLabel,
    clearFilters,
  } = useFilters(issues, pullRequests);

  const hiddenCount =
    issues.filter((i) => i.hidden).length + pullRequests.filter((p) => p.hidden).length;

  const handleToggleHidden = (kind: "issue" | "pr", number: number, hidden: boolean) => {
    setHidden(kind, number, hidden);
    setSelectedItem((prev) =>
      prev && prev._kind === kind && prev.number === number
        ? ({ ...prev, hidden: hidden || undefined } as typeof prev)
        : prev
    );
  };

  const [selectedItem, setSelectedItem] = useState<
    ((GitHubIssue | GitHubPullRequest) & { _kind: "issue" | "pr" }) | null
  >(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const allAuthors = getAllAuthors(issues, pullRequests);
  const allLabels = getAllLabels(issues, pullRequests);

  // Deep linking: read hash on mount to restore selected item
  useEffect(() => {
    const hash = window.location.hash.slice(1); // e.g. "issue-42" or "pr-15"
    if (!hash) return;
    const match = hash.match(/^(issue|pr)-(\d+)$/);
    if (!match) return;
    const [, kind, numStr] = match;
    const num = parseInt(numStr, 10);
    const allItems = [
      ...issues.map((i) => ({ ...i, _kind: "issue" as const })),
      ...pullRequests.map((p) => ({ ...p, _kind: "pr" as const })),
    ];
    const found = allItems.find((item) => item._kind === kind && item.number === num);
    if (found) setSelectedItem(found);
  }, [issues, pullRequests]);

  // Deep linking: update hash when selection changes
  useEffect(() => {
    if (selectedItem) {
      window.location.hash = `${selectedItem._kind}-${selectedItem.number}`;
    } else {
      // Clear hash without scrolling
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [selectedItem]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "Escape":
          if (selectedItem) { setSelectedItem(null); e.preventDefault(); }
          else if (showFavorites) { setShowFavorites(false); e.preventDefault(); }
          else if (showAIChat) { setShowAIChat(false); e.preventDefault(); }
          break;
        case "j":
        case "ArrowDown":
          if (!selectedItem && filtered.length > 0) {
            e.preventDefault();
            setFocusedIndex((prev) => {
              const next = Math.min(prev + 1, filtered.length - 1);
              // Scroll the focused row into view
              const rows = listRef.current?.children;
              if (rows?.[next]) (rows[next] as HTMLElement).scrollIntoView({ block: "nearest" });
              return next;
            });
          }
          break;
        case "k":
        case "ArrowUp":
          if (!selectedItem && filtered.length > 0) {
            e.preventDefault();
            setFocusedIndex((prev) => {
              const next = Math.max(prev - 1, 0);
              const rows = listRef.current?.children;
              if (rows?.[next]) (rows[next] as HTMLElement).scrollIntoView({ block: "nearest" });
              return next;
            });
          }
          break;
        case "Enter":
          if (!selectedItem && focusedIndex >= 0 && focusedIndex < filtered.length) {
            e.preventDefault();
            setSelectedItem(filtered[focusedIndex]);
          }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedItem, showFavorites, showAIChat, filtered, focusedIndex]);

  // Reset focus when filter results change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [filtered]);

  const handleSelectFromFavorites = (item: FavoriteItem) => {
    setSelectedItem(item);
    setShowFavorites(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl text-[#58a6ff] mb-2">Loading...</div>
          <div className="text-sm text-[#8b949e]">Fetching triage data</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-2xl text-[#f85149] mb-2">Error</div>
          <div className="text-sm text-[#8b949e] mb-4">{error}</div>
          <pre className="text-xs text-[#8b949e] bg-[#161b22] rounded p-4 text-left">
            npm run fetch    # Pull GitHub data{"\n"}
            npm run analyze  # Run AI analysis{"\n"}
            npm run dashboard # Start dashboard
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <StatsBar issues={issues} prs={pullRequests} metadata={metadata} />
      <FilterBar
        filters={filters}
        allAuthors={allAuthors}
        allLabels={allLabels}
        totalResults={filtered.length}
        hiddenCount={hiddenCount}
        setSearch={setSearch}
        setViewMode={setViewMode}
        setSortField={setSortField}
        toggleSort={toggleSort}
        setShowDrafts={setShowDrafts}
        setShowHidden={setShowHidden}
        toggleAuthor={toggleAuthor}
        toggleLabel={toggleLabel}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        clearFilters={clearFilters}
        issues={issues}
        onSelectItem={(item) => setSelectedItem(item)}
      />

      {/* Item list */}
      <div className="flex-1 overflow-y-auto" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[#8b949e]">
            No items match your filters
          </div>
        ) : (
          filtered.map((item, idx) => (
            <ItemRow
              key={`${item._kind}-${item.number}`}
              item={item}
              onClick={() => setSelectedItem(item)}
              searchQuery={filters.search}
              isFocused={idx === focusedIndex}
              triage={triage}
              onToggleHidden={handleToggleHidden}
            />
          ))
        )}
      </div>

      {/* Favorites floating bar */}
      <FavoritesBar onOpen={() => setShowFavorites(true)} />

      {/* Detail panel */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          analysis={analysis}
          triage={triage}
          allIssues={issues}
          allPRs={pullRequests}
          onClose={() => setSelectedItem(null)}
          onToggleHidden={setHidden}
        />
      )}

      {/* Favorites panel */}
      {showFavorites && (
        <FavoritesPanel
          onClose={() => setShowFavorites(false)}
          onOpenChat={() => {
            setShowFavorites(false);
            setShowAIChat(true);
          }}
          onSelectItem={handleSelectFromFavorites}
        />
      )}

      {/* AI Chat panel */}
      {showAIChat && (
        <AIChatPanel onClose={() => setShowAIChat(false)} />
      )}
    </div>
  );
}

export default App;
