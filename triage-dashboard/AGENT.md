# Mastra OSS Triage

A tool for triaging open issues and pull requests on the [mastra-ai/mastra](https://github.com/mastra-ai/mastra) GitHub repository. It fetches all open issues and PRs, runs AI-powered analysis on them, and provides a visual dashboard for filtering, sorting, and understanding the state of the backlog.

## How it works

There are three stages, each runnable independently:

### 1. Fetch (`npm run fetch`)

`src/fetch.ts` uses the GitHub CLI (`gh`) to pull down all open issues and PRs from `mastra-ai/mastra`. Issues are fetched in a single bulk call with full metadata and comments. PRs are fetched in two passes: a bulk call for lightweight metadata (titles, labels, authors, dates, review decisions), then individual `gh pr view` calls to enrich each PR with comments, reviews, and reaction data. The bulk PR fetch skips comments/reviews/files because the GitHub GraphQL API returns 502s when those heavy fields are requested across hundreds of PRs at once.

Output goes to `data/`:
- `data/issues.json` — all open issues with comments, labels, reactions, assignees, milestones
- `data/pull-requests.json` — all open PRs with comments, reviews, labels, branch info, diff stats
- `data/metadata.json` — fetch timestamp and counts

### 2. Analyze (`npm run analyze`)

`src/analyze.ts` reads the fetched JSON and sends it through OpenAI (`gpt-4o-mini`) in batches to produce:

- **Issue analysis** — category (bug, feature-request, enhancement, etc.), priority (critical/high/medium/low), staleness score, summary, suggested labels, related issues
- **PR analysis** — summary, staleness score, review status assessment, risk level
- **PR-to-issue linking** — matches PRs to the issues they likely address, using title/body/branch name similarity and explicit references like "fixes #123"
- **Duplicate detection** — groups issues that describe the same problem

Each analysis type is a separate OpenAI call with a structured JSON response format. Issues are batched in groups of 20, PRs in groups of 15, to stay within token limits. The linking and duplicate passes operate on compact indexes of the full dataset.

Output: `data/analysis.json`

Requires `OPENAI_API_KEY` set in `.env` or environment.

### 3. Dashboard (`npm run dashboard`)

A Vite + React + Tailwind SPA in `dashboard/` that loads the JSON files from `data/` and renders them as an interactive triage view. The data directory is symlinked into `dashboard/public/data` so Vite serves it as static files.

Features:
- Stats bar showing open counts, stale counts, average ages, unreviewed PRs
- Filter by search text, author, label, date range, view mode (issues/PRs/all), draft toggle
- Sort by updated date, created date, comment count, reaction count, or staleness score
- Each row shows title, labels, author, timestamps, staleness bar, diff stats (for PRs)
- Click a row to open a detail panel with full description, comments, PR review info, AI analysis (if available), and linked issues/PRs
- Staleness is computed client-side on a 0-100 logarithmic scale based on last meaningful activity (comments, reviews, updates)

## NPM package

The root package (`src/index.ts`) exports typed accessors for the data files:

```ts
import { getIssues, getPullRequests, getAnalysis, getTriageData } from "mastra-oss-triage";
```

All TypeScript types are also exported from `src/types.ts`.

## Project layout

```
src/
  types.ts       — shared TypeScript types (GitHub primitives, analysis results)
  fetch.ts       — GitHub data fetch script (gh CLI)
  analyze.ts     — AI analysis script (OpenAI)
  index.ts       — NPM package entry point
data/            — generated JSON (gitignored)
dashboard/
  src/
    App.tsx              — main app shell, wires up data + filters + detail panel
    types.ts             — dashboard-local type mirrors
    utils.ts             — staleness scoring, date formatting, label colors
    hooks/
      useTriageData.ts   — loads JSON from /data/ via fetch()
      useFilters.ts      — filter/sort state machine
    components/
      StatsBar.tsx       — top-level metrics
      FilterBar.tsx      — search, author/label dropdowns, sort, date range
      ItemRow.tsx         — single issue/PR row with staleness indicator
      DetailPanel.tsx    — slide-out panel with full item details + AI analysis
```

## Prerequisites

- Node.js
- GitHub CLI (`gh`) authenticated with access to `mastra-ai/mastra`
- `OPENAI_API_KEY` in `.env` (only needed for the analyze step)
