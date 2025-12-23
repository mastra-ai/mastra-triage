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
│  Workflows:                                                                 │
│    • triageWorkflow           → Triage new GitHub issues                    │
│    • discordToGithubWorkflow  → Create GitHub issues from Discord threads   │
│    • discordSyncWorkflow      → Sync Discord messages to GitHub issues      │
│    • githubIssueManagerWorkflow → Add follow-up labels to stale issues      │
│                                                                             │
│  Agents:                                                                    │
│    • triageAgent              → Classifies issues by area/squad             │
│    • areaClassifierAgent      → Labels issues by product area               │
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
│  Triage Agent    │  ← AI classifies by product area & squad
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    Wrap Up       │  ← Add labels, assign team members, post comment
└──────────────────┘
```

**Actions:**
- Adds labels: `[product_area]`, `status: needs triage`, `[squad]`
- Assigns issue to squad members
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
  │   │ Classify Area │ ← AI picks best GitHub label
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
- Labels issues: `status: needs triage`, `discord`, `[area]`
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

## Agents

### Triage Agent

Used by `triageWorkflow` to classify GitHub issues.

**Model:** `openai/gpt-4o-mini`

**Capabilities:**
- Analyzes issue title and body
- Matches content to product areas (Agents, Workflows, Storage, CLI, etc.)
- Assigns to appropriate squad (trio-tnt, trio-wp, trio-tb, etc.)
- Returns: `product_area`, `squad`, `assignees`, `reason`

### Area Classifier Agent

Used by `discordToGithubWorkflow` to label Discord-originated issues.

**Model:** `openai/gpt-4o-mini`

**Capabilities:**
- Fetches available labels from GitHub repository
- Analyzes Discord thread title and content
- Picks the most appropriate area label
- Returns: `label`, `confidence`, `reasoning`

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
│   ├── members.ts           # GitHub org members
│   └── squads.ts            # Squad member mappings
├── agents/
│   ├── triage.ts            # Issue triage agent
│   └── areaClassifier.ts    # Area classification agent
├── workflows/
│   ├── triage.ts            # GitHub issue triage workflow
│   ├── discordSync/         # Discord → GitHub message sync workflow
│   │   └── index.ts
│   ├── discordToGithub/     # Discord → GitHub issue creation workflow
│   │   ├── index.ts         # Main workflow
│   │   ├── classifyArea.ts  # Step: classify area using areaClassifierAgent
│   │   └── createGithubIssue.ts  # Sub-workflow: create issue & post to Discord
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
