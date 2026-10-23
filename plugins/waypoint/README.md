<div align="center">

# 🧭 waypoint

**Design docs, live roadmaps and multi-session tracking for very large Claude Code tasks.**

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.33.0](https://img.shields.io/badge/version-0.33.0-cba6f7?style=flat-square)
![requires claude.ai login](https://img.shields.io/badge/requires-claude.ai%20login-89b4fa?style=flat-square)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-a6e3a1?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/roadmap.en.svg" alt="The waypoint roadmap: tracks with task boxes, a timeline and live sessions" width="100%"></p>

## Contents

- [Why waypoint](#why-waypoint)
- [Features](#features)
- [Install](#install)
- [Usage](#usage)
- [The roadmap](#the-roadmap)
- [The band](#the-band)
- [Parallel sessions](#parallel-sessions)
- [Sessions: seat and binding](#sessions-seat-and-binding)
- [Hooks](#hooks)
- [CLI reference](#cli-reference)
- [Permissions](#permissions)
- [Develop](#develop)

## Why waypoint

A task that spans dozens of steps and several sessions loses its thread: what was decided, what is done, who is working on what. waypoint keeps that thread outside the conversation. It keeps a design you approved, a plan in the repository and a live page that every session and every person reads and writes.

## Features

- **Design in rounds.** A `design-critic` agent reviews the design document and returns numbered proposals with their critical points. You apply all or some of them, ask for another round, have Claude interview you, or rewrite, until you approve it.
- **A plan in the repo.** `docs/waypoint/<project>/plan.yaml` holds tracks, phases and tasks, each with its zones (the files it touches), `done_when` and an estimate. The approved design seeds it. A task forge must handle with care carries `delicate: true` (the roadmap ignores it).
- **A live roadmap.** The plan is published as a claude.ai artifact that updates while Claude works. Its views are Summary, Plan, Schedule, Runs, Sessions and Conversation, under a status strip, with «Needs you», a task detail in four tabs, filters, a zoomable timeline, dependencies, a minimap, export and a phone layout.
- **Parallel sessions.** `/waypoint:launch <track>` starts a background session in its own git worktree. Sessions show up in the roadmap and coordinate through messages: overlap warnings, handoffs and delegation.
- **A band above the prompt** that shows where you are and runs the next command with one click or one key.
- **Nothing lost.** Hooks record every commit and remind you of pending roadmap writes before the session stops.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install waypoint@bg-kit
```

Requires a claude.ai login (for the artifacts) and Node ≥ 20. Restart Claude Code after installing or updating.

## Usage

| Command | What it does |
| --- | --- |
| `/waypoint:design [new [--from <spec>]\|round [--verify]\|apply <all\|1,3>\|rewrite\|interview\|approve\|amend\|reopen\|resume\|park]` | Write a design document (or import a superpowers spec with `new --from`), improve it in critic rounds and approve it. The approved design seeds the plan. |
| `/waypoint:plan` | Write or sync `docs/waypoint/<project>/plan.yaml` and publish the live roadmap. |
| `/waypoint:work [track]` | Take tasks one by one; the roadmap updates live. |
| `/waypoint:status` | Progress summary. |
| `/waypoint:launch <track>` | Start a background session on a track in its own git worktree. |

A typical run:

```text
/waypoint:design new              # first draft
/waypoint:design round            # the critic proposes numbered changes
/waypoint:design apply 1,3        # apply the ones you want
/waypoint:design round --verify   # the critic checks what you applied
/waypoint:design approve
/waypoint:plan                    # plan.yaml + the roadmap URL
/waypoint:work                    # or launch a session per track
```

`/waypoint:design new --from docs/superpowers/specs/<file>.md` starts from a spec written with superpowers: its sections are copied as they are, and the design page says «Imported from».

A proposal you do not apply stays pending across rounds: the band counts the pending ones of every round, the next round's critic does not repeat them, and `approve` lists the critical and major ones still open and asks you to apply or dismiss them.

Each snapshot records what it applied: `/waypoint:design apply r1:4,5 r2:all` applies proposals of several rounds and calls `design-snapshot --round <R> --applied r1:4,5 r2:…`; a rewrite calls it with `--rewrite`. `design-gate` and the band read those fields, and fall back to the note («round 1: applied 1,3», «ronda 1: aplicadas 1,3») only in older changelogs.

**A critic that converges.** Each round has a budget: round 1 reviews everything with up to 12 proposals of any severity; round 2 up to 6, critical and major, on what changed; from round 3, and in `round --verify`, up to 3 critical ones (a reopened design starts again: the first round after a reopen has round 1's budget). The critic writes `verdict: ready` when nothing critical or major is left (zero proposals is a valid critique), never proposes again what you dismissed (`critique-dismiss --reason-file` keeps your reason; a reason already stored is never overwritten) or resolved in an interview (`design-snapshot --resolved r1:4`), and does not pick at the text of its own applied proposals. `critique-next` says which round is next, its budget and what it reviews; `round --verify` reads only the sections changed since the last critique, and everything when a change only removed sections (the critic is told which went away). A critique that fails `critique-check` twice is set aside as `r<R>.rejected.json` (`--reject-on-fail`) and never counts as a round. A hand edit of the design after its last snapshot also counts as a change no critic has read (`design-gate` reports it as `handEdit`): `/waypoint:design round` snapshots it first, and `round --verify` then clears it. With forge's auto mode, `/waypoint:design approve --auto` approves without asking only when `waypoint design-gate` says no critical or major proposal of any round is left and no applied change is unread by a critic (`needsVerify`).

**Approved designs: amend or reopen.** A small change to an approved design is an amendment (`/waypoint:design amend`): it stays approved, and `waypoint design-impact` lists the plan tasks whose `design_ref` points at a changed or removed section, so `/waypoint:plan` can sync the plan and its `design_version`. A bigger one reopens it (`/waypoint:design reopen`): back to draft and through the critic, with the full budget in its first round. The plan skill writes the link itself: `artifacts.design`, `design_version` and each task's `design_ref`.

**Critiques in the repository.** The critiques and `dismissed.json` live in `docs/waypoint/<project>/design/critiques/` and are committed with the design; the ones in `.waypoint/<project>/` from earlier versions are still read. The design page shows each round with its verdict and what became of each proposal (applied in vN, dismissed with its reason, resolved in the interview, rewritten or pending), what each version changed (against an earlier version when the history lacks the one before, and it says so), how many proposals are pending in all, and a status badge (draft, approved, approved · amended, parked). When both places have a `dismissed.json`, both count.

With [forge](../forge/README.md) installed, `/forge:run` drives these steps for you and adds triage, validation and independent review to each task.

## The roadmap

The roadmap is an artifact on claude.ai. It is private until you share it, and its database rules decide what each viewer can write.

| View | What it shows |
| --- | --- |
| **Summary** | What needs you, what is in progress (one row per task: stage, round, validators, time, agent and who runs it), the next free tasks, the progress by version and phase, the recent activity and the live sessions. |
| **Plan** | The phases one under the other, the one in progress open, each with its state, goal, progress bar and tasks (grouped by category when the plan has them); filters by task state, phase, deferred findings, rounds over the cap and track that add up to the plan and stay in the address (`pf=`). |
| **Schedule** | A timeline that opens fitted to the plan with the phases in progress open, by phase, track, session or category, with dependencies, filters, a minimap and export, and the analysis: one forecast end and how it is reckoned, a burndown against the version's `target`, the critical path and the code zones by directory. |
| **Runs** | The active forge execution with its tasks, a stalled one with the command that resumes or closes it, and the history of the finished ones, kept in `runs/`. |
| **Sessions** | The sessions grouped by the run they work for, with their role, liveness, track, every task they run, the coordinator's slots and their messages. |
| **Conversation** | Notes and proposals in one list with one set of filters: a proposal carries its comments, the task it became and its history, and a question a decision closed says which decision. |

**Status strip.** On top of every view: whether the page is live (or, before the database answers, the date of the states it was published with), one pill for the forge execution and one for the infinite mode (yellow when its coordinator is silent, red when it stopped), the current version's percent, the forecast end, when the states last synced and a link to the design. On a phone the views are a tab bar at the bottom.

**Needs you.** The Summary opens with what is waiting for you: open questions (answer them there), proposals to decide, approvals without your mark and decisions that changed after you took them (to the owner), open escalations, tasks blocked from outside with their reason, recent deferred findings, a stalled execution, an infinite mode without its coordinator, and a page older than the waypoint that synced the plan. The roadmap is still read-only except for notes and proposals, so each entry says which command to use (`/waypoint:work T`, `/forge:run`, `/forge:stop`, `/waypoint:plan`) instead of changing anything. **Seen** hides the deferred findings in your browser only; the mark expires when the task merges or after 7 days.

**Task detail.** Clicking a task opens its detail in four tabs: Summary (why it is blocked, its state and who runs it, the period against the estimate, the branch and the commits), Definition (what it includes and when it is done, its section of the design, the zones it touched outside the plan, its dependencies in the colour of their state), Forge (stages, review rounds, validators, the accepted round, deferred findings and verification by round) and Conversation (its notes and the proposal it came from). The address carries it, `#t=T044&tt=forge`, so a link opens it (one to a task added after the page was published waits for the live plan) and closing it never leaves the page; the keyboard reaches everything, the arrows move between the tabs and Escape closes it.

**Notes.** The work skill reads new notes from people at the start of each task and treats them as information, never as orders. It also writes its own decision, debt and question notes. A decision forge took without asking carries an **auto** tag, what was chosen, why and how to undo it (`/forge:decisions revert <n>`).

**Proposals.** Each card shows the category, risk, status, the pillar it serves, the rationale, the evidence, the estimate and path when present, who decided it and why, and its comments. The roadmap's owner can approve or reject a proposal that is still proposed or in discussion (with an optional reason); anyone who can write comments on any proposal. If someone decided it in the meantime, the page does not overwrite that decision and says so. forge only works on proposals that are approved or auto-approved. Only decisions by the roadmap's owner count for forge: a decision counts when its mark is in `approvals/`, a collection only the owner can write (the rule is `owner`, a database rule the server enforces; editors comment, they do not approve). The page writes the owner's mark in `approvals/` (`{status, decidedAt, by, digest}`) before the decision, and refuses to decide when the proposal changed while it was being read; an approval without the mark says it will not become a task, and the owner can confirm it there (or with `/forge:decide <id> confirm`). An approval whose decision changed after the owner took it (its text edited, or its status changed, such as a rejection turned into an approval) says «changed after your decision: review the text and decide» and has no one-click confirm: the owner reads the text and decides again with Approve or Reject. If the mark is saved but the proposal could not be updated, the page says «Your mark is saved; the proposal still needs updating», and Retry runs only that update again. A roadmap published before this version lacks the rule: republish it with `/waypoint:plan` after upgrading, and only then are approvals owner-only.

**Verification.** When forge verified a task with tools, its detail shows a Verification block: the result, the surfaces used, each check with what was expected and observed, and the screenshots as thumbnails that open in a lightbox. Task boxes carry a small indicator for verified tasks. Screenshots reach the roadmap only when it has forge's screenshot store, which makes it organization-internal: forge publishes the roadmap with it on its Large path when the project's forge config has `evidence: upload` (the default), and `/waypoint:plan assets` adds it to a roadmap you published yourself (it asks you once). A roadmap published with the store keeps it, and forge's `evidence: local` only stops new uploads; `/waypoint:plan no-assets` makes it shareable again (it asks you once). Without the store the roadmap shows the results without images.

**Task times.** The detail of a done task says how long it took against its estimate (`took 22 min · estimated 30`, in amber when it went over); the detail of a task that is claimed or in progress says how long it has been running (`running for 12 min`). A task with a missing, future or reversed date shows no time.

**forge on the page.** When forge drives a task, its row in «In progress» and the Forge tab of its detail show its path, stage, review round against the cap, validators, agent and who runs it. While an infinite run is active, the status strip shows `∞ cycle N` (with `/M` when the run has a cycle budget). While a forge execution is active, the status strip shows the pill `▶ execution · subagents 2/3` (mode, tasks running out of the maximum); it adds `no signal since 12:40` when the coordinator has been silent for 7 minutes and `stopped since 12:40` after 12, and it marks the execution's integrations on the timeline.

**Execution.** The Runs view shows the active execution: one row of «In progress» per running task with its stage, agent and its time in the stage and in all, as durations (`12 min · 2 h 05 min`), and the slots in use out of the maximum (`2/3 slots`); the coordinator's card in Sessions lists its slots, each with how long it has been running (`running for 12 min`), and the free ones, and a finished run stays in the history. Session cards carry a role tag (coordinator, executor, manual) and a liveness dot. A task that is in progress but whose executor stopped renewing its lease is marked **No executor** and counts as blocked in the filters, so you notice it and another session can recover it. The page reads all of this from the roadmap's `meta/run` document (`runId`, `mode`, `parallel`, `branch`, `mergeOnFinish`, `active`, `stopReason`, `coordinator` and one slot per running task with its `task`, `stage`, `agent`, `by` and `since`), which forge keeps up to date.

**Data of the roadmap.** The metrics live in `meta/metrics` (the last commit and the test count, written apart from a task's batch; the CLI prints it without `if_version`, which is sent only to create the document: once it exists, the skills pin it to its listed version); the page also reads them from `meta/project.metrics` for a roadmap an older forge wrote. `meta/page` says which waypoint published the page and with which rules. `waypoint sync --db` reads the roadmap's listings: it never writes over a document whose version it does not know, keeps what a task was when the plan drops it and writes `meta/project` last. It stops with exit 2, printing nothing, on a listing that may be cut at 1000 documents and on a phase or `meta/project` the database holds and `known.json` does not list (list the database again); and it prints `republish` when the published page is older than the plugin or its `rules` are older than the owner's approvals rule. The page's snapshot carries the listed states (`page --states`), and forge writes each task's forge block, evidence, runs and infinite run itself.

**Loose tasks.** When a forge ephemeral execution (several independent requests run in parallel) is active, the Runs view has a **Loose tasks** section, and the running ones show in «In progress», with the title, status, stage and agent of each request (and, once it is integrated or blocked, how long it took, `took 6 min`, when the coordinator publishes it), and the run pill reads `▶ loose tasks · subagents n/N`. They do not count in the plan's progress and never enter `plan.yaml`.

**Debugging the page.** Add `?debug=1` to the roadmap's address (or `#debug=1` to its hash): the page lists, per document, what it dropped or corrected while reading the roadmap's data.

**Permissions.** Contributors can write only notes and proposals, and only the owner can write `approvals/` (the rule is `owner`). Everything else (plan, state, sessions, events, messages) needs Editor. Claude writes through ArtifactData as the owner, which the rules never limit. Without a signed-in viewer, or when the database refuses a note, the composer is read-only.

> After updating the plugin, run `/waypoint:plan`: it republishes by itself when the published page is older than the plugin or lacks the owner's `approvals/` rule (`meta/page`, which every publish writes with the rules its capabilities really carry). Every publish passes the capabilities, so a roadmap first published by an older waypoint gets every rule on its next republish. A republish that would change who can see and share the roadmap (`/waypoint:plan assets` adds forge's screenshot store, which makes it internal to your organization; `/waypoint:plan no-assets` drops it, which makes it shareable again) asks you first, even when the plugin update asked for it; nobody to answer, as in a `/forge:infinite` cycle, means no republish. So does a republish of a roadmap whose `meta/page` does not record whether it has the store (one not republished since 0.26.0): going ahead drops the store, and `/waypoint:plan assets` keeps it.

## The band

<p align="center"><img src="../../docs/assets/band.en.svg" alt="The band above the prompt in design, work and run modes" width="100%"></p>

| Mode | Shows | Buttons |
| --- | --- | --- |
| **Design** | Design version, proposals and critical points from the last critique | Apply all (`a`), Pick… (`e`), Another round (`o`), Rewrite (`w`), Interview me (`i`), Approve (`y`), View design (`d` outside fullscreen) |
| **Work** | Your track and its progress, the task in progress with its time (`12 m / 30 m`; `9 h 58 m / 30 m` in amber once past its estimate), overall progress, unread messages (`✎ 1`), a pending decision (`▲ decision pending`) | Next task (`n`), Status (`s`), Launch session on track… (`l`), Open roadmap (`r` outside fullscreen); a run member's Stop (`t`) |
| **Run** | The execution (`► EXECUTION · subagents 2/3 · T004 review (r2) · … · 3/12 integrated`): mode, tasks running out of the maximum, every task with its stage and round (up to 12; those that do not fit, and any running past 12, are counted as `+N`), tasks integrated out of the plan's total (or the batch's) and `to integrate N` for the accepted ones; a stalled run shows `► EXECUTION · ▲ stopped`, and `▲ no signal` or `▲ stopped` is appended when the coordinator or a running task goes silent or stops; `✎ N` and `▲ decision pending` as in work mode | Status (`s`), Stop (`t`, twice), Open roadmap (`r` outside fullscreen) |
| **Notice** (dim, `notice`) | What a conversation that is not the seat's owner sees: another live session works the roadmap (`◦ another session (main) works on T019 · 3 min ago`) or its design (`◦ another session (main) is working on the design · 3 min ago`), or coordinates a forge execution (`◦ forge execution running, coordinated by another session · 3/12`); an earlier conversation left a task, a draft or an execution behind (`◌ left in progress: T019 Orders API · 2 h ago`, `◌ execution stopped: 3/12 integrated · 2 h ago`; with the coordinator's conversation still open, `◌ execution stopped, open in another conversation: 3/12 integrated`, without Resume), offered for 24 hours | Status (`s`), Other track (`l`, not in design), Open roadmap (`r` outside fullscreen) · View (`v`), Join (`j`, `/forge:run --join`, plan execution only) · Resume (`e`, `/waypoint:work resume`), Release T019 (`f`, `/waypoint:work release T019`) · Resume (`e`, `/waypoint:design resume`) · View (`v`), Resume (`e`, `/forge:run --resume`), Close (`c`, `/forge:stop`) |

**Width and keyboard.** The band fits the width it has: each part has a priority, and when room runs out the least important take a short form first (`track core 2/5` becomes `2/5`, the task's title is cut) and then go, while a pending decision, a silent run and the inbox go last. From 140 columns it is one row with the full buttons, from 90 two rows with short labels; narrower, with fewer than 3 rows above the prompt or outside fullscreen, it is one row whose buttons fold into **⋯** (`m`). A second row that does not fit takes a second line where the band has 3 rows or more, and only then clips its widest labels, never so far that two buttons read the same; what still does not fit goes to a further page of **⋯**, which `m` opens one page after another. Every button has a letter: `n` Next task, `s` Status, `l` Launch…, `t` Stop, `p` Panel, and `x` closes the band; in design `a`, `e`, `o`, `w`, `i` and `y`; in a notice `v`, `j`, `e`, `f` and `c`. A click needs fullscreen; anywhere, `ctrl+x tab` gives the band the keyboard and the letters press its buttons. Outside fullscreen the buttons read `n: Next` and the hint line under the prompt ends with `ctrl+x tab · band`; there **Roadmap** (`r`) and **View design** (`d`) are buttons that copy their address and show it in a toast, since no key opens a link. In fullscreen they are links you click, with no letter. The coordinator's **Stop** (`t`) asks twice: the first press shows «Press t again to stop the run» and the second, within 5 seconds, runs `/forge:stop`; so does **Close** (`c`) on a run still active. A run member's **Stop** only leaves `/forge:stop` in the prompt, as said below. The band tells lens whether it is drawn (`{ plugin: 'waypoint', key: 'drawn' }`), so lens draws its own band when you close this one.

The band is drawn by role: each refresh compares `$.session.id()` with the bindings of the project and with forge's execution (see [Sessions: seat and binding](#sessions-seat-and-binding)), and every band model carries that role as `viewer: { role, coordinator, runId }` (`runId` is set only when the band is about the execution). The conversation bound to the seat sees its work band, or its design band while the draft is its own; forge's coordinator sees the run band, the only one with **Stop**; a member of the execution sees its own task with the execution's line, and its **Stop** leaves `/forge:stop` in the prompt for you to confirm. **Resume** on a draft binds it and shows its state without running a critique round; **Close** (`c`) on an execution still active without its coordinator asks twice, as **Stop** does. An active execution is without its coordinator when the coordinator's conversation ended, or when it went silent: no step nor signal for 12 minutes and no agent running. **Join** shows only on a plan run: forge's ephemeral run (parallel briefs) takes no members. In a checkout without a waypoint project the band draws nothing, but its model still carries the role from forge's execution, so forge's coordinator reads as `{ role: 'owner', coordinator: true, runId }`. **×** on a notice is kept in the plugin's store (`$.store`), shared by your conversations, per checkout, project, kind of notice and subject until the notice would end (a day for another session's work, and for an offer already past its 24 hours), so a new task or a new execution shows again; **×** on your own band lasts the session. After `/clear` the band keeps refreshing and shows the new conversation's role at once. The band strips control and bidirectional characters from the titles it shows. A conversation that was open before 0.23 sees no band until its next `/waypoint:work`.

When forge decided something without asking in the last day, any band ends with `⚑ auto · N · <the last major decision>`.

With [lens](../lens/README.md) installed, a **Panel** button opens the progress panel. If a command cannot run from the band, it is left in the prompt with a note saying "press Enter".

The band is drawn in the terminal and in the Code tab of the desktop app. It is not drawn in the VS Code panel or with `-p`; there, use the commands directly.

## Parallel sessions

`/waypoint:launch <track>` creates `.claude/worktrees/<track>` on the branch `track/<track>` and starts a background Claude session there. It runs `waypoint launch <plan> <track> --exec`, which starts `claude --bg` itself, so the skill needs no `claude --bg` permission; the session's own output goes to `.waypoint/<project>/launch/<name>.log`. Each session claims tasks from its track and writes its progress to the roadmap. When two sessions touch the same files, they get an overlap warning. Sessions can hand off or delegate work through messages, which are stored in the roadmap and sent with `SendMessage`. A session that disappears has its task recovered by the others. The prompt is `/waypoint:work <track>` (plus the merge authorization with `--merge`); a track of a plan that a forge execution is running joins that execution as a manual member by itself (`/waypoint:work` §0.5). Their worktrees are kept out of `git status` through `.git/info/exclude` when nothing ignores them.

A session that works alone in the main checkout does not load any of this: `/waypoint:work` keeps the coordination with other sessions (messages, overlaps, recovery, delegation, escalations, the phase close and `release`) in `skills/work/references/multisession.md`, and reads it only when the session works alongside others (`next` prints `multi: true`: another live session, a message for this one, a task an idle session left, or a track worktree; or a `[waypoint` message arrives) or for one of those steps (`release`, a claim that is not `solo`, a lost task, zone expansion, delegation).

By design, `multi` stays true while a message addressed to the session is open, also one it already handled that the protocol leaves open (a `delegate` proposal, a declined thread, an `escalation`): its inbox skips that message through `seen.json`. A broadcast (`to: "*"`) never turns `multi` on, so a session that works alone does not read one left by a session that has since ended.

forge's sessions mode starts one session per task itself: `forge swarm tick` composes its launch (the worktree `.claude/worktrees/task-<T>` on `task/<T>`, `/forge:member`, and the `--effort` and `--model` of its `swarm.member` setting, medium by default) and the coordinator runs it; `waypoint launch --task` exits with code 2. The band of such a member says "of the execution of <coordinator>". Any session can also join a running execution as a manual member from `/waypoint:work`, and take a pending task. `session-id` gives only letters, digits, `_`, `.` and `-`, the ids forge accepts.

For many tracks at once with automatic integration, use forge's [execution modes](../forge/README.md#execution-modes).

## Sessions: seat and binding

The roadmap work of a checkout belongs to one conversation at a time. `.waypoint/<project>/session.json` is the **seat** (its id, `main` or the track, is the `sessions/<SID>` document of the roadmap) and `.waypoint/<project>/bound.json` is the **binding** of that seat to the Claude conversation that works it: `{sid, claude, pid, via, since, seenAt, endedAt, endReason}`. `/waypoint:work`, `/waypoint:design`, `/forge:run`, `/forge:member` and `/forge:infinite` make it with `waypoint bind`; the `SessionEnd` hook and `waypoint release` close it. It lapses 5 minutes after its last renewal, or at once when the process it recorded is gone. In this version the conversation's own hooks renew it, whatever its role (a forge coordinator or member too), at most once a minute and only while that conversation is running them: its `SessionStart`, its `Stop` and its commands that name git (the `PostToolUse` hook starts only for those), so a long turn of other commands without the band lets it lapse until the turn ends or a git command runs; the band renews it as well once a minute while the conversation is open (never one that already ended). A reader that finds `bound.json` empty or half written reads it once more. A binding that was released stays released, even through a compact or a resume. A conversation holds one seat per project: binding another one ends its first.

Each session works out its role from those files, and the hooks act by it:

| Role | Who | What it gets |
| --- | --- | --- |
| owner | the conversation bound to the seat | the start context with its task, its commits recorded, the Stop reminder |
| owner by forge | forge's coordinator and the members of its run | nothing from these hooks: forge's own hooks speak to them |
| another live one | any other conversation while the owner is alive | one line at start that says who works the roadmap, and a dim notice in the band; nothing else |
| previous | a later conversation after the owner ended (`/clear`, exit, a crash) leaving a task in progress, for 24 hours | one line at start that names the task left in progress: `/waypoint:work resume` takes it up, `/waypoint:work release` frees it on the roadmap; the band offers the same with **Resume** and **Release** |
| none | anyone else | one line on a fresh start when the project has a plan |

`/waypoint:work` never takes a seat another live conversation holds (`waypoint bind` exits 3): it offers, in this order, a track in a worktree (`/waypoint:launch`), a second seat in this checkout (`main-2`, in `.waypoint/<project>/seats/main-2/`, with its own files) or an explicit takeover; when another seat holds a task an earlier conversation left, it also offers to resume it there. Two seats in one checkout share its HEAD, so each records only the commits its own `git commit` (an amend, or a merge commit it concludes, too), `cherry-pick` or `revert` makes, and a second seat completes its task with `done --rev`. Two residues remain: a rebase there keeps each line of the seat's own commits under its new sha but records nothing new (what a rebase brings is not attributed), and a commit that lands while the other seat's commit command is still running may be recorded by both seats, never by neither. When the earlier conversation ended with a task in progress, `bind` exits 4 and asks first. After `/clear` the new conversation is the previous one's offer, not its heir: nothing is taken up until you say so, and `/waypoint:work resume` takes the seat the task was left on, a second seat too (a conversation that already works a task on its own seat keeps that one). The owner keeps its binding after finishing a task. A conversation that was open before 0.22 has no binding, and no start context, until its next `/waypoint:work`.

The work skill no longer composes the roadmap writes of a task: `waypoint claim`, `done`, `block --why-file f` (which also fills `state/T.blockedReason`) and `heartbeat` print them ready, with `now`, the event ids and the lease, and every heartbeat renews `leaseUntil`. A track session asks `next` with `--base` and stops on `waiting_on` when its next task waits for another track's work that is not in the base yet.

## Hooks

- **SessionStart** (new, resumed, cleared, compacted or forked session) gives the seat's owner the roadmap or draft context with its task; any other session gets one line that says who works the roadmap, or the offer of what an earlier conversation left in progress; the coordinator and the members of a forge execution hear from forge instead. A resumed or compacted conversation reopens its binding, unless it was released.
- **SessionEnd** closes this conversation's bindings, with the reason (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`).
- **PostToolUse** (Bash and PowerShell, only for a command that names git), for the owner only, records in `<seat>/pending-commits.jsonl` the commits made in the worktree of the command: the reflog entries of `HEAD` of a commit (`commit`, `commit (amend)`, `commit (initial)`, `commit (merge)`), a `revert` or a `cherry-pick` after the position it last read (kept in `last-head.json`), that HEAD still reaches, 20 at most. What a pull, a merge, a rebase, a reset or a checkout brings is not the task's, and the first time it counts from the task's claim. It drops the lines of commits an amend, a rebase or a reset took away, but a rebase, also one stopped on a conflict and continued, keeps the task's own commits: each is replaced by its replay, matched by subject, and while the rebase is stopped nothing is dropped. A commit made in the worktree by a person or process that is not a live seat counts for the task. With `core.logAllRefUpdates=false` the reflog is empty and nothing is attributed. What is committed while the seat has no task open is never given to the next task. When another live seat works the same worktree, it records only for a command that makes commits, and never what the other seat had already seen. The work skill records intermediate commits as `commit` events and removes their lines, and empties the file when it completes or leaves a task.
- **Stop**, for the owner only, reminds you once per distinct pending set while the seat's `pending-commits.jsonl` or `queue.jsonl` has lines, so no commit or roadmap write is lost. It never stops a session that coordinates or is a member of an active forge execution, nor the session of forge's infinite run, and the commits of the task you have in progress only count once it is done. Stopping again with nothing new goes through, and it never blocks when the Stop hook is already active.

## CLI reference

The skills run the CLI as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command>`. `bin/waypoint` is a wrapper for shells where the plugin's `bin/` is on PATH.

| Group | Commands |
| --- | --- |
| Design | `design-import <spec> --project P --out D`, `design-validate`, `design-snapshot <design.md> --note n\|--note-file f [--round R] [--applied r<R>:<n,…>…] [--resolved r<R>:<n,…>…] [--rewrite] [--kind k]`, `design-changed` (with `removed`), `design-gate <design.md>` (the `pending`, `dismissed`, `resolved` and `applied` proposals of every round, `majorPending` and `needsVerify`), `critique-next <design.md> [--verify] [--full]`, `design-impact <design.md> --plan P [--since N] [--states DIR]`, `critique-check [--verify] [--changed a,b] [--reject-on-fail]`, `critique-select`, `critique-dismiss <design.md> --round R <all\|1,3> [--reason-file F]`, `design-page <design.md> --out F`, `design-park <design.md>` |
| Plan and page | `validate [--design D]` (warns about tasks without zones: forge runs them alone; with `--design`, warns about a `design_ref` that is not a section of the design, and about a `design_version` or `artifacts.design` that are not the approved design's), `hash` (prints the plan hash, used to detect an out-of-date roadmap), `page [--publish-info --capabilities F [--page P] [--assets] [--no-assets]] [--states DIR]` (the capabilities to publish with, `assets` only with `--assets` or when the published page already has it, never with `--no-assets` (the two together exit 2), the line that says the page becomes internal, and the `meta/page` write whose `rules` and `assets` are those of the capabilities file `F` that was published; with `--page`, the listed `meta/page.json`, `capabilitiesChanged` and the `ask` line when a republish changes who can see the roadmap, or may, when that page does not record `assets`), `sync [--db DIR]` (with the report line: URL and counts; it deletes its earlier batches of `--out` first; with `--db`, `removed`, `missing`, `unknownVersion` and `republish`), `clean-cache`, `doctor <plan> [--fix]` (lists what older versions left under `.waypoint/<project>/`; `--fix` deletes it) |
| Work | `next [--base <branch>] [--messages <dir>]` (with `waiting_on`, and `multi`: another live session, a message for this one, a task an idle session left, or a track worktree), `conflicts`, `recover [--minutes N]` (below 5 it acts as 5), `status`, `commit-info`, `claim`, `done`, `block --why-file f`, `heartbeat [--register] [--busy-until t] [--idle]` (each prints `{now, eid, eids, leaseUntil, batch}`) |
| Sessions | `launch <track> [--base <branch>] [--exec]`, `inbox`, `escalations`, `notes [--plan p] [--locale es\|en]` (with a line to say per person's note), `session-id`, `bind <plan\|design> --via v [--seat s \| --second-seat] [--resume] [--takeover]`, `release <plan> [--seat s] [--free T --state-version V [--keep-seat]]` (`--keep-seat` gives the task back and keeps the seat bound) |
| Helpers | `event-id`, `now`, `hook <session-start\|session-end\|post-commit\|stop>` (what `hooks.json` runs; it reads the event on stdin) |

## Permissions

Optional; add them to `permissions` in `~/.claude/settings.json` so the work skill runs without a prompt for each call:

```json
{
  "permissions": {
    "allow": [
      "Bash(node *waypoint.cjs*)",
      "ArtifactData",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git show *)",
      "Bash(git rev-parse *)",
      "Bash(git merge-base *)",
      "Bash(git ls-files *)",
      "Bash(git worktree list *)",
      "Bash(git branch --show-current)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "deny": [
      "Bash(git push *)",
      "Bash(git reset --hard *)",
      "Bash(git clean *)",
      "Bash(git -c *)"
    ]
  }
}
```

`ArtifactData` is the tool name as this plugin's skills call it. If Claude Code lists it under another name (for example `mcp__…__ArtifactData`), use that name. `deny` wins over every `allow`, also over a skill's `allowed-tools`, and each skill lists only the git commands it runs.

- **`git -C <dir> …` is left out on purpose**, so Claude Code asks for it: the work skill uses it to act on the main checkout from a worktree (the delegation, the phase merge), and that question is your say on a merge into it.
- **With forge**, `"Bash(node *forge.cjs*)"` lets it run without Claude Code asking; put it in `.claude/settings.local.json` of the projects you trust, not in your `~/.claude/settings.json` (forge asks itself before it runs the commands of `.forge/config.yaml`). With it, add `"deny": ["Bash(*forge.cjs* hook *)"]`, which stops Claude from calling forge's hook commands by hand (for example `hook answer`, which records your answers) and does not touch the real hooks, because permission rules never apply to them. To be asked before every final merge and before Claude records a surface permission, add `"ask": ["Bash(*forge.cjs* swarm merge*)", "Bash(*forge.cjs* local set*)"]`. Claude never records your trust in the commands of `.forge/config.yaml`: only your answer does.

## Develop

From the repository root: `npm install`, `npm test`, then `npm run build`, which regenerates `dist/`, `assets/`, `hooks/register.js` and `types/index.d.ts` (commit them).

The band is a mod (`src/mod/register.tsx`, bundled to `hooks/register.js`):

- `claude plugin validate plugins/waypoint` checks the manifest, the hooks module and its state contract.
- `claude plugin test plugins/waypoint` runs `plugins/waypoint/tests/*.test.ts` against the engine.
- `npm run typecheck:mod` type-checks the mods (waypoint's band and lens) and their tests against the engine's API types in `types/claude-code/index.d.ts` (git-ignored); `mod-types check` runs first and says how to get them. `npm run mod-types:update` copies there the newest of the copies Claude Code writes when it loads a mod folder (`claude --plugin-dir plugins/waypoint` writes `plugins/waypoint/.claude-plugin/types/claude-code/index.d.ts`) and, in a linked worktree, the main checkout's `types/claude-code/`.

Bump the version in `plugin.json` on every change: the installed plugin cache is keyed by version.
