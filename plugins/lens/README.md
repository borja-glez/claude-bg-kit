<div align="center">

# 🔍 lens

**A live progress panel for Claude Code sessions.**
The model and effort in use, the roadmap, forge stages and executions, superpowers runs, todos, subagents, Claude Code tasks, and what it all costs.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.11.4](https://img.shields.io/badge/version-0.11.4-b4befe?style=flat-square)
![no token cost](https://img.shields.io/badge/token%20cost-none-a6e3a1?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/lens.en.svg" alt="The lens panel: model and effort, roadmap, forge stages, subagents and the Usage card" width="100%"></p>

## Contents

- [Why lens](#why-lens)
- [Install](#install)
- [Usage](#usage)
- [What the panel shows](#what-the-panel-shows)
- [Usage and cost](#usage-and-cost)
- [The band](#the-band)
- [How it reads](#how-it-reads)
- [Develop](#develop)

## Why lens

Long runs happen out of sight: subagents in the background, reviewers in parallel, sessions in other worktrees. lens puts them on one screen next to your conversation, so you can tell at a glance whether things are moving, what is stuck and how much it is costing. It only observes and never adds tokens to your sessions.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install lens@bg-kit
```

lens detects [waypoint](../waypoint/README.md), [forge](../forge/README.md) and [superpowers](https://github.com/obra/superpowers) from their files in the project and needs none of them installed. Restart Claude Code after installing or updating.

## Usage

- `/lens` opens the side panel. With waypoint installed, the **Panel** button in its band does the same.
- The panel and the band are drawn in the terminal and in the Code tab of the desktop app.

| Where | How it looks |
| --- | --- |
| **Terminal** | Rounded frames, block bars and task boxes in cells. Spinners, a sheen along active bars and pulsing boxes are animated on the drawing thread by a surface module (`hooks/pulse.js`), so they cost no state writes. |
| **Desktop app** | Each card is an SVG with gradient bars, a moving sheen, breathing boxes and spinning rings. It follows the light or dark scheme, stops moving under reduced motion, and its alt text says everything the card shows. |

## What the panel shows

Each section is a card in its own colour (the roadmap's Catppuccin palette) and appears only when its source exists. Task boxes are coloured by state: done (blue), in progress (orange, pulsing), blocked (yellow), sent back by review (red) and pending (outlined). Agents are coloured by level: forge's implementer ladder runs from cool to warm (mech, light, impl, high, heavy, fable; `high` is `forge-impl-high`, Opus at high effort), and the reviewers by what they judge (correctness, security, perf).

| Card | Source | What you see |
| --- | --- | --- |
| **Now** | the session | The main model and its effort (`Opus 5.5 · effort high`), the tool running and how long the turn has been going. |
| **Roadmap** | waypoint plan | Percent, phase, a box per task of the track, the task in progress with its minutes against its estimate, messages and pending decisions and, dimmed, the last 3 tasks done on the track with their minutes against the estimate (`✓ T7 · 22/30 min`, amber when over). |
| **forge** | `.forge/status.json` | The last forge task triaged or worked on within the day, described below. |
| **Execution** | `.forge/execution/` and `.forge/live/` | While a forge execution is active, one row per running task with its title, stage, tier, agent, duration and round, and a liveness chip (alive, silent after 7 minutes, stopped after 12). Each row also shows the task's total time (`implement · 3m 02s · task 18m 04s`; after a relaunch, a task's time counts from the relaunch), the header the time since the run started (`⏱ 42m 10s`), and a dimmed line the last 3 tasks finished (integrated or blocked) with their duration (`✓ T3 12m 05s · T2 8m 30s`). Each row shows the task's title and the card the real total of the run; an ephemeral execution looks the same as a plan one. Executor and manual sessions get their own rows (`manual · T009`) and each strip is alive or not by its own session. Below, dimmed lists of the queued, conflicting, blocked and orphaned tasks. It replaces the old swarm card. |
| **superpowers** | `.superpowers/sdd/<plan>/progress.md` | The active plan and its subagent-driven-development ledger: task N/M, the current fix round, the last entries. A finished plan with no checked steps is hidden. |
| **Todos** | TodoWrite | Done/total, the one in progress and the next ones. |
| **Subagents** | Claude Code | The subagents running, with their type, description, model, effort and time and, dimmed with ✓, the last 5 that finished in the past 5 minutes with how long they ran. They are kept in memory only, so a reload of lens forgets them. |
| **Claude Code tasks** | Claude Code | Open and done tasks and the latest ones. |
| **Usage** | the session and `.forge/usage/` | Tokens and dollars by part, described in [Usage and cost](#usage-and-cost). |

**The forge card** shows:

- the task and its path;
- the task's time so far in the header (`✓ 14m 20s` once done);
- the stages (triage → implement → validate → verify → review → verdict, plus design, plan and final on the Large path), with the current one lit; the verify stage appears only when forge verifies the task;
- under the stages, how long each stage took, the current one live (`triage 12s · implement 5m 02s · validate 48s…`);
- during an execution, the run's own stages (brief, implement, validate, verify, review, verdict, integrate) of the task being worked;
- a box per brief: accepted, current or pending;
- the last agent with its level, model and effort;
- a verify row when the task was verified: the surfaces used, checks passed out of total, and the result (pass, fail or blocked);
- the last validators (✓/✗), the verdict with its score, and the review round against its cap.

Below the stages it lists up to 5 pending proposals, each as `title · category · risk` with **Approve** and **Reject** buttons that run `/forge:decide`. While a `/forge:infinite` run is active, the card also shows `∞ N/M · Hh left` and the 3 newest auto-approved proposals. When forge decided something without asking in the last day, the card also shows `⚑ N automatic decisions` and the last major one (`/forge:decisions` lists them). When the task runs in auto mode, the card's subtitle says so (auto mode).

## Usage and cost

The **Usage** card answers three questions: which model is working, how much it has spent, and what the method costs.

- **This session ▸ run.** The run view adds up every session of the current forge run (the execution's coordinator and its tasks) from `.forge/usage/<session>.json`. It appears while a run is active or ended in the last 12 hours.
- **Time.** `⏱ active 1h 12m · since start 3h 40m`: the active time is the sum of the main session's turns, the turn in progress included, and it is saved with the tokens in `.forge/usage/<session>.json`. The run view adds up the sessions of the run since it started and shows `≥` when a session wrote its file with an earlier lens; below it, dimmed, goes this session's own line. More than 24 h reads `>24h`. A lens reload in the middle of a turn undercounts that turn's active time; it never counts it twice.
- **Groups.** Main session, Implementers, Reviewers, Verification (the `forge-verify` agents), Planning and scout, Other subagents, and Tracking ≈ (an estimate of the context spent on waypoint and forge bookkeeping). Each group shows its dominant model, its tokens, its dollars and its share.
- **Check against `/cost`.** The session total is compared with Claude Code's own cost. A ⚠ appears when the two differ by more than 10 %, for example when a model is missing from the price table or lens loaded partway through the session.
- **Without forge (estimate).** The same work done by the main session alone, on its model, without review. It is always marked as an estimate, since in one session the context would grow and cost more, and nothing would be reviewed.
- **Prices** come from a dated table in the code (`src/lib/prices.ts`). A model without a price shows tokens but no dollars, and totals are marked `≥`.

lens measures from the moment it loads, from Claude Code's per-request token counts. It never reads transcripts and never calls a model. Fast mode is not priced separately; the `/cost` check reveals it.

## The band

When Claude has open todos or running subagents, and waypoint is not drawing its own band, lens draws a band above the prompt. It shows the most specific run going on (an active forge execution, else forge's last task, the roadmap, superpowers or the todos) with its bar, its task boxes and its count, then this session's usage (`· 1.8M tok · $6.2`), **Panel** and **×**. **×** hides it until the next session.

## How it reads

- While the panel is open, lens reads files every 10 s and after each turn.
- While the panel is closed, it reads only when there is activity (open todos or running subagents), every 30 s, for the band.
- With nothing going on and the panel closed, it keeps only a small in-memory record of the session's activity.
- Panel state is written only while the panel is open, and usage files only in projects that have `.forge/`.
- `.forge/run.json` is not read above 16 KiB, only the 50 newest proposal files are read, and usage files above 256 KiB are ignored.

## Develop

The plugin is a mod: `src/lens/register.tsx`, bundled to `hooks/register.js` by `npm run build` at the repository root (commit the result).

- `claude plugin validate plugins/lens` checks the manifest, the hooks module and its state contract.
- `claude plugin test plugins/lens` runs `plugins/lens/tests/*.test.ts` against the engine.
- `npm run typecheck:mod` type-checks the mod.

Bump the version in `plugin.json` on every change: the installed plugin cache is keyed by version.
