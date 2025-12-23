# Triage Nurse

An AI-powered triage assistant for the [Mastra](https://github.com/mastra-ai/mastra) open source framework. This service automates GitHub issue management by classifying, triaging, and syncing issues with Discord conversations.

## Overview

This project runs as a Mastra Cloud deployment and is triggered by GitHub Actions workflows in the main Mastra repository. It uses AI agents to classify issues and assign them to the appropriate engineering squads.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions (mastra-ai/mastra)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  issue-triage.yml          │  Triggered on: issues [opened, reopened]       │
│  cron-discord-triage.yml   │  Triggered on: schedule (cron)                 │
│  cron-discord-github-sync.yml │  Triggered on: schedule (cron)              │
│  cron-github-issues-follow-up.yml │  Triggered on: schedule (cron)          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Mastra Cloud (this project)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Workflows (GitHub Actions triggered):                                      │
│    • triageWorkflow           → Triage new GitHub issues                    │
│    • discordToGithubWorkflow  → Create GitHub issues from Discord threads   │
│    • discordSyncWorkflow      → Sync Discord messages to GitHub issues      │
│    • githubIssueManagerWorkflow → Add follow-up labels to stale issues      │
│                                                                             │
│  Workflows (Manual trigger for reporting):                                  │
│    • forumThreadAnalysisWorkflow → Analyze Discord threads for reporting    │
│    • discordAnalysisWorkflow     → Categorize Discord posts for reporting   │
│                                                                             │
│  Agents:                                                                    │
│    • classificationAgent      → Labels issues by product area               │
│    • effortImpactAgent        → Estimates effort and impact                 │
│    • threadClassifierAgent    → Classifies threads (manual reporting)       │
│    • analysisAgent            → Analyzes categories (manual reporting)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Workflows

### 1. Issue Triage (`triageWorkflow`)

**Trigger:** `issue-triage.yml` — runs when a GitHub issue is opened or reopened

**Flow:**
```
New Issue Created
       │
       ▼
┌──────────────────┐
│ Fetch Issue Data │  ← Get title and body from GitHub API
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Fetch Labels     │  ← Get available labels from GitHub repo
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Classify Area    │  ← AI picks best area labels (e.g., "area: workflows")
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Label Squad      │  ← Derive squad from area (e.g., "trio-tnt")
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Estimate Effort  │  ← AI estimates effort & impact labels
│ & Impact         │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Apply Labels     │  ← Add all labels, post welcome comment
└──────────────────┘
```

**Actions:**
- Adds labels: `status: needs triage`, `[area]`, `[squad]`, `[effort]`, `[impact]`
- Posts a welcome comment with next steps

---

### 2. Discord to GitHub (`discordToGithubWorkflow`)

**Trigger:** `cron-discord-triage.yml` — runs on a cron schedule

**Flow:**
```
Cron Trigger
     │
     ▼
┌─────────────────────┐
│ Fetch Forum Posts   │  ← Get recent threads from Discord help forum
└──────────┬──────────┘
           │
           ▼
     ┌─────┴─────┐
     │  For Each │
     │   Post    │
     └─────┬─────┘
           │
           ▼
┌─────────────────────┐
│ Check Existing Issue│  ← Search GitHub for existing issue with post ID
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │  Branch   │
     └─────┬─────┘
           │
    ┌──────┼──────────────┐
    │      │              │
    ▼      ▼              ▼
[Has     [No Issue &    [No Issue &
Issue]   No skip-github  Has skip-github
         tag]            tag]
  │         │              │
  │         ▼              │
  │   ┌───────────────┐    │
  │   │Fetch Discord  │    │
  │   │Content + Images│   │
  │   └───────┬───────┘    │
  │           │            │
  │           ▼            │
  │   ┌───────────────┐    │
  │   │ Classify Area │ ← AI picks best area labels
  │   └───────┬───────┘    │
  │           │            │
  │           ▼            │
  │   ┌───────────────┐    │
  │   │ Label Squad   │ ← Derive squad from area
  │   └───────┬───────┘    │
  │           │            │
  │           ▼            │
  │   ┌───────────────┐    │
  │   │Estimate Effort│ ← AI estimates effort & impact
  │   │& Impact       │    │
  │   └───────┬───────┘    │
  │           │            │
  │           ▼            │
  │   ┌───────────────┐    │
  │   │Create GitHub  │    │
  │   │Issue          │    │
  │   └───────┬───────┘    │
  │           │            │
  │           ▼            │
  │   ┌───────────────┐    │
  │   │Post Discord   │ ← Reply to thread with issue link
  │   │Message        │    │
  │   └───────────────┘    │
  │                        │
  └────────────────────────┘
```

**Actions:**
- Creates GitHub issues from Discord help forum threads
- Labels issues: `status: needs triage`, `discord`, `[area]`, `[squad]`, `[effort]`, `[impact]`
- Posts a reply to the Discord thread with the GitHub issue link

---

### 3. Discord Sync (`discordSyncWorkflow`)

**Trigger:** `cron-discord-github-sync.yml` — runs on a cron schedule

**Flow:**
```
Cron Trigger
      │
      ▼
┌──────────────────────┐
│ Fetch Issues with    │  ← Get open issues with "discord" label
│ "discord" Label      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Filter by Status     │  ← Only "waiting for author" or "needs reproduction"
└──────────┬───────────┘
           │
           ▼
     ┌─────┴─────┐
     │  For Each │  (concurrency: 10)
     │   Issue   │
     └─────┬─────┘
           │
           ▼
┌──────────────────────┐
│ Extract Discord      │  ← Parse thread ID from issue body
│ Thread ID            │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Fetch Discord        │  ← Get messages after last synced message
│ Messages             │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Update/Create Sync   │  ← Collapsible comment with all Discord messages
│ Comment              │
└──────────────────────┘
```

**Actions:**
- Syncs new Discord messages to GitHub issues as a collapsible comment
- Tracks last synced message to avoid duplicates
- Records whether last author is a Mastra team member

---

### 4. GitHub Issue Manager (`githubIssueManagerWorkflow`)

**Trigger:** `cron-github-issues-follow-up.yml` — runs on a cron schedule

**Flow:**
```
Cron Trigger
      │
      ▼
┌─────────────────────────┐
│ Fetch Issues with       │  ← "waiting for author" or "needs reproduction"
│ Status Labels           │
└──────────┬──────────────┘
           │
           ▼
     ┌─────┴─────┐
     │  For Each │  (concurrency: 10)
     │   Issue   │
     └─────┬─────┘
           │
           ▼
┌─────────────────────────┐
│ Check Last Comment      │  ← Is last commenter a Mastra team member?
│ Author                  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Check Discord Sync      │  ← Is last Discord author a team member?
│ Tracker                 │
└──────────┬──────────────┘
           │
     ┌─────┴─────┐
     │Last author│
     │is NOT team│
     │ member?   │
     └─────┬─────┘
           │
           ▼
┌─────────────────────────┐
│ Add "status: needs      │  ← Flag for team to follow up
│ follow up" Label        │
└─────────────────────────┘
```

**Actions:**
- Monitors issues waiting for author response
- Adds `status: needs follow up` label when user has replied
- Checks both GitHub comments and synced Discord messages

---

## Manual Trigger Workflows (Reporting)

> ⚠️ **DO NOT DELETE** - These workflows are intentionally not triggered by GitHub Actions.

The following workflows are invoked manually by team members (Romain and Abhi) for generating periodic reports on Discord forum activity. They are not "dead code" - they serve an important reporting function.

### 5. Forum Thread Analysis (`forumThreadAnalysisWorkflow`)

**Trigger:** Manual invocation only

**Purpose:** Analyzes Discord help forum threads to identify trends, severity distribution, and key issues across different product categories.

**Flow:**
```
Manual Trigger
      │
      ▼
┌─────────────────────────┐
│ Fetch Forum Threads     │  ← Get threads from Discord help forum
└──────────┬──────────────┘
           │
           ▼
     ┌─────┴─────┐
     │  For Each │  (concurrency: 5)
     │   Thread  │
     └─────┬─────┘
           │
           ▼
┌─────────────────────────┐
│ Fetch All Messages      │  ← Get complete conversation from thread
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Classify Thread         │  ← AI classifies type, category, severity
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Generate Report         │  ← Create markdown table with statistics
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Save to File            │  ← forum-thread-analysis.md
└─────────────────────────┘
```

**Output:**
- `forum-thread-analysis.md` - Comprehensive report with:
  - Summary statistics (by type, by severity)
  - Category breakdown with key issues
  - Detailed thread analysis table

---

### 6. Discord Analysis (`discordAnalysisWorkflow`)

**Trigger:** Manual invocation only

**Purpose:** Categorizes Discord help forum threads and generates severity reports for each category to help identify pain points.

**Flow:**
```
Manual Trigger
      │
      ▼
┌─────────────────────────┐
│ Fetch Forum Posts       │  ← Get threads from Discord help forum
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Fetch First Message     │  ← Get starter message for each thread
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Categorize Threads      │  ← AI groups threads by category
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Analyze Categories      │  ← AI summarizes each category
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Save Reports            │  ← category-summary.md, JSON dumps
└─────────────────────────┘
```

**Output:**
- `category-summary.md` - Summary table with category counts and severity
- `posts-dump.json` - Raw posts data
- `categorized-posts-dump.json` - Posts grouped by category

---

## Agents

### Classification Agent

Used by both `triageWorkflow` and `discordToGithubWorkflow` to classify issues.

**Model:** `openai/gpt-4o-mini`

**Capabilities:**
- Analyzes issue/thread title and content
- Picks all appropriate area labels with confidence levels
- Returns: `labels[]`, `reasoning`

### Effort/Impact Agent

Used by both `triageWorkflow` and `discordToGithubWorkflow` to estimate issue complexity.

**Model:** `openai/gpt-4o-mini`

**Capabilities:**
- Estimates effort required to resolve the issue
- Estimates impact/value of resolving the issue
- Returns: `effortLabel`, `impactLabel`, `reasoning`

### Thread Classifier Agent (Manual Reporting)

Used by `forumThreadAnalysisWorkflow` for detailed thread analysis.

**Model:** `openrouter/google/gemini-3-pro-preview`

**Capabilities:**
- Analyzes complete Discord forum thread conversations
- Classifies threads as Bug, Feature Request, or Question
- Assigns severity scores (1-10) based on impact
- Provides concise summaries of thread content

### Analysis Agent (Manual Reporting)

Used by `discordAnalysisWorkflow` for category-based analysis.

**Model:** `openai/gpt-4o-mini`

**Capabilities:**
- Categorizes Discord messages into product areas
- Generates severity-based summaries for each category

---

## Engineering Squads

| Squad | Areas of Ownership |
|-------|-------------------|
| **trio-tnt** | Workflows, Networks, Storage, RAG, Streaming, Server Cache, Pubsub |
| **trio-wp** | Playground, CI/Tests, Bundler, Deployer, CLI, Client SDK |
| **trio-tb** | Agents, Tools, Memory, MCP, Processors |
| **trio-tron** | Voice, Cloud Admin, Cloud Runner, Cloud Builder, Cloud Infrastructure |
| **trio-tracery** | Evals, Observability |
| **Growth** | Examples, Docs, Website, Analytics |

---

## Project Structure

```
src/mastra/
├── index.ts                 # Mastra instance configuration
├── constants.ts             # Product areas and ownership definitions
├── constants/
│   └── members.ts           # GitHub org members
├── agents/
│   ├── classification.ts    # Classification & effort/impact agents
│   ├── analysis.ts          # Discord analysis agent (manual reporting)
│   └── thread-classifier.ts # Thread classifier agent (manual reporting)
├── helpers/
│   ├── client.ts            # Discord client initialization (manual reporting)
│   └── messages.ts          # Discord message fetching utilities (manual reporting)
├── workflows/
│   ├── triage.ts            # GitHub issue triage workflow
│   ├── analysis.ts          # Discord analysis workflow (manual reporting)
│   ├── forum-thread-analysis.ts  # Forum thread analysis workflow (manual reporting)
│   ├── discordSync/         # Discord → GitHub message sync workflow
│   │   └── index.ts
│   ├── discordToGithub/     # Discord → GitHub issue creation workflow
│   │   ├── index.ts         # Main workflow
│   │   └── createGithubIssue.ts  # Sub-workflow: create issue & post to Discord
│   ├── classification/      # Issue classification workflow
│   │   └── index.ts         # Classify area, squad, effort & impact
│   └── githubIssueManager/  # Issue follow-up management workflow
│       ├── index.ts
│       └── helpers.ts       # Discord sync comment helpers
├── shared/
│   ├── discord.ts           # Discord client singleton
│   ├── github.ts            # GitHub client & label fetching
│   └── post.ts              # Discord post schema
└── tools/
    └── fetchForumPosts.ts   # Discord forum fetching tool
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token for accessing the Mastra server |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub token for issue management |
| `MASTRA_JWT_SECRET` | JWT secret for Mastra Cloud authentication |
| `MASTRA_DEV` | Set to `"true"` for debug logging |

---

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build
```

---

## Related Repositories

- [mastra-ai/mastra](https://github.com/mastra-ai/mastra) — Main Mastra framework (contains the GitHub Actions triggers)
