# Forum Thread Analysis Report

**Analysis Date**: 2026-01-02

**Total Threads**: 15 (11 open, 4 closed, 0 no issue linked)

## Summary Statistics

| Type | 🔴 Critical | 🟡 Major | 🟢 Minor | Total |
|------|----------|-------|-------|-------|
| Bug | 1 | 10 | 0 | 11 |
| Feature Request | 0 | 1 | 1 | 2 |
| Question | 0 | 0 | 2 | 2 |
| **Total** | **1** | **11** | **3** | **15** |

**Average Severity Score**: 5.3/10
- 1-3: MINOR issues (cosmetic, low priority, minimal impact)
- 4-7: MAJOR issues (significant but not blocking, moderate impact)
- 8-10: CRITICAL issues (blocking, high priority, severe impact)

## Category Breakdown
| Category | Total | Bugs | Features | Questions |
|----------|-------|------|----------|-----------|
| Observability | 4 | 3 | 1 | 0 |
| Workflows | 3 | 1 | 1 | 1 |
| Memory | 2 | 2 | 0 | 0 |
| Playground | 2 | 1 | 0 | 1 |
| Networks | 1 | 1 | 0 | 0 |
| Agents | 1 | 1 | 0 | 0 |
| Cloud Admin | 1 | 1 | 0 | 0 |
| Deployer | 1 | 1 | 0 | 0 |

---

## Thread Details

| Type | Severity | Score | Category | Summary | Thread Name | Issue Status | URL |
|------|----------|-------|----------|---------|-------------|--------------|-----|
| BUG | 🔴 | 8/10 | Cloud Admin | User was unable to see GitHub repositories in Mastra Cloud when creating a project, blocking deployment. The issue was identified as a bug affecting users with only private repositories, and the team deployed a fix that resolved the problem. | Mastra Cloud does not find any of my Github Projects.. Unable to connect. | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1455627205412651159) |
| BUG | 🟡 | 7/10 | Observability | User reported that observability sampling in the beta version incorrectly samples individual spans instead of full traces and that the Prompt Injection Detector is missing from traces. | Observability Sampling isn't working | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1455712616726134854) |
| BUG | 🟡 | 7/10 | Deployer | User reported 500/502 errors during remote deployment using `bun compile` due to duplicate `Transfer-Encoding` headers causing protocol errors. They identified the conflict between Mastra and Bun's automatic header handling and provided a middleware workaround. | Deplying Mastra Studio remotely gives: Error on Generate/Stream | 🔍 Needs Reproduction | [Link](https://discord.com/channels/1309558646228779139/1455865409617133619) |
| BUG | 🟡 | 6/10 | Networks | User reported that the `agent.network()` feature fails to transfer message history from the orchestrating agent to secondary agents, resulting in a loss of context for the sub-agents. | Agent Network | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1455209096792768572) |
| BUG | 🟡 | 6/10 | Agents | User reported that agent.generate() hangs instead of suspending when a tool triggers a suspension, unlike agent.stream(). A team member resolved this by implementing suspension support for generate calls and adding a new agent.resumeGenerate() method. | Agent does not suspend when it calls a tool that suspends | 🟢 Closed | [Link](https://discord.com/channels/1309558646228779139/1455510773576106044) |
| BUG | 🟡 | 6/10 | Workflows | User reported that inputData is undefined when resuming a suspended workflow step preceded by a .map() in beta.14. A team member was unable to reproduce the issue in beta.19, added verification tests, and requested a minimal reproduction repository. | inputData is undefined on resume when step is preceded by .map() | ⏳ Waiting for Author | [Link](https://discord.com/channels/1309558646228779139/1455748080648323133) |
| BUG | 🟡 | 6/10 | Memory | User reported that the `readOnly` memory option is broken in 1.0.0-beta, causing messages to be saved unintentionally. The team identified an API inconsistency regarding how the option is passed and submitted a PR to fix the behavior and consolidate the API. | Memory readOnly: true broken in 1.0.0-beta, saves to memory anyway | 🟢 Closed | [Link](https://discord.com/channels/1309558646228779139/1455989471131467887) |
| BUG | 🟡 | 6/10 | Observability | User reports a regression in v1 telemetry causing excessive spans and missing tool input/output details, along with broken trace replay functionality in the playground. | Excessive steps in Traces | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1456591730764681336) |
| BUG | 🟡 | 5/10 | Observability | User reported that the Langfuse Exporter fails to properly export internal structures like tools, which the team confirmed is unintended behavior. | Langfuse Exporter | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1455115209504067675) |
| FEAT | 🟡 | 5/10 | Observability | User requested a way to configure or disable string truncation in observability traces, as default limits hindered debugging. The team confirmed that configurable `serializationOptions` have been added and will be available in the upcoming v1 release. | Is there a way to control the truncation of AI tracing? | 🟢 Closed | [Link](https://discord.com/channels/1309558646228779139/1455588023927312446) |
| BUG | 🟡 | 5/10 | Memory | User reports duplicate messages persisting to memory when using an agent in both streaming and workflow contexts, even when memory options are omitted in the workflow call. | Duplicate Messages in Memory When Using Both agent.stream() and Workflow with agent.generate() | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1456181302800679079) |
| BUG | 🟡 | 4/10 | Playground | User reported that nested workflow outputs disappear from the Playground UI after a page refresh or server restart. A GitHub issue was automatically created to track this bug. | Nested Workflow Results not shown once Playground is refreshed | 🔍 Needs Reproduction | [Link](https://discord.com/channels/1309558646228779139/1456623354319737025) |
| Q | 🟢 | 3/10 | Workflows | User reported workflow inputs failing validation in Mastra Studio after a v1 migration, initially suspecting an empty request payload. The issue was resolved by identifying a misconfiguration where the `validateInputs` property was placed incorrectly in the `createWorkflow` definition. | Mastra Studio request payload is empty | 🟢 Closed | [Link](https://discord.com/channels/1309558646228779139/1455465802147827918) |
| Q | 🟢 | 3/10 | Playground | User inquired about how to set the initial state for workflows within the Mastra Studio UI, resulting in the creation of a GitHub issue. | set state in Mastra Studio | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1456610769654386688) |
| FEAT | 🟢 | 2/10 | Workflows | User requested exposing `getInitData`, the `mastra` instance, and `requestContext` within workflow `onError` and `onFinish` lifecycle events to improve context availability. | Nice to have: add more info in onError and onFinish workflow events. | 🔴 Open | [Link](https://discord.com/channels/1309558646228779139/1455937878147203216) |