# Changelog

All notable changes to the plugins of the bg-kit marketplace. Each plugin has its own version, and one release can
bump several of them at once (forge 0.15.0, waypoint 0.19.0 and lens 0.11.3 shipped together). Dates are the day a
version landed on `main`.

This repository starts at waypoint 0.10.0, forge 0.5.0 and lens 0.5.0. The versions before them were published from
elsewhere and are reconstructed from their READMEs.

- [waypoint](#waypoint)
- [forge](#forge)
- [lens](#lens)

## waypoint

### 0.26.0 — 2026-10-17

#### Added
- Only the roadmap's owner approves proposals: the roadmap declares `approvals/` writable by its owner alone (a rule the server enforces), and `page --publish-info --capabilities F` prints the `meta/page` write (the page's version and rules) the plan skill sends after each publish, with `rules: 2` only when `F`, the capabilities that publish passed, holds that rule; the plan skill passes them on every publish. A roadmap published before this version lacks the rule: republish it with `/waypoint:plan` after upgrading, and only then are approvals owner-only (`sync` asks for it when `meta/page.rules` is below the page's rules version).
- `sync --db` reads the roadmap's listings: it never sets a task document whose version `known.json` lacks (`unknownVersion`; exit 2 when it has to write it), stops on a listing of 1000 documents or on an incomplete one, and prints `removed`, `missing` and `republish` (the published page is older than the plugin or its rules are older, so the plan skill republishes it).
- `plan.yaml` gains `design_version`, `tasks[].design_ref`, `phases[].goal` and `versions[].target`; the roadmap's `meta/project` gains `links` (the design and its version) and `waypointVersion`; `validate --design` warns about a `design_ref` that is not a section of the design.
- `page --states` puts the listed task states in the page's snapshot, with the version that built it.
- The page reads forge's v2 data: the task's forge block (rounds with findings, validators with time and cache, verification, stages, integration, deferred findings) and its evidence by round, `blockedReason`, the start, last step, stall reason and closing of a run, the coordinator of the infinite run, `answeredByNote`, and the metrics in `meta/metrics`; `?debug=1` lists what it drops.

#### Changed
- `waypoint done` prints the metrics apart (`metrics`, an update of `meta/metrics` printed without `if_version`: the skills send it so only to create the document and pin it once it exists) instead of a pinned `meta/project` write in the task's batch, and no longer needs `--meta-version`.
- A task the plan drops keeps what it was (`prevStatus`, `doneAt`, `commits`) and a done one comes back done; `meta/project` is written in the last batch of a sync.
- The skills send the writes the CLI prints and pin them with the newest version they listed; that rule lives in one reference per plugin.

### 0.25.0 — 2026-10-17

#### Added
- The band is a line of parts with a priority, fitted to the cells it has: the least important take a short form and then go, while a pending decision, a silent run and the inbox go last. From 140 columns it is one row with the full buttons, from 90 two rows with short labels; narrower, with fewer than 3 rows above the prompt or outside fullscreen, one row whose buttons fold into ⋯ (`m`). A second row that does not fit takes a second line where the band has 3 rows or more, then clips its widest labels without ever giving two buttons the same one; what still does not fit goes to a further page of ⋯ (`m` again).
- Every button has a letter (`n`, `s`, `l`, `t`, `p`, `x`; `a`, `e`, `o`, `w`, `i`, `y` in design; `v`, `j`, `e`, `f`, `c` in a notice), drawn `n: Next` outside fullscreen, where the hint line ends with `ctrl+x tab · band` and Roadmap (`r`) and Design (`d`) are buttons that copy their address; in fullscreen they stay links, with no letter.
- The run band shows every slot (up to 12; `+N` counts those that do not fit and any running past 12), one integrated count and those waiting to integrate; its model gains `queued`.
- The band publishes whether it is drawn (`{ plugin: 'waypoint', key: 'drawn' }`), so lens draws its own band when this one is closed.

#### Changed
- The coordinator's Stop (`t`), and Close on a run still active, ask twice: the first press shows a toast, the second within 5 seconds runs `/forge:stop`; a run member's Stop still only leaves `/forge:stop` in the prompt. `x` closes the band in every mode.
- A task's clock reads hours and minutes (`9 h 58 m / 30 m`), amber past its estimate; a notice's age is a part of its own (`· 2 h ago`).
- The band's glyphs are one cell wide: ▲, ✎ and ► instead of the warning sign, the envelope and the play button.

### 0.24.0 — 2026-10-17

#### Added
- The run band model carries inbox, escalation, progress and phase, and the seat of the conversation that looks (its own binding's, else the run's coordinator).

### 0.23.1 — 2026-10-17

#### Changed
- `waypoint validate` warns about plan tasks without `zones`: they may touch anything, so `conflicts` counts them against every task in progress and forge runs them alone.
- The roadmap page says «whole repository» for a task without zones, in its session card and its detail; an active forge run that no session drives offers **Resume** at once.

### 0.23.0 — 2026-10-16

#### Added
- The band knows who looks at it (`$.session.id()`) and draws by role. The conversation bound to the seat sees its work band, or its design band while the draft is its own. Another live conversation sees a dim notice instead, «◦ another session (main) works on T019 · 3 min ago», with Status, Other track and the roadmap, or «◦ another session (main) is working on the design» with Status and the roadmap when that one is bound for the design; a forge execution coordinated by another session is a notice with View, and Join (`/forge:run --join`) only on a plan run, since forge's ephemeral run takes no members.
- What an earlier conversation left behind is offered for 24 hours as a notice: a task («◌ left in progress: T019 …») with Resume (`/waypoint:work resume`) and Release T019 (`/waypoint:work release T019`), a draft with Resume (`/waypoint:design resume`, which binds it and shows its state without running a critique), and an execution stopped or without its coordinator with View, Resume (`/forge:run --resume`) and Close (`/forge:stop`). Close on an execution that is still active without its coordinator only leaves `/forge:stop` in the prompt to confirm. An active execution is without its coordinator when the coordinator's conversation ended, or when it went silent: no step nor signal for 12 minutes and no agent running.
- Every band model carries `viewer: { role, coordinator, runId }` (`runId` only when the band is about the execution), and `mode: 'notice'` is a new variant of the published `WaypointBand`; a run notice says whether the run can be joined (`joinable`). In a checkout without a waypoint project the band draws nothing, but it still carries the role from forge's execution, so forge's coordinator reads as `{ role: 'owner', coordinator: true, runId }`.

#### Changed
- A member of a forge execution sees its own task with the line of the execution, never the coordinator's run band. Only the coordinator's band has Stop; a member's leaves `/forge:stop` in the prompt to confirm.
- The coordinator sees an execution that stopped, ran out of budget or finished without a merge until it is closed; anyone else sees it as a notice for 24 hours after it last moved.
- A draft design is drawn only for the conversation bound to it.
- × on a notice is kept in the plugin's store, shared by your conversations, per checkout, project, kind of notice and subject until the notice would end (a day for another session's work and for an offer already past its window), so a new task or execution shows again; × on your own band still lasts the session, and a `/clear` shows it again.
- `/clear` and a resume inside the process no longer stop the band's refresh, and the band shows the new conversation's role at once.
- The band's 30 s tick renews this conversation's live binding once a minute; it never reopens one that ended. The CLI and the hooks read a `bound.json` found empty or half written once more before they give up on it.
- The band strips control and bidirectional characters from the titles it shows.
- The band picks the project of this conversation's binding, else the one with the latest activity.
- A conversation that was open before this version has no binding, so it sees no band until its next `/waypoint:work`.

### 0.22.0 — 2026-10-16

#### Added
- Seats and bindings. `.waypoint/<project>/session.json` is the checkout's seat and `.waypoint/<project>/bound.json` binds it to the Claude conversation that works it; `seats/<sid>/` holds a second seat (`main-2`…). `waypoint bind` never takes a seat a live conversation holds (exit 3, with a track in a worktree, a second seat or an explicit takeover, in that order) and asks before taking up what an earlier one left in progress (exit 4); `waypoint release [--free T]` ends a binding or frees its task. A seat id is a safe folder name with no leading `-`, and a binding that lapsed or whose process is gone counts as ended. `bind --resume` takes the seat an earlier conversation left its task on (a second seat too), unless this conversation already holds a live seat with a task open, which it keeps, and exit 3 names such a task (`previous`) so it can be resumed there. A conversation holds one seat per project: a bind ends its other live bindings there.
- Every hook works out the role of its session: owner, another live one, a previous one or none. A new `SessionEnd` hook closes the conversation's bindings, and `SessionStart` also runs on a fork. The post-commit, Stop and SessionStart hooks act for the owner by binding only, but every one of them renews the conversation's own live binding, whatever its role: a forge coordinator or member keeps its seat through the run.
- `waypoint claim`, `done`, `block --why-file` and `heartbeat [--register] [--busy-until] [--idle]` print the roadmap batch of a task ready to apply (`{now, eid, eids, leaseUntil, batch}`). `done` and `block` need a task of the plan (exit 2 otherwise). `block` also writes `state/T.blockedReason`; `claim --unblock` deletes `blockedBy` and `blockedReason` and puts the `unblocked` event before `started`; `claim` says `solo` when no other session is alive; with `--db` the local cache sees the write at once (an empty `--db` value is exit 2).
- `/waypoint:work resume` and `/waypoint:work release [T]`; `/waypoint:design park` and `waypoint design-park`: a parked design is neither announced nor drawn.
- `next --base` adds `waiting_on` when the next task of a track waits for a dependency of another track that is not in the base yet.

#### Changed
- The start context, the commit records and the Stop reminder belong to the seat's owner: another conversation in the same checkout gets one line that says who works the roadmap, never «Current task… continue», and its commits and stops are its own. After `/clear` the new conversation is offered «left in progress: T» for 24 hours (a binding left with a task comes before a newer one with nothing open) and takes it only when asked. An owner bound for a forge run with nothing open, or for the infinite run, hears one fact at start instead of the work skill's line.
- `/waypoint:work` no longer composes the task batches nor asks for `now` and `event-id` per event; a track session passes `--base` to `next`, and the checks of the main checkout run `git status --porcelain --untracked-files=no` there. It checks its seat at each round (`bind --seat <SID>`) and stops when another conversation took it over, lists `state` again after a refused batch of a command run with `--db` (or of `release --free`), and on a second seat passes `--rev` to `done`.
- A binding lapses 5 minutes after its last renewal. In this version only its own conversation's hooks renew it, at most once a minute and only while that conversation runs them (the band renews it from the next version on).
- One life for a session: every heartbeat renews `leaseUntil`, and a session is alive while the latest of its lease, its heartbeat plus 10 minutes and an older `busyUntil` runs, so an old lease no longer hides a fresh heartbeat.
- The PostToolUse hook records, for the owner, every commit HEAD gained in the worktree of the command (first parent, 20 at most: a merge from main adds only its own commit) and drops the lines of commits an amend, a rebase or a reset took away; `last-head.json` keeps the base per conversation and worktree, and what is committed with no task open is never given to the next one. When another live seat works the same worktree, each seat records only the commits of its own `git commit`, `merge`, `cherry-pick`, `revert`, `rebase --continue` or `am`, and never what another seat (live or ended) had already seen or recorded there; a commit that lands while the other seat's commit command still runs may be recorded by both, never by neither, and a plain `git rebase` there records nothing. The Stop reminder counts a commit once.
- The hooks pick the project of the conversation's binding, else the one with the latest activity; a `session.json` alone no longer wins.
- A binding that was released stays released through a compact and a resume, and `SessionEnd` reads a binding again before it closes it, so a takeover is never undone. `bind`, `release` and `design-park` write atomically and retry a rename Windows refuses; the process check of a binding is the one of `src/lib/pid.ts`. `release --seat` without a value and `design-park` on a missing file are exit 2.
- `waypoint launch` adds `.claude/worktrees/` to `.git/info/exclude` when nothing ignores it.
- A conversation that was open before this version has no binding, and no start context, until its next `/waypoint:work`.

### 0.21.0 — 2026-10-16

#### Added
- A plan task takes `delicate: true` (`waypoint validate` accepts it; the roadmap ignores it): forge gives it a stronger implementer and a deeper correctness review.

#### Changed
- The Stop hook no longer stops a session that coordinates or is a member of an active forge execution, nor the session of forge's infinite run: forge's own Stop hook steps those. The commits of the task the session has in progress no longer count either; they are recorded with its completion.
- `waypoint launch --swarm` is obsolete: still accepted, with a warning, it no longer changes the prompt. `/waypoint:work` lost its «Swarm member» setup, and the forge execution item of §0 is now §0.5.
- With forge 0.19's `swarm.validateJobs` in `.forge/config.yaml`, waypoint still reads the config (it bundles forge's schema).

### 0.20.2 — 2026-10-16

#### Fixed
- With forge 0.18's keys in `.forge/config.yaml` (`threatModel`, `review`), waypoint still reads the config (it bundles forge's schema): `evidence: local` keeps the roadmap free of uploaded screenshots.

### 0.20.1 — 2026-10-16

#### Fixed
- With forge 0.17's keys in `.forge/config.yaml` (`validate`, a validator's `cache` or `affected_cmd`), waypoint still reads the config (it bundles forge's schema): `evidence: local` keeps the roadmap free of uploaded screenshots.

### 0.20.0 — 2026-10-15

#### Added
- `design-snapshot --applied r1:4,5 r2:2` and `--rewrite` record in `design/changelog.json` which proposals of which rounds an entry applied, and whether its rewrite folded in its round; `design-gate` and the band read them first. A number its critique lacks, a round after `--round`, a missing critique or a list without `--round` exit with code 2 and write nothing.
- `/waypoint:design apply r1:4,5 r2:all` applies proposals of several rounds with one snapshot; `approve` applies the pending ones of every round that way.
- The roadmap takes `?debug=1` (in the query or the hash, kept when the hash changes): a list of what the page dropped or corrected in each document.
- The roadmap's task detail has ↻: while it is open, new data waits for it (or for the detail to close) instead of repainting under you.

#### Changed
- `waypoint launch` no longer adds «forge drives this session» to a track's prompt, nor reads it from the design's `start_prompt`; `--forge` and `--no-forge` are accepted and do nothing. A track of a plan that a forge execution runs joins it as a manual member.
- The roadmap keeps the scroll of every list, the timeline, the versions board and the detail when it repaints, and its 30-second timer only updates the relative times (a full repaint every 5 minutes).
- Versions draws each category as one proportional bar, and a phase without categories lists its tasks directly. The Execution block of Sessions is its own section, and a plan slot opens its task.
- The timeline shows each phase id once, with the phase header fixed while you scroll, wider label column, edge ticks inside the edges, bar labels that stop before the now line and the forge badge in the left column. The minimap draws one row per phase (per track past 24 phases).
- The band stops drawing a forge execution once it is closed, and draws a stalled one for 24 hours at most.

#### Fixed
- Design proposals applied in rounds whose note is in Spanish («ronda 1: aplicadas 1,3») are no longer counted as pending.
- The roadmap accepts the validators forge writes without a result (shown as «no result») and numeric verification checks, instead of dropping them.
- A decision note is labelled «auto» only when forge took it alone; the person's are labelled «yours».
- The task detail stays above the side bar on a phone, its header with ✕ stays in view, and long paths no longer widen it at 390 px; the side bar stays in view on a desktop with A−/A+ at its foot.
- `npm run typecheck:mod` compiles against `types/claude-code/` (`npm run mod-types:update` takes it from the engine's copy or from the main checkout), so it passes in any worktree.

### 0.19.1 — 2026-10-14

#### Fixed
- A `.forge/config.yaml` that declares forge 0.15.2's `generated` list is read instead of rejected.

### 0.19.0 — 2026-10-14

#### Added
- `launch <plan> <T> --task` takes `--effort` (`low`, `medium`, `high`, `xhigh`, `max`) and `--model` (`opus`, `sonnet`, `haiku`) and puts them in the `claude --bg` command it prints and runs, so a forge run member no longer inherits the person's effort; any other value exits with code 2.

#### Changed
- A forge run member is launched with `/forge:member` instead of `/forge:run`.
- `/waypoint:work` points a manual member and the forge loop at forge:run's references (`references/manual-member.md`, `references/large.md`).

### 0.18.1 — 2026-10-13

#### Fixed
- The band shows forge's ephemeral executions (independent requests run in parallel), with their loose task ids clipped so a long id no longer widens the line.
- The plan's language is read from `plan.yaml` and accepted only when it is a valid language code, so a malformed `locale` no longer changes the language the CLI replies in.
- An execution keeps the person's language code in its state, so the band and the replies that read it stay in that language.

### 0.18.0 — 2026-10-13

#### Added
- The roadmap detail of a done task says how long it took against its estimate (in amber when it went over), and the detail of a claimed or in-progress task says how long it has been running.
- The Execution block and the Loose tasks section show how long each task has run, the slot durations and, once finished, the time each loose task took.
- `design-gate` counts the `pending` proposals of every round, and `sync`, `notes` and `page [--publish-info]` hand over the lines to tell the person; `notes` takes `[--plan p] [--locale es|en]`.

#### Changed
- A proposal you do not apply stays pending across rounds: the band counts the pending ones of every round, the next critic does not repeat them, and `approve` lists the critical and major ones still open.
- `/waypoint:design approve --auto` approves without asking only when no critical proposal of any round is left unapplied.
- The skills print the lines the CLI hands over (plan gate, roadmap notice and report) instead of paraphrasing them.

#### Fixed
- Task detail and loose task times guard against junk, future and sub-minute values.

### 0.17.0 — 2026-10-13

#### Added
- `waypoint design-gate <design.md>` says whether a design can be approved without asking, from its changelog and critiques.
- `/waypoint:design approve --auto` uses that gate under forge's auto mode.

#### Fixed
- `design-import` refuses an invalid design with exit 2.
- A brief never fails on the TDD lookup.

### 0.16.0 — 2026-10-13

#### Added
- `/waypoint:design new --from <spec>` and `waypoint design-import <spec> --project P --out D` turn a superpowers spec into a draft `design.md`, copying its sections as they are and recording its source.
- The design page names the spec a design was imported from («Imported from»).

#### Fixed
- The band lists the main checkout's `.forge` once per refresh instead of once per worktree.

### 0.15.0 — 2026-10-13

#### Added
- Any band ends with `⚑ auto · N · <the last major decision>` when forge decided something without asking in the last day.
- Roadmap notes carry forge's automatic decisions, with what was chosen, why and how to undo it.

### 0.14.0 — 2026-10-12

#### Added
- The Tracking view has a **Loose tasks** section for forge's ephemeral executions, with the title, status, stage and agent of each request, outside the plan's progress.

#### Changed
- The Run row of the band counts tasks integrated out of the plan's total and drops the loose pill clause.

#### Fixed
- The roadmap never takes a loose slot's title or lease from the plan.
- `launch` resolves the launcher before creating a worktree and refuses unsafe plan paths.

### 0.13.0 — 2026-10-12

#### Added
- `launch <plan> <T> --task --run R --coordinator SID --base B [--launcher bg|herdr]` starts one forge session per task of an execution, in `.claude/worktrees/task-<T>` on `task/<T>`.
- `launch --launcher` picks `claude --bg` or a herdr pane.
- Executor and manual sessions show in the band and in lens with their own liveness.

#### Changed
- The band's swarm mode is now the run mode.

#### Fixed
- The roadmap drops a task execution whose `since` or `leaseUntil` is not a date.
- A coordinator waiting on a long agent reads as alive.

### 0.12.0 — 2026-10-12

#### Added
- The Sessions view shows the role of each session (coordinator, executor or manual) and its liveness, derived from leases.
- An Execution block lists each running task with its stage, agent and time, the slots in use out of the maximum and the free ones; orphaned tasks are flagged.
- The band has a run mode: `▶ EXECUTION · subagents 2/3 · T004 review (r2) · … · 3/12 · integrated 3`, with the worst liveness of the run.

#### Changed
- The band's Swarm row becomes the Run row, and the docs point to forge's execution modes.

### 0.11.1 — 2026-10-12

#### Fixed
- The roadmap accepts evidence URLs only from the claude.ai asset host or `/_blob`.
- The evidence indicator shows upload pending before local-only, and counts local screenshots.
- The band and lens keep the project's language while no band is drawn.
- Fixes from the Reparto test run in `launch`.

### 0.11.0 — 2026-10-12

#### Added
- Verification evidence on the roadmap: a task verified by forge shows a Verification block with the result, the surfaces used, each check with what was expected and observed, and screenshots as thumbnails that open in a lightbox.
- An evidence indicator in the Tracking view.

#### Changed
- The README installs the marketplace from GitHub.

### 0.10.0 — 2026-10-12

#### Changed
- First version in this repository: the README is rewritten with a contents list, badges, a roadmap screenshot, the commands and views as tables, and a CLI reference grouped by purpose.
- A Spanish README (`README.es.md`) joins the English one.

### Before this repository
*Reconstructed from the published READMEs; no commit history.*

#### 0.9.0
- The roadmap header and side nav show a `∞ cycle N` pill (with `/M` when the run has a cycle budget) while forge's infinite run is active, and drop it when the run ends.

#### 0.8.0
- A Proposals view lists the improvement proposals from forge's scout or from people, newest first, with filters by status, category and risk.
- Each card shows the category, risk, status, pillar, rationale, evidence, estimate, path, who decided it and its comments; contributors can approve, reject or comment.

#### 0.7.1
- No change to the README or the commands; a maintenance release.

#### 0.7.0
- Initial release: `/waypoint:design`, `/waypoint:plan`, `/waypoint:work`, `/waypoint:status` and `/waypoint:launch`.
- A live roadmap artifact with Tracking, Versions, Sessions and Notes views, coordinated by messages between parallel sessions.
- The band above the prompt in design and work modes, with a lens **Panel** button.
- Hooks that record commits (PostToolUse) and remind of pending writes (Stop), and a SessionStart context injection.

## forge

### 0.22.0 — 2026-10-17

#### Added
- `FORGE roadmap-doc <T>` writes the task's `state/T` update, built by the CLI: a forge block of at most 4 KB (brief, stage, review rounds with their findings and reviewers, the accepted round, validators with time and cache, verification, stage times, integration, deferred findings), the evidence of every check by round (`--assets` adds the uploaded screenshots and keeps them) and its `exec`. `swarm task`, `report`, `step`, `integrate` and `merge` print the same `publish`, `swarm task` and `report` take `--claim`, and `swarm status` prints `meta/run`.
- `FORGE roadmap-run --run <id> | --task <id>` writes `runs/<runId>`, the summary of a run once it ends (or of a task closed outside one), and `cleanup`, the executor sessions to remove; `swarm close` prints it.
- `infinite start`, `cycle` and `infinite status` print `meta/infinite` with its coordinator (seat, Claude's id and lease).
- `swarm integrate` keeps the integrated `sha` and prints `meta/metrics` apart; the roadmap knows when a task is done but not merged yet.
- `decision add --session <SID>` prints the decision note and, with `resolves`, the update that closes the question it answers.
- Only the roadmap's owner approves: `proposals decide` and `policy` print the owner's mark (`approval`: status, `decidedAt`, `by` and a SHA-256 `digest` of the proposal's id and decided fields, so a proposal edited after its approval is no longer approved), `decide confirm` marks an earlier decision, `proposals pull --approvals --page` copies the marks, and `to-task`, the infinite run and `proposals list` (`unowned`) count only proposals whose mark agrees with them. `to-task` refuses a spent proposal (one already turned into a task). `reopen` prints the deletion of the remote mark, and a mark counts only if this checkout's latest decision for the proposal matches it. A roadmap published before waypoint 0.26.0 lacks the owner's rule: republish it with `/waypoint:plan` after upgrading, and until then no mark counts.

#### Changed
- Auto-approval fails safe: only proposals forge itself added are auto-approved, and only with objective signals (a tests proposal names a test file); nothing that proposes deleting or migrating data, or touches a sensitive zone by its path or its words, and no lookalike of a rejected or open proposal, is approved without you.
- The skills no longer compose `state/T.forge`, `evidence`, `meta/run`, `runs/`, `meta/infinite` or decision notes: they send what the CLI prints and pin it with the newest version they listed. Forge's blocking paths give their reason (`waypoint block --why-file`) and members finish with `waypoint done`.
- A task past its review cap keeps publishing (`overCap`); `swarm merge` prints each integrated task's block with `merged: true` for the skill to send; decisions are logged only when the owner takes them (`proposals save` only mirrors); `swarm close` and an ended run's `swarm status` print the writes that free the coordinator's tasks; `proposals policy` says why it refuses (`reason`); verification uploads count only for their own run and round.
- Requires waypoint ^0.26.0.

### 0.21.1 — 2026-10-17

#### Changed
- Requires waypoint ^0.25.0.

### 0.21.0 — 2026-10-17

#### Added
- Per-task status in `.forge/status/<key>.json` (`<project>__<T>` for a plan task, `<T>` for a loose one); `status.json` stays as the latest task's alias. An older `status.json` is moved to its task's file on the first event, and past 200 files the 150 newest stay.
- `review-prep` and `swarm step` print each spawn's `taskLine` (`forge-task: <T>-<n> @<project>`), the line that starts the agent's prompt; the task steps, `forge:member` and `forge:review` ask for it.
- A task's status keeps who reviews it, the review count and the findings of its verdict by severity, whether a validator came from the cache, and the verify surfaces skipped: with every planned surface skipped the verification is `skipped` and a light task is done.

#### Changed
- A member's task status reaches the main checkout; the route hint sees this session's open task among all of them.
- The route hint skips, unread, the task statuses untouched for a day.
- Requires waypoint ^0.24.0.

### 0.20.0 — 2026-10-17

#### Added
- `forge swarm cleanup [--dry-run]` removes forge's task and run worktrees, and its `task/*` and `forge/run-*` branches, once they are merged into the branch of the main checkout, with `git worktree remove` and `git branch -d` only. What git refuses, a branch not merged, a worktree with changes and waypoint's tracks stay, listed in `kept` with their reason. It also prunes the state of ended runs, the diffs and validator runs of the removed tasks and the baselines of `.forge/execution/baseline/` older than 7 days. The end of a run offers it. It exits with code 2 while an execution is active, a merge is in flight, a background job is live or a step holds `step.lock`, and keeps a worktree whose ledger has events the main one lacks (`unmerged ledger`). A new `swarm start` prunes the state of other runs.
- A task resumed on its branch is reviewed with the commits of its earlier attempt: `swarm worktree` takes BASE at the merge-base with the run branch and prints `resumed` and `prior`, and `FORGE brief --prior-file` adds a «Previous attempt» section.
- Every event the CLI writes carries `session` (Claude's id), `runId` (when its task belongs to an execution) and, for a plan task, `project`; `.forge/status.json` gains `session`, `runId` and `project`.
- `forge stop` prints JSON: what it stopped, `release` (the `state/T` writes of the coordinator's tasks), `members` and `running` (the run's background jobs still running; it kills none). `swarm close` also prints `sessions`, the run's members to message.

#### Changed
- A plan task is the pair (project, task): its work folder is `.forge/work/<project>/<T>/` (a loose task keeps `.forge/work/<T>/`), `triage --task`, `swarm worktree` and `swarm relaunch` print it as `work` (`swarm status` as a `work` map from task to folder), and rounds, the ratchet, stats and resuming read only the events of that project. Older folders and events are still read.
- `/forge:stop` works from any worktree and stops an execution for real: its running tasks become `stopped`, their leases end and the run's members are removed. `swarm close` and the end of a run release `stopped` tasks too. `infinite start`, `infinite status`, `cycle`, the Stop hook and `swarm status` read the run and the execution of the main checkout.
- A run member's events go to the main checkout's ledger, and its verification evidence is copied there (at most 50 MB per call).
- forge's route is per session, in `.forge/route/<session>.json`: `route set` and `route stage` need the session (`--session`, else `CLAUDE_CODE_SESSION_ID`; without one they exit with code 2) and never touch another one's. The routing rule stays out of forge's task and run worktrees and while the session has a forge task open; after `/clear` (within 2 minutes) or in a fork it names the route the earlier conversation left half done.
- The live hook speaks by role: a session that does not coordinate the execution is told that it runs under another session, or that it lost its coordinator or stopped, with `/forge:run --resume` and `/forge:stop` as the ways if you ask. `/forge:run --resume` has its own steps.
- The forge Stop hook keeps an agent alive while its task's lease runs, at most 90 minutes after its last report.
- A resume from another conversation, or a takeover with the coordinator's id, rebinds the run only once the bound conversation stopped. `swarm status` and `infinite status` say `unbound` when no session drives an active run. An ephemeral run closes when it finishes. `swarm takeover` no longer reads the roadmap lease: its usage drops `--db`, still accepted for this version.
- A plan task without zones runs alone.
- `swarm retry` refuses a stopped run, and a stalled one from another conversation while its coordinator is still on it (`swarm status` prints that `coordinator`); an active run no session drives has no coordinator at once; `swarm cleanup` checks only the evidence it copies, keeps waypoint's tracks, stops if a run becomes active meanwhile and prunes only for its own worktrees; a new execution of a plan task counts only its own reviews; `swarm worktree` refuses another plan's `task/<T>`.
- Requires waypoint ^0.23.1.

### 0.19.2 — 2026-10-16

#### Changed
- Requires waypoint ^0.23.0.

### 0.19.1 — 2026-10-16

#### Changed
- `/forge:run`, `/forge:member` and `/forge:infinite` bind waypoint's roadmap seat to the conversation that runs them (`waypoint bind --via forge-run|forge-member|forge-infinite`), so the band and the start context of the roadmap are theirs and no other session's. The coordinator and the infinite run bind before they start: when another live conversation holds the seat they ask once (a second seat, recommended; take over; stop; in auto, the second seat); when an ended one left a task there they resume it; and the seat they get is the run's SID. A relaunched member resumes its own task's seat.
- `swarm start` and `swarm worktree` add `.claude/worktrees/` to `.git/info/exclude` when nothing ignores it, asking git at the main checkout.
- The `hook live` and `hook route-session` SessionStart hooks also run on a fork.
- Requires waypoint ^0.22.0.

### 0.19.0 — 2026-10-16

#### Added
- `swarm step`: one step of a plan execution in one command, run in the background. It renews the leases, prepares the review of each implementer that came back (or hands over its report), closes the reviews that are back, starts the tasks the tick schedules (worktree, brief, triage and prep) and integrates at most one, and prints the actions and the data of the roadmap batch. It waits for the reviewers it respawned, takes up a task a previous step left at `brief` or `validate`, and after a conflict retry reviews from the base the task merged. It also:
  - takes the person's answer with `--ruling <T>:fix|out-of-model|defer:F3[+F5]|review`: a question (`ask`) waits in `asked.json` and nothing is closed for that task until it is answered; «keep the architecture» re-closes the round with `--defer`, and `review` prepares a new review on the same HEAD for an implementer that came back without a commit;
  - waits for a verification `verify-plan --dir` planned (`verify-pending.json`) and closes it with `verify-close`, committing its learned notes in the task's worktree and attaching its output (`verify`) to the action;
  - reviews a member's task adopted after a conflict from where it forks from the run branch, with a baseline run there;
  - runs one at a time: `.forge/jobs/step.lock` (another step prints `{busy: {pid, startedAt}}` and runs nothing);
  - emits `integrated` again for a task whose roadmap state is not `done`.
- `--out <file>` on `prep`, `review-prep`, `validate`, `swarm integrate` and `swarm step`: the command runs as a job of `.forge/jobs/` while the coordinator waits in the background, writes its JSON to the file (with `waitedMs`) and waits for one of `swarm.validateJobs` validation slots (2 by default). The Stop hook does not block while a job of its session is alive. `validate` refuses a `--out` that is not the one right after the command.
- A clean session for the coordinator: the start questions are answered once in the design session and kept in `.forge/work/<project>/launch.json`; `/clear` and `/forge:run --execute <project>` start the run with them.
- `verify-close`: the learned notes, the cleanup, the result and the list of screenshots of a verification in one call.
- `setup [--cwd dir]`: installs a worktree's dependencies as `swarm` does; `/forge:review` uses it.
- `route --text-file` probes a request without writing anything and prints `probe`, `stepAside` and one question in two parts (`ask`); `route set --remember` keeps the choice as the project's `workflow`.
- `swarm propose` prints the plan's width wave by wave (`profile`), its longest chain, the zones that serialize it, `mostlySerial` and a `say` line; a mostly serial plan offers to replan.
- `delicate: true` on a plan task: `triage --plan` gives it `impl-high` and correctness at xhigh, and `brief` says so. The planner reads `FORGE stats --json` (the fixed cost of a task here) and marks it.
- `review-prep` of an express review writes the validation command it prints to `review-plan.json` (`validatorsCmd`), so the coordinator reads it again from there.

#### Changed
- Every write of `.forge/execution.json` that depends on what it holds takes `.forge/execution.lock` (30 s, retried for 10 s, then exit 2), so a tick, a `swarm task` and an integration in the background never overwrite each other; `swarm task` and `swarm retry` change only their own fields.
- The coordinator runs `swarm step`, `prep`, `review-prep` and `swarm integrate` in the background, asks mode, final merge and where to run in one question, and turns a doubt that blocks nothing into a question note; a message from the person during a run first marks a sleep. Every coordinator turn ends with a marked sleep, and `/forge:infinite` cycles run the single commands in the foreground.
- The planner no longer creates tasks under about 15 minutes, keeps chains short, gives each task its own test file and scales `estimate_min` with the measured ratio.
- forge:route costs one call and one question; a request it steps aside from, or one routed to «no forge» without remembering it, leaves no `.forge/` behind.
- Medium briefs run in parallel only when three are independent, or two of more than about 20 minutes each.
- `/forge:infinite` cites forge:run's decisions reference and the «A Large task» row of Unattended instead of repeating them. The old `/forge:run --plan … run member of` prompt and «→ Run member» are gone from the skills.
- `review-close` exits 2 and removes an express validators file that holds no results.
- `swarm merge` answers `busy` (a JSON result, like `main-dirty`) while an integration is in flight, instead of exiting 2.
- A stale `.forge/execution.lock` is taken over by one process at a time (`execution.lock.takeover`); the Stop hook waits for a live one at most about 2 s and then lets the session stop; the one-time `swarm.json` migration never overwrites an `execution.json`.
- `route --text-file` cleans its probe on every exit 2 too and reports `cleaned: true` once the task file is gone; it asks (`ask`) when `workflow` names a superpowers option that is not installed; `route set` reads `--why-file` before it writes `local.yaml`.
- Requires waypoint ^0.21.0.

#### Fixed
- An integration whose process died in the middle of its merge no longer blocks the run as `run-dirty` forever: the next one aborts that merge (only one of its own, in the same worktree, with HEAD where it started) and says `recovered`; no tick integrates while a merge is in flight. `.forge/execution/merging.json` is exclusive for a whole integration (phases `baseline` and `merge`), and an integration checks HEAD and `MERGE_HEAD` again once it holds it.
- A `redo` after a conflict retry no longer stops on the merge commit the retry made: when the attempt's range holds a merge, `review-close` prints `revert.steps` (`read-tree -u --reset <base>`, then one commit) that restore BASE's tree, keeping the run branch's work, instead of `git revert` over the range (`revert.args` stays for the rest).

### 0.18.0 — 2026-10-16

#### Added
- Stable finding ids: every critical and important finding of a brief keeps an id (`F1`, `F2`…) across its reviews, in `findings-index-<n>.json`; a delta reviewer gets its open findings with their ids and copies them.
- `threatModel` in `.forge/config.yaml` (what it protects, which is required, who and what it trusts, what it does not, what is out of scope): `forge brief` and `prep` hand it to the brief and the security reviewer, which marks what is outside it `outOfModel` (minor). Without one, the person at the keyboard and the local machine are trusted and the inputs from elsewhere are not.
- An express review: when a fix leaves one or two important findings with file and line, none from security, one correctness reviewer on Sonnet at medium checks them while the validators run in the background (`review.express: false` turns it off).
- `review-close` writes `handover-<n>-<round>.md` for a new implementer (`fresh-stronger`, `redo`), prints `revert` for a redo and `ask` when security repeats a theme it already closed, and takes `--out-of-model` and `--defer` (each only for an id of that review or one the previous review left open) and `--locale`. `forge shadow collect` saves the shadow twins that come back after a review closed. `review.personDocs` lists the docs written for people.
- `reviews: {n, max}` in the output of `review-prep` and `review-close` and in the `verdict` and `round` events.

#### Changed
- What blocks depends on the review: a critical always; an important in review 1, a previous one still open in review 2, and any new problem the fix brought (a finding of the fix that matches nothing already closed, or one marked `regression`); from review 3 only criticals and those new problems. Hardening of a class the same reviewer closed (from security, forge asks you instead), an important finding only in the docs for people and what is still open at the last review stay as `residual` and are handed over in `deferred`, with the findings out of the threat model; the last review accepts a fix with green validators and no critical.
- The first review after a redo judges the new attempt as a first review: nothing of the reverted attempt stays open or is matched, and what it closed never makes a later finding `hardening`.
- `stalled` compares the blocking findings by id, not their text or the score; `redo` needs a failing reviewer that says the approach is wrong with a finding that blocks; a fail without a critical or important finding is `invalid` (the rubric) and runs again once.
- Reviewers share a verdict rule and a confidence scale, have severities of their own and run at most one focused test file instead of repeating the validators. Implementers follow a «Fix round» section, write the failing test first only under `TDD: required`, and reply in two lines.
- Shadow twins no longer hold a review: `review-close` lists the ones still out in `shadowPending`.
- A brief gets up to 4 reviews on Medium and 5 on Large, and the skill and the README count reviews.
- Requires waypoint ^0.20.2.

#### Fixed
- A redo no longer starts a new brief number: `review-close` prints the `revert` git arguments and the skill runs them as printed.

### 0.17.0 — 2026-10-16

#### Added
- A validation cache by tree (`.forge/cache/validate` in the main checkout): a validator's result is kept under the tree of a commit with nothing uncommitted, the directory its validators run in (relative to the checkout's root), its command, the lockfiles and the platform, and `prep`, `review-prep`, `validate` and `swarm integrate` read it, so the tree a review validated is not validated again by the next brief's baseline or by the integration. `bench`, a timeout, an `--affected` pass and an `e2e` validator without `cache: true` are never cached; `validate --final` writes it and never reads it; `--no-cache` (on `validate`, `prep`, `review-prep` and `swarm integrate`) and `validate.cache: false` turn it off.
- `forge stats [--days N | --since ISO] [--json] [--locale es|en]`: per accepted brief and per path, the time in `implement`, `validate`, `review`, `verdict` and `fix`, the validators' share of the clock and the cache hits, the clock and the fixed cost of a brief accepted at its first review, and real over estimated time of the plan tasks.
- The ledger records, once per brief, the phases `validate` and `review` (with the reviewers) from `review-prep`, and `verdict` and `fix` from `review-close`; every `validate` event carries `durationMs`, `cached` and `scope`, and per result its clock, `cached` and the failing tests; `swarm integrate` logs its baseline and its merged validation.
- A validators round: when `review-prep` finds validators red that the base did not have, nobody reviews; it prints `validatorsRound` and the implementer fixes them first, at most twice per review and without counting against the cap.
- `prep` prints `validate`, the exact command the implementer runs, and takes `--no-baseline` (the Small path); `validate` takes `--out <file>`; `validate`, `prep`, `review-prep` and `swarm integrate` take `--no-cache`; a validator takes `affected_cmd` and `cache`; the config takes `validate.cache`, `validate.parallel` and `validate.retry`.

#### Changed
- `validate --affected` runs the tests related to what changed (`vitest related`, `jest --findRelatedTests`, the changed test modules for pytest, `test_*.py` and `*_test.py`, the changed packages for go, or a validator's `affected_cmd`) instead of the whole suite; without a list it takes the files changed since `--base` and the untracked ones, relative to the project's directory. A path a shell could misread, or one starting with `-`, runs that validator in full. A test validator with nothing related to run is skipped as `not-affected`, and `review-prep` runs it in full. Implementers run the command `prep` prints and never the whole suite.
- Validators run in a parallel batch (`typecheck`, `lint`, `test` and `other`; 3 at once by default), then `build`, `e2e` and `bench` one at a time. A failure is retried only when that validator was flaky in the last 30 days (`validate.retry`).
- `swarm integrate` validates the run tip and the merged tree through the cache: a merge whose tree the task's review already validated runs nothing after it. The per-sha baselines of `.forge/execution/baseline/` are read for one more version and no longer written.
- Requires waypoint ^0.20.1.

#### Fixed
- A validator already red on the base no longer excuses every failure: only the tests that already failed (by name, or by the failure lines when the names cannot be read); a new failing test blocks and is named in `newFailing`. A pytest setup or fixture error (`ERROR <file>::<test>`) is a failing test; a tsc error without a location, a build, or more than 200 failing names are compared by their lines; a run that prints nothing is excused only by a base that printed nothing either.
- `validate --affected --base <sha>` no longer falls back to the whole heavy set.
- The run skill writes BASE out literally (`<BASE>`): a shell variable did not survive between Bash calls.
- `scripts/usage-report.mjs` ranks sessions by the sum of their loops, with the recorded cost in its own column, and adds the time by forge stage.
- This repository's `typecheck-mod` validator does not use the tree cache: it reads `types/claude-code`, which git ignores.

### 0.16.0 — 2026-10-15

#### Added
- `forge swarm close` closes an execution that ended (stalled, stopped, out of budget or finished without a merge) from any worktree, and lists the tasks whose roadmap state goes back to free (`release`) and the members' tasks (`members`). It never touches git. `/forge:stop` uses it: it stops an active execution and closes an inactive one.
- `swarm integrate` prints the integrated `commit` (`sha`, `ts`, `title`, `add`, `del`), measured as what the task brings; the coordinator writes the task's `summary` and the roadmap's last commit with it.

#### Changed
- An execution is bound to the Claude session that starts, resumes or takes it over: `swarm start` and `swarm takeover` take `--hook-session <id>` (the skills pass it; the CLI also reads `CLAUDE_CODE_SESSION_ID`) and exit with code 2 without one. The infinite mode is bound the same way by `infinite start --session`. The Stop and SubagentStart hooks no longer bind the first session that stops or starts an agent.
- `swarm start` never hands an active execution to another session after 15 minutes: it exits with code 2 and names `swarm takeover`, which checks that the coordinator stopped.
- `swarm merge` closes the execution it merged; `swarm start` over an ended execution nobody closed says which one it replaces (`replaced`).
- Stopping, stalling or running out of budget frees the coordinator's tasks on the roadmap and publishes the run as inactive.
- lens and the band draw a stalled execution for 24 hours at most, with its clock stopped at its last step, and never a closed one.
- Requires waypoint ^0.20.0.

#### Fixed
- `swarm retry` (and `--adopt`) refuses a closed execution, and `swarm close` of an ephemeral run releases no tasks.
- A manual member joins again (`/forge:run --join`): the reference no longer passes an empty `--hook-session`.

**Upgrading during a run.** Under 0.15.x almost every running execution or infinite run was already bound by its first Stop or SubagentStart and keeps working. Only one that 0.15.x had not bound yet has no session: an execution keeps stepping on its own wake-ups and agent returns, and is bound again the next time its coordinator resumes it (`swarm start`); an infinite run stops chaining cycles, so run `/forge:infinite` again and the new start replaces it.

### 0.15.2 — 2026-10-14

#### Added
- `generated` in `.forge/config.yaml`: globs of tracked files that are build output. After each validator run forge puts back the ones the validators rebuilt, also in your own checkout (an ephemeral run's `swarm integrate`, `validate`, `prep`, `review-prep`), and lists them in `restored`; there it never touches a file outside the list.

#### Changed
- forge:run's tool verification (surfaces, permissions, the verify agent, learned notes and evidence) lives in `references/verify.md`, read only when `verify-plan` finds something to verify, so the core is about 21 KB.
- Requires waypoint ^0.19.1.

#### Fixed
- A plan task takes its sensitive zones from its title as well as from its paths, so a task titled with a real login keeps the security review; its description still sets none.

### 0.15.1 — 2026-10-14

#### Added
- `forge-review-final` (Opus, xhigh, 80 turns) runs Large's final review and its re-review with a turn budget of its own; the `review-final` role resolves to it in every profile.
- Reviewers write a first verdict early (`"complete": false`) and update it as they go; their last write says `"complete": true`. `review-close` and `verdict` print `incomplete`, and an incomplete reviewer is respawned once and picks up its own draft.

#### Fixed
- Validating in the run worktree (`swarm integrate`, a final merge checked there, `validate --cwd` on it) no longer leaves modified the tracked files a validator regenerates, such as a build's bundles: they are restored and listed in `restored`, so the next integration is not `run-dirty`.
- The triage no longer takes a mention for a request: quoted words, identifiers such as `review-perf`, reviewer names and prohibitions («No toques los bundles…») set no zone, no perf review and no mechanical character; Large wording and the mechanical character read only the task's opening sentence; a plan task takes its zones only from its paths and its diff, and its perf and mechanical character from its title.
- A raise logged with `log --kind triage` takes the plan's project, so `triage --plan` keeps the raised path for that plan task.

### 0.15.0 — 2026-10-14

#### Added
- `forge-impl-high` (Opus, high effort), a fifth rung between `impl` and `impl-heavy`: a Medium task or a plan task on a sensitive zone starts there.
- `swarm.member: {effort, model}` in `.forge/config.yaml`: a sessions-mode member is launched at its own effort (medium by default) and, when set, on its own model; `swarm tick` (each `start`) and `swarm relaunch` print `launch`, the full `waypoint launch` arguments.
- The `forge:member` skill, with only what a run member needs, and `references/task-steps.md`, a task's steps shared with forge:run; a resumed member is told to resume with `/forge:member`, and an old `/forge:run --plan … — run member of …` prompt still works.
- `FORGE review-prep` and `FORGE review-close` run a review round in two calls: validators against the baseline, the diff, who reviews and how (`spawn` with `agent`, `model`, `effort` and `mode`), carried results; then the verdict, the round, the findings for the implementer and the `deferred` ones.
- `FORGE prep` records `BASE`, the phase and the validators' baseline in one call.
- Fix rounds review only the fix: from round 2 a reviewer that failed repeats in `delta` mode with the fix diff and its own earlier findings, each finding carries its `origin` (`previous`, `fix`, `untouched`), correctness always repeats, and security or perf that passed repeat only when the fix enters their ground (else their result is carried).
- An important finding in code the fix did not touch no longer opens a round by itself: when it is all that is left the task is accepted and the finding is handed to the person as `deferred`. A critical finding always blocks.
- `FORGE shadow start [--tasks N] | stop | report`: a trial that runs an xhigh twin of each high reviewer on the first round of the next N briefs, pairs their blocking findings and reports per reviewer what high recovered and missed. The twin never counts in the verdict.
- `round` prints whether the attempt is the `last` one and the next `implementer`, read from the ledger and resolved through the profile.
- `scripts/usage-report.mjs` (in the repository): cost per agent and per session from lens's usage files.

#### Changed
- Every forge agent pins its `model` and `effort`: `forge-mech` low, `forge-impl-light` medium, `forge-fable` high; the reviewers' frontmatter is high.
- Reviewer effort follows the risk: correctness high (xhigh on sensitive or delicate work and in Large's final review), security high (xhigh on `auth`), perf medium; the `quality` profile puts them all on xhigh. Every triage prints `review`, also a Medium task outside a plan, and the review launches exactly those reviewers with their model and effort.
- `/forge:review` follows the triage's review, sized by the branch's real diff (`triage --base`): one light Sonnet review below Medium, else the reviewers at the effort of the table above, and perf when asked (also below Medium). `triage --delicate` marks the work delicate, so correctness reviews at xhigh.
- `impl-heavy` (xhigh) is kept for the last attempt before the breaker (round 3 on Medium, 4 on Large) and for the fix of Large's final review.
- The `economy` profile steps implementers down one rung (`impl-heavy` → `forge-impl-high`, `impl-high` → `forge-impl`, `impl` → `forge-impl-light`) and `quality` steps them up (`impl` and `impl-high` → `forge-impl-heavy`).
- In an execution, each stage change is published in one ArtifactData batch.
- forge:run is a core of at most 25 KB plus eight references read when a path is taken (`large`, `execution`, `ephemeral`, `superpowers-plan`, `manual-member`, `resuming`, `autonomy`, `decisions`).
- Requires waypoint ^0.19.0.

#### Fixed
- «sesión» or «session» alone no longer marks a task as touching the auth zone.

### 0.14.0 — 2026-10-13

#### Added
- `triage --base <ref>` sizes an implemented task by its real diff alone (the plan-time estimate sets no floor, a sensitive zone keeps it at Medium) and says who reviews it: one light correctness review on Sonnet for a diff of 3 files and 200 lines or fewer outside sensitive zones, correctness plus security/perf as they apply otherwise.
- `proposals decide --reopen` changes an already decided proposal and keeps its history; `/forge:decide` uses it only after the person confirms.
- `tree snapshot` and `tree check` list the files a task did not create, so a task never deletes a file it did not make and a hand edit is never hidden behind the task's commits.
- `config get` prints the current evidence mode (read right before uploading evidence) and other config values.
- `swarm start` and `infinite` take `--locale`, and `swarm start` keeps any language code of the person.
- `integrate --retry-deps` retries a remembered failed dependency install.

#### Changed
- In an execution, each plan task is implemented by the implementer its triage names (`impl` for a Large plan task, `impl-heavy` only on a sensitive zone) and reviewed by the size of its real diff.
- Plan tasks ignore the greenfield rule, and their ratchet keeps to their plan's project.
- Every message to the person is in their language, also after a hook or a wake; the language is kept in the run and execution state and repeated at every wake, and a plan without a locale no longer means English.
- `forge:decide` answers in the language the person writes in.
- A copy change that names the method (`Con forge:`, `with forge`) first or last is still Trivial.
- Surface permissions, preferences and learned records live in `.forge/` again, as in 0.12; legacy 16-hex allowances stay valid.
- A task made from a proposal keeps its whole rationale and evidence, a proposal's text reaches the brief quoted and is cut at a word, and an estimate stays within a week.

#### Fixed
- `forge:decide` never writes a proposal's decision by hand; marking a proposal done is not a reopen, and a reopen refuses while any plan holds its task.
- `tree check` uses the snapshot's directory for a worktree task, keeps the first snapshot, ignores one from another tree or task, and treats an untrusted snapshot as leaving every new or changed file to the person.
- An integration installs the dependencies a merge needs only when they are missing, reinstalls after a rejected merge, reports the install and what a rollback left, and resets only the files the merge changed.
- The git directory is found from any subdirectory and never guessed, and the personal state is read only from the repository the work tree names, never from a bare repository a commit ships.
- Surface tools are found among Claude Code's MCP servers and reported missing only when they are real misses; a changed surface is shown as a diff with its commits, and the skill never offers to allow a surface whose diff was cut.
- Learned notes merge with the union driver, so parallel tasks keep each other's notes.

### 0.13.0 — 2026-10-13

#### Added
- Personal state (surface permissions, `local.yaml` preferences, learned records) moves under the repository's git directory (`.git/forge`), where no commit can change it.
- Triage hands over the announce line, the plan gate (with `--locale` and a logged raise's reason) and names an untracked `.forge/.gitignore`.
- `verify-result` logs a verification outside a verdict.

#### Changed
- **Breaking:** forge stops reading `.forge/local.yaml`, so after updating it asks again for each surface and for the workflow preference.
- A one-line quoted text change is Trivial: triage greps quoted literals, a quoted old value found in one file makes a short change Trivial, and quoted literals never size a triage.
- The skills print the lines the CLIs hand over (triage, plan gate, execution start, new validators, notes, roadmap notice, report); only the person allows a verify surface, after seeing its whole diff.

#### Fixed
- Routing recommends a spec only when asked and forge for Large work in auto mode, saves «sin forge» as `workflow: off`, ties a route to its session and stays out of subagents; infinite mode frees a Large task's claim.
- A finished light task never stays in progress: `done`, a passing trivial validate and a verify result close it.
- An agent after `done` moves the phase off `done`, and a raising ratchet reopens a closed task.

### 0.12.0 — 2026-10-13

#### Added
- The `forge:route` skill triages a coding request before any other process skill, asks once who does it (forge, superpowers or a mix) and hands over.
- Routing hooks put the `forge:route` rule in new sessions (`SessionStart`) and hint at it, or remind a half-done route, on coding prompts (`UserPromptSubmit`).
- `forge route`, `route set` and `route stage` print the routing options and the recommended one, and keep the chosen route in `.forge/route.json`.
- Auto mode: with `autonomy: auto`, `/forge:run --auto` or a request that says so, forge asks only at launch and records every decision it takes; triage and `swarm start` record it in `status.json` and the execution.
- `workflow` and `autonomy` preferences in `.forge/config.yaml` and `local.yaml`, with `forge prefs` and `forge local set`.
- Infinite mode designs Large tasks in auto mode, and the planner has an extend mode.

#### Fixed
- A superpowers plan counts the tasks superpowers' own ledger marks complete, and an unclosed code fence is refused instead of hiding the tasks after it.
- Superpowers briefs carry the plan's Review Focus and the spec path, and `sp-specs`/`sp-plans` time tracked files by their last commit.
- A declined spec is remembered and not offered again, and a brief never fails on the TDD lookup.

### 0.11.0 — 2026-10-13

#### Added
- `/forge:review [<base>]` reviews any branch with forge's weighted independent review, without fixing anything, taking its baseline in a temporary worktree.
- `forge:run --from-spec <spec>` starts the Large path from a superpowers spec, and `--superpowers-plan <plan>` runs a superpowers plan task by task.
- `sp-plan tasks` and `check` read a superpowers plan, tick one task's boxes and write its brief and triage.
- `forge tdd` prints the TDD line that goes into every implementer brief when superpowers is present; implementers report their TDD runs and the correctness reviewer checks them.
- forge finds superpowers, the path of its skills, and the specs and plans it wrote in the project.

#### Fixed
- Execution reviewers get the implementer's report, and the TDD check spares tasks without logic.
- Decisions live in the main checkout's ledger, so run members' decisions reach reports, lens and the band.
- A decisions summary dated in the future is not shown, and an old takeover reads as the user's decision.

### 0.10.0 — 2026-10-13

#### Added
- A decision record: every decision forge takes without asking is recorded with what it chose, the alternatives, why and how to undo it (`decision add`, `list`, `show`, `md`).
- The new `/forge:decisions` skill lists those decisions and undoes one (`/forge:decisions revert <n>`); the roadmap shows them as notes tagged auto.
- `status.json` keeps the task start, the seconds of each stage and when the task finished; an execution task records `finishedAt` when it is integrated, blocked or adopted, so lens and the roadmap show how long tasks took.
- A takeover of an execution is recorded as the user's decision.

#### Fixed
- An ephemeral start deletes merged task branches, so reused loose ids start from the tip; `adopt` refuses an unreadable worktree status.
- Stage seconds survive phases named `constructor` or `__proto__`.
- The Large report lists the task and the run, and a revert that stops is aborted and never repeated.

### 0.9.0 — 2026-10-12

#### Added
- Triage names the implementer for the task's size, and a small task is always delegated.
- Ephemeral executions: batches of independent requests and the parallel briefs of a Medium task run as an ephemeral execution that schedules loose tasks from `.forge/loose.json` and integrates them into the user's branch.
- The execution records each task's title and the planned count, so lens and the band show titles and the real total.
- `swarm retry --adopt` gives a member's task in conflict a fix round with the coordinator's subagents.

#### Fixed
- A `swarm start` never replaces an active execution it is not resuming.
- The relaunch handover note points at the real brief and its paths.
- Hooks find members by their hook session id, and a member joins with a warning when that id is unusable.
- The scheduler mirrors a member's blocked task into the execution.
- `report` ignores another run's public file.

### 0.8.0 — 2026-10-12

#### Added
- Sessions mode: executor sessions and manual members (`/forge:run --join`) join a run, report their stage and get a task worktree without writing the execution.
- The scheduler relaunches and nudges stalled session fronts with a handover note and an attempt cap, integrates member work and waits for a live claim.
- Resume context at session start, coordinator takeover, and a stale run branch brought up to its base.
- Executor and manual members write their live signal, and the Stop hook works on the main checkout.

#### Fixed
- Member ids follow the members rule and members only act on their own tasks.
- Run members never take the coordinator binding and cannot take over.
- Execution ids are validated where they are read.
- A relaunched front gets a lease window before it can be relaunched again.

### 0.7.0 — 2026-10-12

#### Added
- Execution modes: the Large path runs as an execution on a run branch (`forge/run-<project>`) that drives each task through subagents or background sessions, with `--parallel N` (default 3), task worktrees and a task-level scheduler.
- `swarm.mode`, `swarm.setup` (installs dependencies in each new execution worktree) and `--cwd` to run any command in a worktree without `cd`.
- Integrations merge tasks into the run branch worktree and the run into its target at the end, rolling back when the validators cannot run.
- Visibility: a live signal from the coordinator's hooks, and a shared execution view that lens and the band show with per-task stage, agent and liveness.
- The Stop hook on the execution never blocks while an agent runs, and `forge stop` ends an active execution.

#### Fixed
- Infinite mode runs its execution on `forge/run-<project>`, and `swarm start` refuses a run branch it cannot check out.
- Integrations compare validators with the run branch tip, never target the default branch, and never cache timeouts.
- A coordinator waiting on a long agent reads as alive, and future timestamps never keep an execution alive.
- `sleep` clears only its own wake, and `propose` is capped by `swarm.parallel`.

### 0.6.1 — 2026-10-12

#### Fixed
- `validate --base-run` and `--baseline`: a failure the base commit already had is preexisting and counts neither in the exit code nor in the verdict, and a test runner with no tests passes as skipped.
- `verify-cleanup` never kills pid 1, itself or its parent, and kills a group only when the pid leads it.
- The verify result is derived from its checks unless blocked.
- A detected validator that runs the same command as a manual one is dropped, and a Flutter project gets no Gradle validators.
- `local.yaml` stays in the main checkout so every worktree shares it.
- Triage leaves `docs/waypoint`, `docs/superpowers`, `.forge` and `.waypoint` out of the symbol search.
- Stop hook texts end by asking to answer in the plan's language.
- The run skill checks each reviewer's file as it finishes and never ends the turn with one missing.
- `forge-verify` runs at high effort.

### 0.6.0 — 2026-10-12

#### Added
- Verify surfaces: the new `/forge:verify` skill and the `forge-verify` and `forge-verify-heavy` agents check a brief by using the app the way its surfaces describe (browser, emulator, simulated devices, anything), in parallel with the reviewers.
- `verify-plan` decides which surfaces a brief verifies, `verify.json` counts in the verdict, and `verify-cleanup` stops leftover processes.
- Free-text verify surfaces, detected drafts and learned notes, with per-surface permissions in `local.yaml` and a `tools` check.
- `status.json` carries the verify plan and result, and the roadmap shows verification evidence.
- Validators are selected by path, kind and `when`; manual and detected validators merge; triage returns the validator catalog and the ones not announced yet.
- Detection of e2e, bench, Flutter and Gradle validators.
- Config for detection, free kinds, verify limits and evidence, plus `local.yaml` for machine state with `verify/` ignored in `.forge`.

### 0.5.4 — 2026-10-12

#### Fixed
- The `done` phase is logged.
- The run skill asks before committing unrelated changes in the tree.
- A finished run shows as finished.

### 0.5.3 — 2026-10-12

#### Changed
- A light path is raised to Medium on contract changes, bundled changes or new behaviour.

### 0.5.2 — 2026-10-12

#### Changed
- Implementers edit project files with Edit and Write, not `sed` or shell rewrites, so CRLF is not flipped to LF on Windows and a one-line change stays a one-line diff.

### 0.5.1 — 2026-10-12

#### Fixed
- Triage sizes a task by the files it names: one named file stays Trivial even when its symbol also appears in tests, and renames never go Trivial.
- Light paths finish in the forge card (no review stages on Trivial and Small).

### 0.5.0 — 2026-10-12

#### Added
- First version in this repository, imported with waypoint 0.10.0 and lens 0.5.0.
- Swarm: with `swarm.parallel` of 2 or more (default 5) or `--parallel N`, the Large path and infinite mode run as parallel background sessions per track in their own worktrees, integrated one at a time (`swarm start | status | tick | integrate | mark | retry | sleep | stop`).
- `/forge:run --parallel N`, profiles (`balanced`, `economy`, `quality`) that step implementers down or up one tier, and `.forge/status.json`, `run.json` and `usage/`.
- Spanish README (`README.es.md`) and a rewritten, illustrated English README.

#### Changed
- Infinite mode details are documented: a task triaged as Large is blocked with a question instead of designed unattended, and a stop reason closes the run cleanly.
- forge depends on waypoint ^0.10.0.

### Before this repository
*Reconstructed from the published READMEs; no commit history.*

#### 0.4.0
- Infinite mode: `/forge:infinite [--cycles N] [--hours H]` runs cycles of turning approved proposals into plan tasks, working them and scouting for new proposals within a budget.
- The `forge-scout` agent writes evidence-backed proposals; `/forge:stop` stops the run.
- A Stop hook (`hooks/hooks.json`) binds the session to the run and ends it on a stop condition (the `.forge/stop` file, budget used up, no progress, repeated errors).
- Auto-approval policy: only low-risk, verifiable proposals are approved without the person.
- Requires waypoint ^0.9.0.

#### 0.3.0
- Proposals: `proposals add | list | decide | save | pull` and the `/forge:decide` skill to approve, reject or discuss a proposal.
- Requires waypoint ^0.8.0.

#### 0.2.0
- The Large path: `forge-planner` agent turns an approved design into a waypoint plan, and `/waypoint:work` runs the forge loop per task.
- `brief --plan` prints a task brief from a plan task, `triage --plan` triages a plan task, and `waypoint-cli` locates waypoint's CLI.
- Implementers write their report to `report-<n>.txt`; `verdict` reports dropped findings (`dropped`).
- Requires waypoint ^0.7.1.

#### 0.1.0
- Initial release: triage by size into the Trivial, Small, Medium and Large paths, with a model per role (`forge-impl-heavy`, `forge-impl`, `forge-impl-light`, `forge-mech`, `forge-fable` and the correctness, security and perf reviewers).
- Tool-first validation, a weighted `verdict` and the `round` review loop (up to 4 rounds, tier-up from round 3).
- CLI: `triage`, `validate`, `verdict`, `round`, `log`, `agents`, `last`; `.forge/config.yaml` with validators and `affects` globs.
- Requires waypoint ^0.7.0.

## lens

### 0.13.1 — 2026-10-17

#### Changed
- Its bundle follows waypoint's plan schema (`design_version`, `design_ref`, `goal`, `target`) and the execution's integrated `sha`; nothing it shows changes.

### 0.13.0 — 2026-10-17

#### Added
- `/lens` leaves a snapshot in the transcript outside fullscreen; `/lens live` opens the pane; status line, spinner and mode label.
- `/lens photo` (or `/lens foto`) always takes the snapshot: the files are read once and a `CommandOutput` hook draws the cards, still; at most 20 are kept.
- Outside fullscreen, or with fewer than 3 rows above the prompt, a status line sums up this session's forge work; the spinner names the task in progress, and forge's auto mode and the infinite run are mode labels. A toast says when a task of this session gets a verdict (never its score), starts a new round or is integrated, at most one every 5 seconds, and a notification says when a run of yours of 20 minutes or more ends.

#### Changed
- The pane asks for its rows and, inline, draws its cards without a frame and ends with `↓ N more`; its own close row is gone (the engine's mark closes it). The agent you look at expands its task and puts it first.
- The band names this session's tasks in progress (`T001 impl · T002 rev r2`), fits its width as waypoint's does and draws its bar and boxes only from 140 columns; its buttons have letters (`p`, `x`).
- A long row of boxes keeps two rows of boxes, the rest summed up on the row below (`+42 ■ · 12 □`); the execution card counts what is integrated, as the band does. A snapshot is laid out at the transcript's width, narrower beside a docked pane.
- lens draws its band when waypoint's is closed with × or a notice of it was dismissed, and a forge task of this session keeps it reading with no subagent nor todo while it moved in the last 30 minutes. lens's × closes its band for what it shows (a new todo or a new subagent brings it back), and an `x` within 5 seconds of waypoint's band going does not close it.
- The glyphs are one cell wide: ▲, ✎, ◷ and ►.

### 0.12.0 — 2026-10-17

#### Added
- Tasks in progress: one row per forge task with its own agents; other sessions' tasks dimmed and short-lived; stopped tasks shown as stopped; background validation shown.
- Agents are shown under their task by the `forge-task:` line of their prompt (else `Task id:`, a `.forge/work/` path or the task in the description, or their parent's task); a workflow's agents show although the agents list does not name them, and an idle teammate is waiting, not finished.
- Now says how many subagents it waits on and when the session wakes; each execution slot lists its agents; the Roadmap card shows during a run too.

#### Changed
- Verdicts show the accepting review and findings by severity instead of the score.
- A skipped verification says so and draws no verify stage; a stopped task shows only the stages it went through.
- Run usage counts only the run's sessions from their start; tracking re-reads estimated. A resumed session checks `/cost` against what it spent since it resumed.
- Up to three todos in progress, with the cells in their order; the superpowers round shows its own cap and a ledger unchanged for a day is dimmed; `/clear` empties the panel.
- The hooks that gate (`ui.close`, `agent.spawn`, `tool.call` and the classic ones) go on when they fail.
- The same task id in two plans, or in a plan and a loose task, stays apart: each row takes the agents, job and title of its own task; and a session counts whole in its run's usage, marked `≥`, until lens knows which run it works for.

### 0.11.9 — 2026-10-17

#### Changed
- The forge card counts a plan task's briefs in `.forge/work/<project>/<task>/`, where forge keeps them now.

### 0.11.8 — 2026-10-16

#### Changed
- The roadmap section of the panel is filled only for the conversation whose band is the work band (the one bound to the seat, or a member of a forge run); another session's notice leaves it empty.

### 0.11.7 — 2026-10-16

#### Changed
- A stopped execution, one that ran out of budget or a finished one nobody merged or closed is shown for 24 hours after its last step, as a stalled one already was.

### 0.11.6 — 2026-10-16

#### Changed
- Built with waypoint 0.21's plan schema (`delicate` on a task). Nothing lens shows changes.

### 0.11.5 — 2026-10-15

#### Fixed
- In a narrow pane, an execution row keeps its dot, task id and stage whole: only its title is cut. The card and bar headers follow the same rule.
- A stalled execution is shown for 24 hours at most, with its clock stopped at its last step, and a closed one is not shown.

### 0.11.4 — 2026-10-14

#### Added
- forge's new `forge-review-final` reviewer shows as `final`, in the correctness colour.

### 0.11.3 — 2026-10-14

#### Added
- forge's new `forge-impl-high` implementer shows as `high`, in its own colour, rank 4 of the implementer ladder.

### 0.11.2 — 2026-10-13

#### Added
- The panel's forge proposals keep their decision history: a reopened proposal carries up to 20 earlier decisions with who decided and why.
- A forge run or execution started in a given language keeps that locale in its state, and lens reads it.

#### Changed
- Proposal titles, pillars and quoted texts are cut at a word with an ellipsis instead of mid-word, and titles and pillars stay on one line.

#### Fixed
- The Execution card shows forge's ephemeral executions, which are not tied to a waypoint project.

### 0.11.1 — 2026-10-13

#### Added
- The Usage card shows the time worked and the time since start, summed over the run.
- The forge card shows the task time and how long each stage took.
- The Execution and Roadmap cards show task times, the run time and the last finished tasks.
- Finished subagents stay listed for five minutes with how long they ran.

#### Fixed
- A subagent dropped from the list before its stop is still kept as finished, and a running subagent is never also shown as finished.
- A light task stays running while its agent's subagent lives, and a light task silent for 30 minutes is drawn as finished.
- The band redraws when a task turns done, and a done heavy task keeps its brief cells.
- The Roadmap card shows durations above 24 hours.

### 0.11.0 — 2026-10-13

#### Added
- The forge card says when the task runs in auto mode.

### 0.10.0 — 2026-10-13

#### Added
- The forge card counts forge's automatic decisions of the last day and names the last major one.

### 0.9.0 — 2026-10-12

#### Added
- The Execution card shows each task's title and the real planned total, as the execution now records them.

#### Fixed
- Plan titles on the Execution card are cleaned of control characters.
- The README lists the cards in the panel's order.

### 0.8.0 — 2026-10-12

#### Added
- Executor and manual sessions show in the Execution card with their own liveness.

#### Fixed
- A coordinator waiting on a long agent reads as alive.
- Member signals of another run or session are ignored, and an ended member stops its manual row.

### 0.7.0 — 2026-10-12

#### Added
- An Execution card with per-task stage, agent and liveness.
- Run stages on the forge card.

### 0.6.1 — 2026-10-12

#### Changed
- The panel puts Now first and Usage last.
- The Roadmap and verification rows show upload pending before local-only, and the shot count is dropped from the lens row.

#### Fixed
- The project language is kept while no band is drawn.

### 0.6.0 — 2026-10-12

#### Added
- The forge card shows the verify stage, its tier and a result row.
- The Usage card has a group for verification agents.

### 0.5.3 — 2026-10-12

#### Fixed
- The forge card logs the done phase and shows finished runs.

### 0.5.2 — 2026-10-12

#### Fixed
- Usage prices 5-minute cache writes.
- A finished forge run shows as done.

### 0.5.1 — 2026-10-12

#### Added
- Each Usage row shows the effort next to the model.

#### Fixed
- Subagent usage is labelled plainly when no forge group is present.
- Light paths finish in the forge card.

### 0.5.0 — 2026-10-12

#### Added
- First version in this repository: the panel with Now, Roadmap, forge, swarm, superpowers, Todos, Subagents, Claude Code tasks and Usage cards, plus the band above the prompt.

### Before this repository

*Reconstructed from the published READMEs; no commit history.*

#### 0.3.0
- While a `/forge:infinite` run is active, the forge section shows `∞ N/M · Hh left` from `.forge/run.json` (not read above 16 KiB) and `auto: <title>` for the 3 newest auto-approved proposals.

#### 0.2.0
- A forge section reads `.forge/status.json`: the last task with path and phase, the last agent, validators, verdict score and review round.
- Up to 5 pending proposals from `.forge/proposals/*.json`, each with **Approve** and **Reject** buttons that run `/forge:decide`.

#### 0.1.0
- Initial release: the `/lens` side panel with Roadmap, superpowers, Now, Todos, Subagents and Claude Code tasks sections.
- A minimal band above the prompt with **Panel** and **×** while there are open todos or running subagents.

Not kept: 0.4.0
