import { useState, useMemo, useEffect } from "react";
import type {
  GitHubIssue,
  GitHubPullRequest,
  FilterState,
  SortField,
  SortDirection,
  ViewMode,
} from "../types";
import { computeStaleness, getCommentCount, getReactionCount } from "../utils";

const FILTER_STORAGE_KEY = "mastra-triage-filters";

function loadSavedFilters(): Partial<FilterState> {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

const saved = loadSavedFilters();

const DEFAULT_FILTERS: FilterState = {
  search: "",
  authors: saved.authors ?? [],
  labels: saved.labels ?? [],
  viewMode: saved.viewMode ?? "all",
  sortField: saved.sortField ?? "updated",
  sortDirection: saved.sortDirection ?? "desc",
  showDrafts: saved.showDrafts ?? true,
  showHidden: saved.showHidden ?? false,
  dateFrom: "",
  dateTo: "",
};

type UnifiedItem = (GitHubIssue | GitHubPullRequest) & { _kind: "issue" | "pr" };

function tagItems(issues: GitHubIssue[], prs: GitHubPullRequest[]): UnifiedItem[] {
  return [
    ...issues.map((i) => ({ ...i, _kind: "issue" as const })),
    ...prs.map((p) => ({ ...p, _kind: "pr" as const })),
  ];
}

function matchesFilter(item: UnifiedItem, filters: FilterState): boolean {
  // Search
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const matchTitle = item.title.toLowerCase().includes(q);
    const matchBody = item.body?.toLowerCase().includes(q);
    const matchNumber = `#${item.number}`.includes(q) || `${item.number}`.includes(q);
    const matchAuthor = item.author.login.toLowerCase().includes(q);
    if (!matchTitle && !matchBody && !matchNumber && !matchAuthor) return false;
  }

  // View mode
  if (filters.viewMode === "issues" && item._kind !== "issue") return false;
  if (filters.viewMode === "prs" && item._kind !== "pr") return false;

  // Authors
  if (filters.authors.length > 0 && !filters.authors.includes(item.author.login)) return false;

  // Labels
  if (filters.labels.length > 0) {
    const itemLabels = item.labels.map((l) => l.name);
    if (!filters.labels.some((fl) => itemLabels.includes(fl))) return false;
  }

  // Drafts
  if (!filters.showDrafts && item._kind === "pr" && (item as GitHubPullRequest).isDraft) {
    return false;
  }

  // Hidden
  if (!filters.showHidden && item.hidden) return false;

  // Date range
  if (filters.dateFrom) {
    if (new Date(item.createdAt) < new Date(filters.dateFrom)) return false;
  }
  if (filters.dateTo) {
    if (new Date(item.createdAt) > new Date(filters.dateTo)) return false;
  }

  return true;
}

function sortItems(items: UnifiedItem[], field: SortField, dir: SortDirection): UnifiedItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "created":
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "updated":
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case "comments":
        cmp = getCommentCount(a) - getCommentCount(b);
        break;
      case "reactions":
        cmp = getReactionCount(a) - getReactionCount(b);
        break;
      case "staleness":
        cmp = computeStaleness(a) - computeStaleness(b);
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function useFilters(issues: GitHubIssue[], prs: GitHubPullRequest[]) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // Persist filter preferences to localStorage
  useEffect(() => {
    localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({
        sortField: filters.sortField,
        sortDirection: filters.sortDirection,
        viewMode: filters.viewMode,
        showDrafts: filters.showDrafts,
        showHidden: filters.showHidden,
        authors: filters.authors,
        labels: filters.labels,
      })
    );
  }, [filters.sortField, filters.sortDirection, filters.viewMode, filters.showDrafts, filters.showHidden, filters.authors, filters.labels]);

  const filtered = useMemo(() => {
    const all = tagItems(issues, prs);
    const matching = all.filter((item) => matchesFilter(item, filters));
    return sortItems(matching, filters.sortField, filters.sortDirection);
  }, [issues, prs, filters]);

  const setSearch = (search: string) => setFilters((f) => ({ ...f, search }));
  const setViewMode = (viewMode: ViewMode) => setFilters((f) => ({ ...f, viewMode }));
  const setSortField = (sortField: SortField) => setFilters((f) => ({ ...f, sortField }));
  const setSortDirection = (sortDirection: SortDirection) => setFilters((f) => ({ ...f, sortDirection }));
  const toggleSort = () => setFilters((f) => ({ ...f, sortDirection: f.sortDirection === "asc" ? "desc" : "asc" }));
  const setShowDrafts = (showDrafts: boolean) => setFilters((f) => ({ ...f, showDrafts }));
  const setShowHidden = (showHidden: boolean) => setFilters((f) => ({ ...f, showHidden }));
  const setDateFrom = (dateFrom: string) => setFilters((f) => ({ ...f, dateFrom }));
  const setDateTo = (dateTo: string) => setFilters((f) => ({ ...f, dateTo }));

  const toggleAuthor = (author: string) =>
    setFilters((f) => ({
      ...f,
      authors: f.authors.includes(author)
        ? f.authors.filter((a) => a !== author)
        : [...f.authors, author],
    }));

  const toggleLabel = (label: string) =>
    setFilters((f) => ({
      ...f,
      labels: f.labels.includes(label)
        ? f.labels.filter((l) => l !== label)
        : [...f.labels, label],
    }));

  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  return {
    filters,
    filtered,
    setSearch,
    setViewMode,
    setSortField,
    setSortDirection,
    toggleSort,
    setShowDrafts,
    setShowHidden,
    setDateFrom,
    setDateTo,
    toggleAuthor,
    toggleLabel,
    clearFilters,
  };
}
