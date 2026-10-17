<div align="center">

# 🔍 lens

**A live progress panel for Claude Code sessions.**
The model and effort in use, the roadmap, forge stages and executions, superpowers runs, todos, subagents, Claude Code tasks, and what it all costs.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.13.0](https://img.shields.io/badge/version-0.13.0-b4befe?style=flat-square)
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

- `/lens` opens the side panel where it docks: in fullscreen, from 110 columns. Outside fullscreen, or narrower, it leaves a **photo** of the panel in the transcript instead: one line, `lens · 14:02:11 #1 · 3 tasks`, drawn as the cards by a `CommandOutput` hook, still; the files are read once and nothing is written. `/lens live` opens the pane anyway (inline above the prompt where it does not dock), and `/lens photo` (or `/lens foto`) always takes the photo. The **Panel** button of either band does what `/lens` would.
- Inline, the pane asks for the rows its cards take (between 6 and a third of the screen), draws them without a frame and ends with `↓ N more · /lens photo` when they do not fit; docked, it asks for 56 columns. It is closed with the engine's own mark (or `ctrl+x x`). A long row of task boxes keeps two rows of boxes, the rest summed up on the row below (`+42 ■ · 12 □`), and the agent you look at expands its task. A photo is laid out at the transcript's width, narrower beside a docked pane.
- **Keyboard.** Outside fullscreen a click does not reach the band: `ctrl+x tab` gives it the keyboard, its buttons read `p: Panel` and `x: ×`, and the hint line under the prompt ends with `ctrl+x tab · band`. With the pane focused, Tab walks its buttons (the proposals' Approve and Reject have no letter).
- **One line.** Outside fullscreen, or with fewer than 3 rows above the prompt, lens keeps a status line under the prompt (`$.ui.status`) while this session has forge work of its own: `lens · T002 review r2 · 3 subagents · $1.20`. While a turn runs, the spinner names the task (`T002 · review r2`) when the engine has nothing of its own to say, and forge's auto mode and the infinite run show as mode labels (`forge auto`, `∞ 2/5`). A toast says when a task of this session gets a verdict (never its score), starts a new review round or is integrated, at most one every 5 seconds, and a notification says when a run of yours of 20 minutes or more ends.
- The panel and the band are drawn in the terminal and in the Code tab of the desktop app.

| Where | How it looks |
| --- | --- |
| **Terminal** | Rounded frames, block bars and task boxes in cells. Spinners, a sheen along active bars and pulsing boxes are animated on the drawing thread by a surface module (`hooks/pulse.js`), so they cost no state writes. |
| **Desktop app** | Each card is an SVG with gradient bars, a moving sheen, breathing boxes and spinning rings. It follows the light or dark scheme, stops moving under reduced motion, and its alt text says everything the card shows. |

## What the panel shows

Each section is a card in its own colour (the roadmap's Catppuccin palette) and appears only when its source exists. Task boxes are coloured by state: done (blue), in progress (orange, pulsing), blocked (yellow), sent back by review (red) and pending (outlined). Agents are coloured by level: forge's implementer ladder runs from cool to warm (mech, light, impl, high, heavy, fable; `high` is `forge-impl-high`, Opus at high effort), and the reviewers by what they judge (correctness, security, perf).

| Card | Source | What you see |
| --- | --- | --- |
| **Now** | the session | The main model and its effort (`Opus 5.5 · effort high`), the tool running and how long the turn has been going. With no turn open while subagents work, how many it waits on and when the session wakes (`waiting on 3 subagents · wakes in 4m`), and each job in the background without a task row (`validating T003 · 1m`). |
| **Roadmap** | waypoint plan | Percent, phase, a box per task of the track, the task in progress with its minutes against its estimate, messages and pending decisions and, dimmed, the last 3 tasks done on the track with their minutes against the estimate (`✓ T7 · 22/30 min`, amber when over). |
| **Tasks in progress** | `.forge/status/` (one file per task) and `.forge/jobs/` | One row per forge task (`[T002] Title · medium · review r2 · 12m`) and per workflow run, with this session's agents indented under its own rows. Another session's task shows dimmed and marked for 30 minutes after it last moved; a done task shows with ✓, and one `/forge:stop` stopped as stopped, for 15 minutes. A job in the background shows instead of the stage (`validating`). The expanded task carries the detail described below. Agents are placed under their task by the `forge-task:` line their prompt starts with (else `Task id:`, a `.forge/work/` path, the task in their description or their parent's task). |
| **Execution** | `.forge/execution/` and `.forge/live/` | While a forge execution is active, one row per running task with its title, stage, tier, agent, duration and round, and a liveness chip (alive, silent after 7 minutes, stopped after 12). Each row also shows the task's total time (`implement · 3m 02s · task 18m 04s`; after a relaunch, a task's time counts from the relaunch), the header the time since the run started (`◷ 42m 10s`), and a dimmed line the last 3 tasks finished (integrated or blocked) with their duration (`✓ T3 12m 05s · T2 8m 30s`). Each row shows the task's title and the card the real total of the run; an ephemeral execution looks the same as a plan one. Executor and manual sessions get their own rows (`manual · T009`) and each strip is alive or not by its own session. Below, dimmed lists of the queued, conflicting, blocked and orphaned tasks. It replaces the old swarm card. Each slot lists its agents. |
| **superpowers** | `.superpowers/sdd/<plan>/progress.md` | The active plan and its subagent-driven-development ledger: task N/M, the current fix round, the last entries. A finished plan with no checked steps is hidden. |
| **Todos** | TodoWrite | Done/total, the one in progress and the next ones. |
| **Subagents** | Claude Code | The subagents running, with their type, description, model, effort and time and, dimmed with ✓, the last 5 that finished in the past 5 minutes with how long they ran. They are kept in memory only, so a reload of lens forgets them. An agent drawn under its task or its slot is not listed again; a teammate idle between turns shows as waiting. |
| **Claude Code tasks** | Claude Code | Open and done tasks and the latest ones. |
| **Usage** | the session and `.forge/usage/` | Tokens and dollars by part, described in [Usage and cost](#usage-and-cost). |

**The detail of the expanded task** shows:

- the task and its path;
- the task's time so far in the header (`✓ 14m 20s` once done);
- the stages (triage → implement → validate → verify → review → verdict, plus design, plan and final on the Large path), with the current one lit; the verify stage appears only when forge verifies the task;
- under the stages, how long each stage took, the current one live (`triage 12s · implement 5m 02s · validate 48s…`);
- during an execution, the run's own stages (brief, implement, validate, verify, review, verdict, integrate) of the task being worked;
- a box per brief: accepted, current or pending;
- the last agent with its level, model and effort;
- a verify row when the task was verified: the surfaces used, checks passed out of total, and the result (pass, fail or blocked);
- the last validators (✓/✗, `· cached` when they came from the cache), the verdict without a score (`✓ accepted in round 2 · 0 C · 1 I · 3 m`) and the review round against its cap; a skipped verification says why (`⊘ verify web · skipped: …`).

Below the stages it lists up to 5 pending proposals, each as `title · category · risk` with **Approve** and **Reject** buttons that run `/forge:decide`. While a `/forge:infinite` run is active, the card also shows `∞ N/M · Hh left` and the 3 newest auto-approved proposals. When forge decided something without asking in the last day, the card also shows `⚑ N automatic decisions` and the last major one (`/forge:decisions` lists them). When the task runs in auto mode, the card's subtitle says so (auto mode).

## Usage and cost

The **Usage** card answers three questions: which model is working, how much it has spent, and what the method costs.

- **This session ▸ run.** The run view adds up every session of the current forge run (the execution's coordinator and its tasks) from `.forge/usage/<session>.json`. It appears while a run is active or ended in the last 12 hours. A session counts only what it spent since it joined the run; a file an older lens wrote counts whole and marks the total `≥`.
- **Time.** `◷ active 1h 12m · since start 3h 40m`: the active time is the sum of the main session's turns, the turn in progress included, and it is saved with the tokens in `.forge/usage/<session>.json`. The run view adds up the sessions of the run since it started and shows `≥` when a session wrote its file with an earlier lens; below it, dimmed, goes this session's own line. More than 24 h reads `>24h`. A lens reload in the middle of a turn undercounts that turn's active time; it never counts it twice.
- **Groups.** Main session, Implementers, Reviewers, Verification (the `forge-verify` agents), Planning and scout, Other subagents, and Tracking ≈ (an estimate of the context spent on waypoint and forge bookkeeping). Each group shows its dominant model, its tokens, its dollars and its share.
- **Check against `/cost`.** The session total is compared with Claude Code's own cost. A ▲ appears when the two differ by more than 10 %, for example when a model is missing from the price table or lens loaded partway through the session. A resumed session compares only what it spent since it resumed.
- **Without forge (estimate).** The same work done by the main session alone, on its model, without review. It is always marked as an estimate, since in one session the context would grow and cost more, and nothing would be reviewed. It shows as a range when the tracking was re-read: the low end assumes all the tracking travelled as context on every step.
- **Prices** come from a dated table in the code (`src/lib/prices.ts`). A model without a price shows tokens but no dollars, and totals are marked `≥`.

lens measures from the moment it loads, from Claude Code's per-request token counts. It never reads transcripts and never calls a model. Fast mode is not priced separately; the `/cost` check reveals it.

## The band

When Claude has open todos, running subagents or a forge task of this session in progress, and waypoint is not drawing its own band (waypoint says so; its band closed with **×** counts as not drawn), lens draws a band above the prompt. It names this session's tasks in progress one by one (`T001 impl · T002 rev r2 · T003 val`), or else the most specific run going on (an active forge execution, forge's task, the roadmap, superpowers or the todos) with its count, then the subagents and this session's usage (`· 1.8M tok · $6.2`), **Panel** (`p`) and **×** (`x`), all fitted to the width as waypoint's band is; its bar and task boxes show only from 140 columns. **×** closes it for what it shows: a band about something else (other tasks, a run, the todos instead of a plan) comes back, and an `x` pressed within 5 seconds of waypoint's band going (a double tap on waypoint's **×**) does not close it.

## How it reads

- While the panel is open, lens reads files every 10 s and after each turn.
- While the panel is closed, it reads every 30 s, for the band and the one-line surfaces, only while there is activity: open todos, running subagents, a forge task of this session in progress that moved in the last 30 minutes (or has a job or an agent at work), an active run this session coordinates or works in, or a `forge.cjs` call of this session in the last 10 minutes. A task left in progress longer still shows, but keeps nothing reading.
- A `/lens` photo reads the files once, when it is taken, and writes nothing.
- With nothing going on and the panel closed, it keeps only a small in-memory record of the session's activity. In a project with `.forge/`, once the session has spent something, it still writes its usage file at most every 30 s, looking at `.forge/execution.json` (one stat) to follow a run.
- Panel state is written only while the panel is open, and usage files only in projects that have `.forge/`.
- `.forge/run.json` is not read above 16 KiB, only the 50 newest proposal files are read, and usage files above 256 KiB are ignored.
- forge's task statuses are read from `.forge/status/` beside the ledger (the main checkout for a forge task worktree): at most the 20 newest touched within the day, each up to 64 KiB, and again only when they change; without that folder, `.forge/status.json`. The jobs in the background are read from `.forge/jobs/` of the main checkout: at most 10, each up to 4 KiB.
- In a managed install the classic hooks (`SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`) do not run. Subagents still show, since lens follows them from `agent.spawn` and the agents list, but the **Claude Code tasks** card stays empty: it comes only from `TaskCreated` and `TaskCompleted`.

## Develop

The plugin is a mod: `src/lens/register.tsx`, bundled to `hooks/register.js` by `npm run build` at the repository root (commit the result).

- `claude plugin validate plugins/lens` checks the manifest, the hooks module and its state contract.
- `claude plugin test plugins/lens` runs `plugins/lens/tests/*.test.ts` against the engine.
- `npm run typecheck:mod` type-checks the mod.

Bump the version in `plugin.json` on every change: the installed plugin cache is keyed by version.
