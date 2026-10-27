# Changelog

All notable changes to the plugins of the bg-kit marketplace. Each plugin has its own version, and one release can
bump several of them at once (forge 0.15.0, waypoint 0.19.0 and lens 0.11.3 shipped together). Dates are the day a
version landed on `main`.

This repository starts at waypoint 0.10.0, forge 0.5.0 and lens 0.5.0. The versions before them were published from
elsewhere and are reconstructed from their READMEs. java, web, ml and crew started here, at 0.1.0.

- [waypoint](#waypoint)
- [forge](#forge)
- [lens](#lens)
- [java](#java)
- [web](#web)
- [ml](#ml)
- [crew](#crew)

## waypoint

### 0.42.0 — 2026-10-27

#### Changed
- **The band follows this conversation's project.** It used to look only in the folder the session started in, so a conversation started in a folder above several repositories and working in one of them (after a shell `cd`) saw no band. It now looks at the session root and at the repositories one level below it, anchored to this conversation: a forge run it coordinates or is a member of, or a binding of its own. A shell `cd` does not move the anchor. At the session root the band is as before, notices included; below it, the band draws only for this conversation's binding or run, and a clean session gets none.
- The band renews this conversation's binding in the anchored repository, and mirrors the roadmap's writes into that repository's cache.
- `/waypoint:work`, and `/forge:run --join` and Takeover, which reuse its setup, find a plan one level below a session started above the repositories and `cd` there.

### 0.41.0 — 2026-10-27

#### Added
- **How to go on, asked once.** When a design is approved, before the plan is written, `/waypoint:plan` asks with AskUserQuestion how the work goes on, the same question every time: run it with forge, with superpowers, here task by task (`/waypoint:work`), a background session on a track (`/waypoint:launch`), or plan it and start later. forge and superpowers are offered only when the session has them. One option is recommended (forge when it is there, working here otherwise), and the lines before the question say what was found and why. Before, the end of an approved design only said «run /waypoint:work», and the other ways showed up only when the model remembered them.
- The same question comes back with `/waypoint:plan` once the plan is ready and no task has started. It is not asked while forge runs the plan or drives the session; in a background session or in auto, the options are printed with their commands.
- `waypoint handoff <project> [--skills a,b] [--states DIR] [--locale code]` prints that question: `{stage, detected, recommended, options, ask, say}`. With `--skills`, a plugin is offered only when the session lists its skill (one installed after the session started is not loaded); without it, when Claude Code installed and enabled it for the project. The installed version says whether forge is too old: one before 0.35.0 is not offered. waypoint still depends on neither.

### 0.40.1 — 2026-10-27

#### Changed
- On a 4K screen (3840 device pixels across or more, at 100 % or scaled by the system) the roadmap's text starts two steps of A− smaller (0.8): the page's own growth with wide windows drew it too big there. A size the viewer chose with A− or A+ is still kept in the browser and wins.

### 0.40.0 — 2026-10-27

#### Added
- **Three views on the design page.** A bar that stays on top switches between **Document**, **Review** and **History**; the rounds of the critic and the versions no longer sit in front of the text. The bar names the section you are in and opens the list of every section with its number and words, and a strip under it fills section by section as you read. The arrow keys, Home and End move between the views.
- **A map of the document.** The document opens with the pillars and a card per section: its number, its first sentence, how long it is against the longest one and whether the version shown added or changed it. The headings carry the same mark, and the page says when the version shown is not the current one, with a button back.
- **Review and History drawn.** Review charts the proposals of each round by severity, so you see whether the critic converges, and splits every proposal by what became of it (applied, resolved, dismissed, rewritten, pending); each round lists its proposals with the problem and the proposed change side by side, and a section name opens it in the document. History draws every version by its words, coloured by what made it (draft, edits, rewrite, approval, reopen); a version opens in the document view.
- **Visual blocks in the body.** ```` ```mermaid ```` diagrams, which the page draws itself in its light or dark theme (it loads Mermaid 11.4.1 from jsDelivr when the version shown has one; the artifact viewer does not draw them on this page), and a diagram whose source does not parse stays as its source with a line that says so; ```` ```chart ```` bars from a few numbers, one series or 2 to 4; ```` ```steps ```` for 2 to 8 phases; and GitHub callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`). Code blocks show their language.
- `/waypoint:design` writes the body with them: `new` and `rewrite` read the new `references/visuals.md`, which says which block fits what the text describes and how to write each. `design-validate` checks the chart and steps blocks and empty diagrams, with the line of the file each problem is on.

#### Changed
- The article shares one left edge with the map, with prose up to 80 characters a line; tables, diagrams, charts with several series and steps run on to the right edge. The side contents column is gone.
- Tables scroll in their own box, never squeeze their columns below a width set by how many they have, right-align a column of quantities and take the full width from four columns.

#### Fixed
- Tables no longer come out squashed: the text of the page could break inside any word, and a table shrank its columns to a few letters.

### 0.39.0 — 2026-10-27

#### Added
- **What each version holds.** Plan opens with a card per version: its state (completed, in progress, pending), bar, tasks, target and its phases as chips with their percent; a chip opens Plan on that phase and **See its tasks** filters by the version (`pf=v:<id>`, one version at a time). The list puts a header before the first phase of each version («No version» for the phases of none), and the filters gain a **Version** group. The strip's version and the Summary's version tile are links to it.
- Each version not completed says when it is forecast to end («forecast end 2 Nov»), in amber when that is past its `target`: the latest end of its pending tasks in the plan's one forecast (`forecastSchedule` in `src/lib/insights.ts`, the schedule `forecastEnd` reckons, now with each task's end), so a version that waits for another's tasks ends after them.
- Each run of the history in Runs says how its reviews went: how many of its integrated tasks took a single review and the mean of reviews per task («3/4 accepted at the first review · 1.5 reviews per task»), from the rounds `runs/` keeps.
- **The Summary in a grid.** The plan's figures go up to a row of tiles: the version in progress, the tasks done (with how many run and how many are blocked), the phase, the forecast end, the real pace and the last commit with the tests. Below, two columns: what needs you, the autonomous run, «In progress» and the recent activity; the versions, «Next» and the live sessions. The activity is one row per change on a wide screen, and each review round forge closed is a change of its own, with its action and the first finding that blocked it.
- **forge drawn in the task detail.** **Now**, on top of the Summary tab of a task forge works: the flow of forge's stages (triage to done), the past ones ticked with their time, the one in progress pulsing with how long it has run (still and in alarm colour when the task is blocked or stopped, or its executor's lease lapsed), verify dimmed when forge planned none, and a loop under implement…verdict with the review in progress against its cap («review 3 of 4», red over it), moving while forge is inside it; then when forge last wrote the task and the last round with what blocked it and what comes next.
- The Forge tab draws the same flow, the task's way through forge as a bar (each stage as long as it lasted, the last one growing to now, a tick where each round closed, and a legend), and the rounds as a story instead of a table: each with its counts, the findings that blocked it with `file:line` and the reviewer, the validators in red, who reviewed it and what forge decided next, in words («Next: a new implementer one tier up (forge-impl-high)»), and the round in progress last, live, with the stages it went through since the last close. A block of a forge before 0.34 says each round's note instead. The score stays in a title (K4-05).
- «In progress», Plan's rows and the slots carry a small flow of dots, the current stage lit.
- **Sessions.** The coordinator of the active run spans the row, and its slots are a board: a tile per slot with its task, title, the flow of its stage, its round, agent and time, coloured by its executor's liveness, and a dashed tile per free slot. The tasks it holds in no slot go under **Other tasks**, so none is listed twice. Each card says its heartbeat, branch and agent in one line, its zones as chips and its track's progress as a labelled bar; the active run's group says its mode, slots, branch and since when.

#### Fixed
- A task chip no longer breaks inside its id (`F0-07` on three lines in a narrow session card): chips keep to one line.

#### Changed
- The Summary's header keeps the plan's name, its own version when it is not the one in progress, and its tracks; the version, phase, tasks and last commit are tiles. The table of versions of Summary and Plan gives way to the version cards, and the Forge tab's «Stages» line to the flow.

### 0.38.0 — 2026-10-27

#### Added
- `waypoint commit-style` prints the style of the repository's commit titles, `{style, source}`: `conventional` when `commits.style` of `.forge/config.yaml` says so, or when at least 60 % of the last 20 commits of HEAD that are not merges start with a standard Conventional Commits type; else `plain`, waypoint's own titles. With fewer than three commits, as in a new repository, `FORGE_COMMIT_STYLE` (`conventional` or `plain`, in the `env` of `~/.claude/settings.json`) decides, else `plain`. forge reads the same rule.
- `next` prints `commit`, the title of the picked task's commit in that style: `<T>: <title>`, or `<type>(<T>): <title>` for the session to give the type that fits.

#### Changed
- Commit titles follow the repository's style. In a repository that writes Conventional Commits, the design and plan commits of `/waypoint:design`, `/waypoint:plan`, `/waypoint:launch` and the multi-session work are `docs(waypoint): ` and the title waypoint gave them with its first letter in lower case (`docs(waypoint): design v3: round 2`, `docs(waypoint): update waypoint plan`), and a task's commit in `/waypoint:work` is `<type>(<T>): <title>`; elsewhere they stay as they were.

#### Known limits
- A repository whose commitlint allows only some scopes (`scope-enum`) refuses `waypoint` and the task ids as scopes; the history decides only from its last 20 commits, so one that mixes styles reads as `plain` until `commits.style` says otherwise.

### 0.37.1 — 2026-10-27

#### Fixed
- Closing Claude Code (`/exit`, a double Ctrl+C) could print «SessionEnd hook [node …/waypoint.cjs hook session-end] failed: Hook cancelled» and leave the conversation's binding open. Claude Code gives a `SessionEnd` hook that declares no timeout 1.5 s, counted while the rest of the session shuts down, and starting node with waypoint's bundle did not always fit. The hook declares 5 s now; Claude Code still exits as soon as it is done, about 0.1 s.

### 0.37.0 — 2026-10-26

#### Added
- The CLI writes every local file the roadmap sync needs, so neither a background session nor a worktree is asked to write into the checkout: `page --publish-info --capabilities F --write-capabilities` writes `capabilities.json` when it is missing or differs; `set-roadmap <plan> <url>` sets `artifacts.roadmap` in `plan.yaml` and changes no other byte; `sync --versions '<json>'` takes the listed versions inline and keeps them in `known.json` itself; `clean-cache <plan> <collection>…` cleans several collections in one call; `db-import <plan> <collection>=<file>…` turns a listing read into the conversation into the cache, once it has checked that the listing's header names that collection and that its count matches what the file holds; `add-task <plan> --task-file <f>` adds a delegated task only when the plan still validates and nothing else in it changes. Delegating a task from a worktree goes through `add-task` too.
- A background session in the main checkout, where Claude Code lets it edit nothing: `validate` ends with `{"bg": {"jobTmp": …}}` there, and the skills act on that line, never on the prompt's text. `/waypoint:work` moves into a worktree with `EnterWorktree` and starts again from there (if that is refused, it tells you to start the session in a worktree or in an interactive session, and stops). `/waypoint:plan` lists into the conversation, writes each listing to the job's own `tmp` folder and imports it with `db-import`; a `plan.yaml` that would have to be written or edited by hand waits for you to run `/waypoint:plan` in an interactive session.

#### Changed
- A task of `/waypoint:work` takes about half the calls (38 to 20 for one session working in a loop): `next --notes DB/notes --seat-dir <SEAT>` brings the notes with the pick and keeps `lastNoteTs` in the seat's `session.json` itself; `next --check-sync` says when the main checkout has to sync the roadmap first; `done --metrics-version V --seat-dir <SEAT>` pins `meta/metrics` and prints the plan's `progress`; `commit-info --event` prints the write of a commit's event; the six listings go in one message after one `clean-cache`; and each task reads one short reference again (`complete.md`) instead of three. Every write is still pinned to its version and every batch is sent whole or not at all. On a first join, `next --notes` and `notes` give only the last 5 notes.
- The run band says why an ended run ended, with its count and without **Stop**: `► EXECUTION · ✓ finished · 3/3 integrated`, `▲ stalled`, `■ stopped with /forge:stop` or `▲ out of budget`; `▲ stopped` is left for an active run whose coordinator or a task went quiet. The coordinator's band offers **Close** for any ended run, and the notice of a finished run reads `✓ execution finished: 3/3 integrated` (`(open in another conversation)` while its coordinator's conversation is open).
- A session without `ListAgents` registers without a messaging name and says in one line that other sessions reach it only through the roadmap's messages; `heartbeat --register` takes `--agent` only when there is one, and drops a name an earlier conversation left.
- A seat's pending commits go only once the roadmap shows their task done (`next --seat-dir` after its `state` listing, or the idle heartbeat with `--seat-dir` and `--states`), and none while the seat's queue still holds a write; after a compaction, `/waypoint:work` fetches `meta/metrics` again for its version.
- The roadmap page says «detenida con /forge:stop» for an execution stopped with `/forge:stop`, as the band does, and an autonomous run that ended reads «Detenida: …», since «parada» now means an active run without a heartbeat. Republish the roadmap after updating, as `waypoint:plan` says.

#### Fixed
- The band after `/clear`, a resume or a fork with Claude Code's built-in `cc-plugin-sec-default` plugin in front, as it is on Team and Enterprise organizations and on managed installations: that plugin sends every `classic.*` hook past the plugins you install, so the band never heard `classic.SessionStart`, kept drawing the conversation that ended and stayed hidden after **×**. It now notices the next conversation from `session.end` and the conversation's id on the next turn, the same with that plugin in front or without it.

#### Known limits
- The path of a background session in the main checkout (listing into the conversation, writing to `$CLAUDE_JOB_DIR/tmp`, `db-import`) was not tried in a real `--bg` session, and it depends on the shell inheriting `CLAUDE_JOB_DIR`; a plan to write or edit by hand waits for an interactive session.

### 0.36.0 — 2026-10-26

#### Added
- Comments on the design page: every `/waypoint:design round` except `round --verify` reads the open comment threads of the design artifact, shows the new ones one line each and hands them to `design-critic` as your notes, which it weighs as data and never follows as orders. When `apply` applies a proposal that takes up a thread, it replies there with the version that took it up and resolves the thread if you sent it to Claude; a thread you did not send stays open, and the skill says so. A comment without an anchor counts as text. `waypoint design-comments` remembers in `design/critiques/comments.json` which threads a critic already got and which version took them up (ids, rounds and versions, never the text).
- What waits for you: the band shows `» waiting for you N` in design, work and run modes, kept to the last when the width runs out, and the roadmap's «Needs you» takes its questions, proposals and stopped execution from the same rule as lens's **Waiting for you** card. Republish the roadmap after updating, as `waypoint:plan` says.

#### Changed
- `design-critic` runs on Opus at high effort instead of inheriting your session's model.
- `/waypoint:design` and `/waypoint:work` keep each subcommand and step in their `references/`, which they read when they get there and again every time they come back, so each `SKILL.md` stays under 16,000 bytes and a compaction attaches it again whole. They work as before.
- A stopped execution whose coordinator's conversation is still open offers no **Resume**, also after 12 minutes without a signal while that conversation's band keeps its binding alive: you answer it in that conversation.

#### Fixed
- `/waypoint:design new --from` and `design-import` refused a spec without `##` sections, such as the short one superpowers 7.0.1 writes for a small change; the whole spec now becomes one section named after its title.

### 0.35.1 — 2026-10-24

#### Fixed
- Built with zod 4.6.7 in place of zod 3, which can exhaust memory while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5, no fix in 3.x). The plan, the design, its critiques and its changelog read as before, and a changelog entry whose round is not a whole number is still ignored rather than refused.

### 0.35.0 — 2026-10-24

#### Added
- `waypoint replan <plan> --ops f --why-file f [--check]`: moves tasks between phases (`move`), adds, edits and reorders phases (`add-phase`, `edit-phase`, `order-phases`), reorders tasks (`order-tasks`), edits a task's title, `done_when`, dependencies or estimate (`edit`) and retires tasks (`retire`), never renumbering; each replan adds an entry to the plan's `history` (the last 30 are kept, each with its why), and a retired id joins the plan's `retired` list and is never given to a new task. Anything that would break the plan is refused and nothing is written; `--check` validates and prints the changes without writing, and a replan that changes nothing writes nothing.
- The roadmap shows market notes with their sources, parked ideas with why they clash and what would be lost, the Market and Blocked filters, and a card with how an autonomous run stopped, its saturation evidence (or, after a cycle that did not explore, that it waits for an exploration round) and what waits for you. Republish the roadmap after updating, as `waypoint:plan` says.

#### Changed
- `/waypoint:plan` keeps a plan's `retired` and `history` as they are, and numbers a new task past the highest id of its tasks and of `retired`.

### 0.34.0 — 2026-10-24

#### Added
- When the roadmap's owner writes an idea or comments on a proposal, the page records `approvals/owner`, so forge can tell the owner's ideas from the others' in an autonomous run.
- A proposal approved by an autonomous run reads «forge on its own»; a person's idea parked by one keeps its explanation (`parked`). Republish the roadmap after updating, as `waypoint:plan` says.
- `waypoint:plan` syncs from the worktree of a forge autonomous run, where its project lives.

### 0.33.0 — 2026-10-24

#### Added
- A decision on the roadmap shows each alternative with why it was not taken and what it gains and loses, and what the chosen option gains and loses. Plain alternatives read as before. A page published before this version drops the alternatives that carry a why-not or trade-offs, and shows a `blocked` decision as a plain note: republish it after updating, as `waypoint:plan` says.

#### Fixed
- `post-commit` keeps the task's pending lines after an amend, a rebase or a reset on git older than 2.24 (it no longer passes `--end-of-options`, which those versions refuse) (6a N1).
- A session start that records a new base keeps the reflog stat it stored, so the next commit does not read the reflog again (6a N5).
- The README says which commits a second seat records (its own `git commit`, an amend or a merge commit it concludes, `cherry-pick`, `revert`), and `/waypoint:work` says what a rebase does to the pending lines: they move to the replayed shas, and a replay adds none (6a N2, N7).

### 0.32.2 — 2026-10-24

#### Changed
- `post-commit` gives a task only the commits made in its worktree: the reflog entries of `HEAD` of a commit, an amend, a first commit or a merge commit, a `revert` or a `cherry-pick` after the position it last read (kept in `last-head.json`) that HEAD still reaches. What a pull, merge, rebase, reset or checkout brings is not attributed, and the first time counts from the task's claim. A rebase, also one stopped on a conflict and continued, keeps the task's own commits: each line is replaced by its replay, matched by subject, and while the rebase is stopped nothing is dropped. A pending line whose sha is not a sha is never given to git. The reflog is read only when HEAD moved or the reflog file changed. With `core.logAllRefUpdates=false` nothing is attributed. A commit that a person or process that is not a live seat makes in the same worktree counts for the task (H4).
- The band's notice of a stopped run whose coordinator's conversation is still open says «open in another conversation» and offers no Resume (H5).
- `/waypoint:work` tells a session without a track that recovers a task to continue in the worktree that holds `track/<track>`, or in one `waypoint launch` creates (H6).

### 0.32.1 — 2026-10-20

#### Changed
- The roadmap page reads the proposals forge 0.26 makes from what verification saw outside a brief (`source: verify`), the last flow pass of a run's summary (`runs/<runId>` `flow`), and the shared library keeps the exact commits of a decision's undo (`shas`). A page published before this version drops the proposals of source verify until it is published again: republish it after updating, as `waypoint:plan` says (K2-12, K2-13, K2-19).

### 0.32.0 — 2026-10-19

#### Added
- `next` prints `multi` and reads `--messages <dir>`: `multi` is true when another session of the listing is live, a message addressed to this session is open, a task an idle session left can be recovered by this one (of its track, or of any track when it has none), or the session works in a track worktree (a linked worktree on a `track/` branch, its `gitdir` absolute or relative) (J-12).
- A `[waypoint` message routes a lone session to its multi-session protocol; `next` treats a missing `--messages` folder as no messages (J-12).

#### Changed
- `/waypoint:work` loads only what a session working alone needs. The inbox, the recovery of idle sessions' tasks, overlaps and simultaneous claims, lost tasks, zone expansion, delegation, the phase close, the messages between sessions and `release` moved to `skills/work/references/multisession.md`, only their links rewritten, except that a lost recovery race now lists `sessions` again and runs `next` again, and a session without a track recovers a task of any track. The skill reads it when the session works next to others (`next` prints `multi: true`, or a `[waypoint` message arrives) or for one of those steps (`release`, a claim that is not `solo`, a lost task, zone expansion, delegation). Its size on invoke went from ~13k to ~7.5k tokens (`claude plugin details`; `SKILL.md` 35 073 → 20 921 bytes, the reference is 15 961 bytes). The skill runs the CLI as `node "<WP>" …` (J-12).
- A state file whose name breaks the plan's id rule no longer names a task left in progress, in `bind`'s exit 4 and in the `previous` line of `session-start`: they read the state cache as the band has since 0.31.0 (carry from 5b).

### 0.31.0 — 2026-10-19

#### Added
- `waypoint launch <plan> <track> --exec` starts the session's `claude --bg` itself, detached and in the worktree, with its output in `.waypoint/<project>/launch/<name>.log`, never written through a link (a `launch/` that is one exits 1); `/waypoint:launch` uses it and needs no `claude --bg` permission any more (A-22).
- `waypoint doctor <plan> [--fix]` lists what older versions left under `.waypoint/<project>/` (`last-head`, files of `sync/` the plan no longer writes, caches of collections the roadmap does not have), and `--fix` deletes them; it reports what it could not delete (`failed`) and exits 1 (A-24).
- `page --publish-info --assets`: the roadmap declares `assets` only when its caller asks for it; `/waypoint:plan assets` passes it, and forge's Large path asks for it when its screenshots are uploaded (A-19).
- `page --publish-info --no-assets` drops `assets` even when the published roadmap has them; `/waypoint:plan no-assets` passes it and asks once before the roadmap becomes shareable again. `--assets` and `--no-assets` together exit 2 (ruling R6b).
- `page --publish-info` keeps `assets` when the listed `--page` says the published roadmap has them, so forge's routine syncs do not change who can see it. A listed page that does not record it (a roadmap not republished since 0.26.0, or no `meta/page`) is always asked about, `--no-assets` included: `capabilitiesChanged` with its own `ask` (with `--assets`, the line that makes it internal) (A-19, ruling R6c).

#### Changed
- waypoint no longer reads `.forge/config.yaml` nor bundles forge's config schema (A-19, I-18).
- Who decides the roadmap's sharing: `/waypoint:plan` alone no longer adds forge's screenshot store in a repository with forge (run `/waypoint:plan assets`, as forge's Large path does), and a roadmap published with the store keeps it, since `evidence: local` in forge's config no longer removes it and only stops new uploads; `/waypoint:plan no-assets` makes it shareable again (A-19, ruling R6b).
- `sync` deletes its earlier batches of `--out` (inside `.waypoint/<project>/`) before writing, and replaces a batch file that is a link instead of writing through it (A-24).
- A listing with a document that does not read is used without it, and the CLI says `warning: skipped <dir>/<file> (unreadable)` on stderr; `next`, `conflicts` and `status` exit 1 when the `--states` they are given does not exist (A-06, I-14).
- `session-id` gives only letters, digits, `_`, `.` and `-`, the ids forge accepts (A-18).
- The design page embeds the last five versions; the earlier ones keep their date and note (A-24).
- `/waypoint:work` may edit files without asking, and every waypoint skill allows the tools it names (A-22).
- `/waypoint:launch` may commit the plan it asks for (A-22).
- `--swarm` is still obsolete and its warning now says forge composes the launch (A-19).
- The band's bundle carries no zod and is minified: `hooks/register.js` drops from about 433 KB to about 214 KB (I-13). The band shows a plan or a draft design that `waypoint validate` rejects (the CLI is the one that validates), without the tracks, phases and tasks whose id breaks the plan's id rule; titles, phase names, the project and an address that is not a web link reach it as one clean line. The band marks a member forge launched for one task by its member file; `launchedBy` is no longer read.

#### Removed
- `waypoint launch --task` exits 2: forge composes the launch of its run members (A-19).
- `--launcher herdr` exits 2: herdr was removed; use bg (I-18).

### 0.30.0 — 2026-10-18

#### Added
- `design-snapshot --note-file <f>` takes the note from a file, so a note with quotes or `$` never goes through the shell; the design skill writes it there (J-22).

#### Changed
- The `PostToolUse` hook starts only for a command that names git (`if: Bash(*git*)`), and also for PowerShell: every other call saves a `node` start, and a conversation's binding is renewed by its `Stop` hook, its git commands and the band, so a long turn of other commands without the band can let it lapse until the turn ends (hooks filter, J-22).
- Each skill's `allowed-tools` lists the git commands it runs instead of `Bash(git *)`, and the README recommends a narrow `allow` list, a `deny` for `git push`, `git reset --hard`, `git clean` and `git -c`, and says why `git -C` is left for Claude Code to ask; with forge allowed, it also recommends `deny: Bash(*forge.cjs* hook *)`, as the root README does (I-03).
- A flag followed by another flag has no value, as in forge: `next --session --track x` exits 2 (J-22).
- `waypoint:plan` commits `plan.yaml` and `design.md` with pathspecs, and so does the delegation of `waypoint:work` (A-16).
- Built with esbuild 0.28 (I-17).

#### Repository
- `npm run ci` runs the types, the mod types, the tests, a build freshness check, `claude plugin validate` and `claude plugin test`; `.github/workflows/ci.yml` runs it on Ubuntu and Windows. vitest 5, happy-dom 21 and esbuild 0.28 clear `npm audit`; the tests leave nothing in the temp directory, and `npm run clean-temp` counts what old runs left; the version tests are invariants and a contract test checks every command and flag the skills cite (I-01, I-05, I-09, I-10, I-16, I-17).

### 0.29.0 — 2026-10-18

#### Added
- Plan is a vertical list of the plan's phases, the one in progress open: each says its state, version, a bar of its tasks and its counts, with its goal under it, and each task is a row with its state (also «done · not merged» and «No executor»), track, forge summary and evidence, grouped by category only when the plan has categories; tasks outside every phase go under «No phase». Its filters (free, in progress, blocked, done, not merged; committed or provisional phase; deferred findings, over the cap; track) add up to the plan and travel in the address (`pf=`); «Needs you» opens Plan on the deferred findings. The table of versions, with their targets, heads it.
- Runs keeps the history of `runs/`: each finished run with its date, duration, integrated tasks and where it merged, and, opened, how it ended, its final review, deferred findings, decisions and each task; a task closed outside a run has its own label. The active run lists its tasks as rows of «In progress», and a stalled one says why and which command resumes or closes it.
- Sessions are grouped by the run they work for (an ended run's folded, and the stopped sessions of a live group folded apart); each card lists every task its session runs, and the active run's coordinator its slots and the free ones.
- Conversation mixes notes and proposals in one list with one set of filters (everything, open questions, decisions, proposals, ideas and debt, mine): a proposal carries its comments, the task it became, its history and the owner's mark, and a question a decision closed says whose decision it was, with a link to it. «Decided by» and the wording of a changed decision follow the owner's mark; without a mark, a decided proposal reads «Decided · unverified» and names no one, and its history reads as the proposal's own account; forge's policy is never credited to the owner.

#### Changed
- One forecast end for the whole page, from a schedule of the work left that follows the dependencies, with the real parallelism (the coordinator of a run counts its slots) and the real pace against the estimates: the strip, the timeline and the analysis show the same date, and `waypoint status` reckons it the same way, with one session working.
- The schedule opens fitted to the plan, with the phases in progress open (a click on a bar keeps the fit), unless the address says otherwise. The burndown draws at its real width, its labels in HTML, and its ideal line only towards a version's `target`; the code zones go by directory, with a legend, and one that two running tasks share is marked. The analysis is computed once per data revision and minute. «Now» keeps the fit while the fitted window already shows now.
- A repaint touches only what changed: the strip, the side nav, the open view, the task detail, the analysis, the minimap's bars and each row of the timeline that did not change are left as they are (neither parsed nor compared again), with their focus, their scroll and the times the 30 s tick keeps current.
- Sessions folds a group as its data says: a group whose sessions all stopped folds, and opens again when a live session joins it; a group you folded or opened yourself stays so.
- In the light theme, labels, metadata, legends and coloured text use darker text tokens that reach 4.5:1; every toggle says whether it is pressed, every fold whether it is open, and every text box carries a label. The Versions board and its code are gone.

### 0.28.0 — 2026-10-17

#### Added
- The roadmap has six views, Summary, Plan, Schedule, Runs, Sessions and Conversation, under a status strip that stays on top: the connection (with the date of the snapshot's states until the database answers), one run pill and one infinite pill read from its coordinator's lease, the current version's percent, the forecast end, when state last synced and a link to the design. On a phone the views are a tab bar at the bottom.
- The view and the open task are in the address (`#v=plan`, `#t=T044&tt=forge`): a hash edited by hand changes the view (junk falls back to Summary), a link to a task added after the page was published waits for the live plan before it opens, and links to the old views (Tracking, Versions, Notes, Proposals) open the view that replaced them. Closing the task goes back over the entries the page itself pushed and never leaves the page.
- Summary opens with «Needs you»: open questions (with Reply), proposals to decide, approvals without the owner's mark, open escalations, external blocks with their reason, recent deferred findings (Seen hides them in this browser only), a stalled run, an infinite run without its coordinator and a page older than the plan's waypoint, each with the command to use. Then «In progress», one row per task with its stage, round, validators, time, agent and who runs it; «Next»; the progress by version and phase; the recent activity in two lines; and the live sessions.
- The task detail has four tabs, Summary, Definition, Forge and Conversation, and is full screen on a phone: why a task is blocked, the commits still only in its events, its texts with code, bold and links, its section of the design, the zones it touched outside the plan, its dependencies in the colour of their state, every review round (the one over the cap highlighted), every validator, the accepted round and the verification by round.
- Only the roadmap's owner sees Approve and Reject: the page writes the owner's mark in `approvals/` (`{status, decidedAt, by, digest}`) before the decision, refuses to decide when the proposal changed while the owner was reading it, and anyone else comments. An approval without the mark says it will not become a task, and the owner can confirm it. An approval whose decision changed after the owner took it (its text edited, or its status changed, such as a rejection turned into an approval) says «changed after your decision: review the text and decide», on its card and in its own line of «Needs you», and has no one-click confirm: the owner reads it and decides again with Approve or Reject. When the mark is saved but the proposal could not be updated, the page says «Your mark is saved; the proposal still needs updating», and Retry runs only that update again.

#### Changed
- The page morphs its HTML instead of replacing it (morphdom 2.7.8, bundled in the page): a snapshot keeps the scroll, the focus and an open select, and the detail repaints live, without the ↻ button. The data the views derive is computed once per change, and past 150 rows the timeline paints only those near its viewport.
- Everything that opens a task is a button, the Conversation chip included; the detail keeps the focus inside, gives it back when it closes, and its tabs move with the arrows.
- Durations, plurals and numbers follow the page's language. A task the plan dropped is «Removed from plan» and an expired lease «No executor»; «Agent» instead of «Address»; «Free» for the free state. The timeline's forge mark shows the accepted round and its findings, with the reviewers' score only in its title.

### 0.27.0 — 2026-10-17

#### Added
- A critic that converges: each round has a budget (round 1 up to 12 proposals of any severity, round 2 up to 6 critical or major ones, from round 3 and in `round --verify` up to 3 critical ones; a reopened design starts again, in `critique-next` and in `critique-check --design` alike), and a critique says `verdict: ready` when nothing critical or major is left (zero proposals is a valid critique; a verdict that does not fit its proposals is refused). `critique-check` enforces both (`--verify`), and with `--changed` it warns about a proposal outside the changed sections without failing (an empty `--changed` exits 2). `critique-check --reject-on-fail` sets a critique it refuses aside as `r<R>.rejected.json`, so it never counts as a round; `/waypoint:design round` passes it when the critic's second attempt fails too.
- `critique-next <design.md> [--verify] [--full]` prints the next round: its number, the critic's budget, the scope, the sections to review and where its critique goes. A change that only removed sections is reviewed in full (the intro and every section), with the removed ones in `removed` for the critic.
- `design-gate` prints `needsVerify` (a change applied after the last critique that no critic has read, or the design file edited by hand after its last snapshot, which it also reports as `handEdit`: `/waypoint:design round` snapshots a hand edit before its critic reads it) and `majorPending`, and what the critic must not raise again: `dismissed` (with the reason), `resolved` (in an interview) and `applied` (with its change); each `pending` proposal carries its problem, as one clean line. Each of the other lists holds the newest 40, with its texts clipped and a count of what is left out.
- `critique-dismiss --reason-file` keeps why a proposal was set aside (required for a major or critical one; a placeholder reason is refused; a reason already stored is never overwritten), and `design-snapshot --resolved r1:4` records what an interview resolved (an unknown id exits 2).
- `design-snapshot --kind draft|round|apply|rewrite|interview|approve|amend|reopen`; without `--round` it records the newest round of the changelog and of the critiques, so an approval or a reopen after a critique carries its round and the first round after a reopen gets round 1's budget. `/waypoint:design amend` changes an approved design that stays approved, and `waypoint design-impact <design.md> --plan <plan>` lists the plan tasks whose `design_ref` points at a changed or removed section; `/waypoint:design reopen` sends it back to draft and through the critic (a draft that was never approved cannot be reopened; a design approved before this version counts when a version of its history says `status: approved`, whatever its note says).
- The design page shows a status badge (draft, approved, approved · amended, parked), each round with its verdict and what became of every proposal (applied in vN, dismissed with its reason, resolved in the interview, rewritten or pending), how many proposals are pending in all, and what each version changed (against an earlier version, which it names, when the history lacks the one before). Everything a critique says is escaped.

#### Changed
- `approve --auto` no longer approves with a major proposal pending nor with an applied change no critic has read (`round --verify` reads it).
- The critiques and `dismissed.json` live in `docs/waypoint/<project>/design/critiques/`, committed with the design; the ones in `.waypoint/<project>/` are still read, and the band counts both. A round in both places is read from `docs/`, and the two `dismissed.json` files are merged (one that is junk, unreadable or over 1 MiB hides nothing of the other). Every path comes from the design file, never from the working directory.
- `design-changed` compares the bodies only (a front matter change such as `status` is no change) and prints `removed`.
- The plan skill links the plan to its approved design (`artifacts.design`, `design_version` and each task's `design_ref`), and `validate --design` warns when they do not match the approved design (a changelog that does not parse is a warning, never a failure). `design-impact` reads task states tolerantly and exits 2 on a design it cannot read.
- The design page declares its language, says which version button is pressed and keeps the focus on it, announces the version shown in a live region, gives 44 px touch targets, has landmarks, section headings and accessible names, and uses text colors of at least 4.5:1 in both themes (a test checks every text and fill pair).

#### Fixed
- A design heading is read in linear time: a heading line with a long run of spaces no longer hangs the CLI, the band or the page.

### 0.26.0 — 2026-10-17

#### Added
- Only the roadmap's owner approves proposals: the roadmap declares `approvals/` writable by its owner alone (a rule the server enforces), and `page --publish-info --capabilities F` prints the `meta/page` write (the page's version and rules) the plan skill sends after each publish, with `rules: 2` only when `F`, the capabilities that publish passed, holds that rule, and whether it declared `assets`; the plan skill passes them on every publish, and a republish that would change who can see and share the roadmap (`--page` prints `capabilitiesChanged` and the line to ask) waits for your yes, never happening unattended. A roadmap published before this version lacks the rule: republish it with `/waypoint:plan` after upgrading, and only then are approvals owner-only (`sync` asks for it when `meta/page.rules` is below the page's rules version).
- `sync --db` reads the roadmap's listings: it never sets a task document whose version `known.json` lacks (`unknownVersion`; exit 2 when it has to write it), stops on a listing of 1000 documents or on an incomplete one, and prints `removed`, `missing` and `republish` (the published page is older than the plugin or its rules are older, so the plan skill republishes it).
- `plan.yaml` gains `design_version`, `tasks[].design_ref`, `phases[].goal` and `versions[].target`; the roadmap's `meta/project` gains `links` (the design and its version) and `waypointVersion`; `validate --design` warns about a `design_ref` that is not a section of the design.
- `page --states` puts the listed task states in the page's snapshot, with the version that built it.
- The page reads forge's v2 data: the task's forge block (rounds with findings, validators with time and cache, verification, stages, integration, deferred findings) and its evidence by round, `blockedReason`, the start, last step, stall reason and closing of a run, the coordinator of the infinite run, `answeredByNote`, and the metrics in `meta/metrics`; `?debug=1` lists what it drops.

#### Changed
- `waypoint done` prints the metrics apart (`metrics`, an update of `meta/metrics` printed without `if_version`: the skills send it so only to create the document and pin it once it exists) instead of a pinned `meta/project` write in the task's batch, and no longer needs `--meta-version` (still accepted, and ignored, so an older forge that passes it does not fail).
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

### 0.35.1 — 2026-10-27

#### Changed
- Depends on waypoint ^0.42.0.

### 0.35.0 — 2026-10-27

#### Added
- `/forge:run --handoff <project> [--plan-only]` takes over when the person chooses forge in waypoint's question of how to go on. With no plan yet, forge-planner writes it (the Large path's step 2), then come the Large path's start questions, where it runs among them; with a plan waypoint wrote, it starts at those questions, after the stats file and the evidence setting step 2 would have read. Either way it records the run's base in `.forge/work/<project>/run.json`, as the Large path does once a design is approved. `--plan-only` (waypoint's «Plan it, start later») stops once the plan is written and synced, and says that nothing started.

#### Changed
- Depends on waypoint ^0.41.0.

### 0.34.1 — 2026-10-27

#### Changed
- Depends on waypoint ^0.40.0.

### 0.34.0 — 2026-10-27

#### Added
- `roadmap-doc` tells the roadmap why each review round went where it went. Each round of `state/T.forge` carries what forge decided next (`next`: `resume`, `fresh-stronger`, `redo`, `stalled`, `breaker` or `done`), the agent of the next attempt (`impl`), the verdict's score, the critical and important findings that blocked it (`why`, at most 3, critical first: severity, the problem in 100 characters, `file`, `line` and the reviewer that found it, from the round's `findings-<brief>-<round>.json`) and the validators in red at its close (`red`, at most 4). A findings file older than the execution is an earlier run's and is left out, as the review dirs are.
- The block carries the task's `trail`: each stage it entered in this run (its triage and every `phase` event of the ledger, with its brief and round), oldest first, the newest 16. The swarm's step writes it at every stage change, so the roadmap shows a round moving before its verdict.
- The 4 KB budget cuts what v3 adds first (the trail to 8 steps, one finding per round, the trail, the findings and red validators, then the decision), so a block that fitted before keeps everything it carried.

#### Changed
- Depends on waypoint ^0.39.0.

### 0.33.0 — 2026-10-27

#### Added
- `commits.style` in `.forge/config.yaml` (`auto`, the default, `conventional` or `plain`) and `forge commit-style`, which prints `{style, source}`. With `auto`, forge writes Conventional Commits when at least 60 % of the last 20 commits of HEAD that are not merges start with a standard type (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`); otherwise its own style. With fewer than three commits, as in a new repository, your default decides: `FORGE_COMMIT_STYLE` (`conventional` or `plain`) in the `env` of `~/.claude/settings.json`, as `FORGE_WORKFLOW`; without it, its own style; it never overrides a history that already says a style. waypoint reads the same key and the same variable.
- `begin` prints `commit` (`{style, source, line}`): `line` is the `Commit title` line every brief written by hand carries (Small, Medium, an ephemeral run's tasks).

#### Changed
- Commit titles follow the repository's style. A plan task's brief says `Commit title: <T>: <what the commit does>`, or `<type>(<T>): …` in Conventional Commits, where the implementer gives the type; a brief written by hand says `<type>: …`, or a title in the style of the repository's recent commits, where it said nothing before. forge's own commits become `chore(forge): integrate <T>`, `chore(forge): merge <run branch>`, `chore(forge): bring <base> into <run branch>`, `chore(<T>): learned notes of its verification` and `revert(<T>): undo the attempt for a redo (…)` in Conventional Commits, and stay as they were otherwise; the plan commits of infinite mode and `/forge:decisions` become `docs(waypoint): …`, which still name `(decision <n>)`. Implementers still read an older brief's `Commit title prefix`.
- A task's branch is `forge/task/<T>`, in forge's own namespace, instead of `task/<T>`. An execution an earlier forge started keeps the `task/<T>` it recorded for each task until it ends, and a plan run takes up, as it is, the work an earlier forge left on that plan's `task/<T>`.
- `swarm cleanup` removes `forge/task/*` and `forge/run-*` branches once merged, and a `task/<T>` only from forge's own worktree `task-<T>`: it no longer deletes every merged `task/*`, which could be one of yours. The `task/<T>` branches earlier runs left merged outside a worktree stay; delete them with `git branch -d` when they are forge's.
- Depends on waypoint ^0.38.0.

#### Known limits
- A repository whose commitlint allows only some scopes (`scope-enum`) refuses `T3`, `forge` and `waypoint` as scopes.
- The history decides only from its last 20 commits: one that mixes styles reads as `plain` until `commits.style` says otherwise. A superpowers plan's brief keeps the commit its own steps write.

### 0.32.1 — 2026-10-27

#### Fixed
- Closing Claude Code (`/exit`, a double Ctrl+C) could print «SessionEnd hook [node …/forge.cjs hook live] failed: Hook cancelled», and then the route did not record how its conversation ended nor the live signal that the session had ended. Claude Code gives a `SessionEnd` hook that declares no timeout 1.5 s, counted while the rest of the session shuts down; forge's hook declares 5 s now, and Claude Code still exits as soon as it is done.

### 0.32.0 — 2026-10-26

#### Added
- `FORGE_WORKFLOW`, your default workflow for every project (`forge`, `superpowers`, `superpowers-design`, `superpowers-plan`, `off` or `ask`), set once in the `env` of `~/.claude/settings.json` instead of answering in each new project. It comes last: the request, then `.forge/local.yaml`, then `.forge/config.yaml`, then `FORGE_WORKFLOW`. With `off` or `superpowers` the routing rule and hint stay quiet in every project that does not say otherwise. `forge prefs` names it as the source `env`, and warns about a value that is not a workflow and lists the valid ones.
- Deviations from the triage: when a forge implementer starts that is not the one forge named for the task in progress (the triage's, the one `swarm step` hands out, the one `review-close` prints for a fix round), the `SubagentStart` hook records a `deviation` in the ledger and blocks nothing. The next `swarm step`, the brief's `review-prep` or, on the Small path, `validate --all` says it once in one line, `review-close` repeats it when the brief closes, and `last --task` and `swarm status` list them (with the implementers forge named, `named`) for the closing report. `agents --role R --task <T>-<n>` prints a role's agent and records it as the one forge names for that brief, as an ephemeral task's fresh `impl` does.
- `--max-usd N` for `/forge:infinite` and its profiles, or `budget.usd` in `.forge/config.yaml`: a spending cap in US dollars next to the cycles or hours, never in their place. Each `forge cycle` counts what the run has spent from the transcripts of its sessions and their subagents, keeps it in `run.json` (`cost`) and stops the run cleanly as `budget-usd` once it reaches the cap; the Stop hook's line shows what was spent of it, and a cost forge cannot count is said as unknown, never guessed.
- Gradle and Maven validators. Gradle at the root outside an Android app (`gradlew`, `gradlew.bat`, `build.gradle(.kts)` or `settings.gradle(.kts)`) gives `gradle-test` (`test`), or `gradle-check` (`check`) when the build adds checks; Maven (`mvnw`, `mvnw.cmd` or `pom.xml`) gives `maven-test` (`-q test`). Each takes the wrapper of the platform when it is there (`gradlew.bat` and `mvnw.cmd` on Windows), else `gradle` or `mvn`.
- With no validator detected nor listed, forge says that nothing checks the change before any work: `triage`'s `announce` ends with that line, `prep` prints a `warning`, also on stderr, and `swarm step` adds it to its line for the implementer it hands out.
- `forge doctor` reports the Claude Code that runs here against the version forge's platform facts were recorded with, as data that never changes its exit.

#### Changed
- forge keeps its files out of git through the repository's `.git/info/exclude` (shared by every worktree) and no longer commits `.forge/.gitignore` on your branch; `config.yaml` and `verify/*.md` can still be committed. A `.forge/.gitignore` git already tracks, or one with rules of your own, is respected as it is; an untracked one with exactly the rules an earlier forge wrote moves to `.git/info/exclude` at the next `triage` or `begin` and goes, and only another untracked one is named in `untracked` for you to commit or delete. Outside git forge writes that file as before.
- The routing rule and hint only where they make sense: none outside a git repository, and the hint leaves out git work (commit, pull request, push, merge, rebase, tag), typos, renames, translations, texts that are not code (an email, a summary, the tone, a meeting, an issue or a ticket) and questions, while it keeps features, fixes, refactors and new projects.
- A young repository (no commits, or fewer than five files) no longer sends everything to Large: the request decides. A Small one that is not mechanical becomes Medium, and only a request to create an app, a project or a service with several pieces (a backend and a frontend, an API and a database…) is Large.
- On the «superpowers designs, forge builds» route, a spec brainstorming wrote and approved on that route is imported as an approved design without asking you again, and forge says so in one line that names `/waypoint:design reopen`. In ask mode it skips the critic round too; in auto, where nobody approves by hand, the critic still reviews it before `approve --auto`.
- The route reminder names your choice and that `using-superpowers` puts your instructions above its skills, so it wins over brainstorming's «invoke writing-plans and no other skill».
- forge's implementers state the real rule: in a subagent, Claude Code refuses only the Write of a `.md` file whose name starts with REPORT, SUMMARY, FINDINGS or ANALYSIS (any case), not every `.md`. A brief that names such a file says how it is still delivered: written under another name and renamed with `git mv` (`git mv -f` when the name is already in the repository), or returned as text after the implementer's two lines, which the coordinator writes in the task's worktree, commits with the brief's prefix and tells you in one line; never in silence. `forge-runner` hands such a text back to the coordinator.
- `forge-runner` says what happens: its agents may come back in the background and their reply wakes it; its commands stay in the foreground.
- `infinite start` without a profile reads `.forge/config.yaml` and refuses one that does not load, with or without `--max-usd`: every cycle reads it.
- Depends on waypoint ^0.37.0.

#### Fixed
- A superpowers 7 ledger whose `plan-path` is absolute (`/e/…` from Git Bash, `/cygdrive/e/…`, `E:/…` or `E:\…`, also the physical path `pwd -P` gives) counted no task as done: `sp-plan tasks`, `sp-plans` and `/forge:run --superpowers-plan` now count its tasks for the plan it names.
- The live signal lost agents when several hooks ran at once (three `SubagentStart`s): each hook now reads, changes and writes `.forge/live/<id>.json` under its lock, and `swarm cleanup` removes a lock a dead process left.
- `forge config get` of a known key with no value exited 2 («is not a config key»); it prints its default, or nothing, and exits 0.
- An execution's coordinator on a second seat kept the time of the notes it had read in the checkout seat's `session.json`; it keeps it in its own seat's.

#### Known limits
- The native Android pair of validators (`gradle-lint` and `gradle-test`) still runs two Gradle builds in the same parallel batch.
- Deviations: a pure swap between two tasks whose named implementers differ is not seen, and a lost `SubagentStop` can give a false deviation for about 3 hours (agents started before the hand-out are not counted).
- `--max-usd`: the cost is a lower bound read from the transcripts (90–99 % of Claude Code's own figure), checked between cycles, so a run can pass the cap by one cycle, about 10 %.
- The Small path keeps running the whole suite: running only what a change affects stays a proposal.
- The live signal: with its lock busy more than 2 s (0.3 s on `SessionEnd`) the hook writes without it, and the old race comes back in that rare case.
- A spec handed off on the «superpowers designs, forge builds» route counts as approved even if the session handed it off before you approved it; in ask mode the one-line notice names `/waypoint:design reopen`, and in auto the critic still reads it.
- Routing: the hint is heuristic, with known misses both ways (issues or tickets, requests under four words); with a failing git, `GIT_DIR` or odd mounts, forge behaves as outside git or writes `.forge/.gitignore` again.

### 0.31.0 — 2026-10-26

#### Added
- `forge doctor [--locale es|en]`: a read-only report of why forge might not move. Each check is isolated and says `ok`, `warn`, `fail` or `unverified`: the step lock and background jobs, a merge in flight, a stale `execution.lock`, your trust in the commands of `.forge/config.yaml`, whether git tracks `.forge/local.yaml` or `learned.jsonl`, verify-env reservations with no live process, the merged worktrees `swarm cleanup` would remove, the installed waypoint against forge's range, which copy of forge and waypoint is running, superpowers against the range `forge:route` follows, the recommended permissions and `waypoint doctor`; a subagent whose tool call has been waiting a while comes as data. It exits 2 on a `warn` or a `fail`, else 1 when something could not be read, else 0. It never repairs: each problem names its remedy and whether you run it or it needs your confirmation.
- The guard keeps forge's subagents away from the machine's secrets. An agent whose `agent_type` starts with `forge` can no longer read or write `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, `~/.git-credentials` or `~/.kube`, search your home folder or above, or touch a `.env` (`.env.example`, `.env.sample`, `.env.template` and `.env.dist` aside); only `forge-verify` and `forge-verify-heavy` may read the repository's own `.env`, to start the app. It judges Read, Edit, Write, NotebookEdit, Grep and Glob by their paths, and Bash and PowerShell through the guard's command splitter, with the home folder written `~`, `$HOME`, `$env:USERPROFILE` or `%USERPROFILE%` and the Windows and macOS spellings of a path. Your own session and every other subagent are not judged. It is a pattern guard, not a sandbox: the README lists what gets past it.
- `/forge:diagnose <task>` or `/forge:diagnose --execution <runId>`, on `forge diagnose`: the timeline of a task or an execution from the ledger, forge's files and the transcripts of its sessions, read only. It reports a step missing, out of order, degraded or repeated, a command that failed and drift after a compaction, lists the calls left waiting for 10 minutes or more as data and counts the tokens once per message; every claim cites a `file:line` or an event's time.
- Verified TDD, with `tdd: verified` in `.forge/config.yaml`: briefs ask for each test before its code (superpowers is not needed), and in round 1 `review-prep` runs only the task's new and changed test files on BASE and checks by name that each new test fails there. A new test that already passes on BASE proves nothing, and the correctness reviewer reports it as important. The whole suite never runs for it, and the check is skipped, saying why, where it cannot be safe or cheap: tests that share their package with the code (Go, Rust), more than 30 test files, a changed lockfile, dependencies that link the task's own code, or a run over 5 minutes. A task from Small up whose words read as a bug gets a brief line that asks to reproduce it with a failing test first and to end the report with `Root cause: <file>:<line> - …`. On the Small path, `forge tdd check` runs the same check; with `--baseline`, `validate` names the tests already failing on the base. Without the option nothing changes.
- The nested runner, experimental and off by default: with `swarm.nested: true`, a plan run in subagents mode hands each task it starts to a `forge-runner` subagent (Opus at medium effort), which spawns the task's implementer and its independent reviewers and runs the fix rounds, while the coordinator only steps and integrates. At any point that needs judgement the runner hands the task back (a tool's refusal, a refusal an agent got around and a brief left partly undone included), and the coordinator takes back a task whose runner has been silent for 100 minutes. `swarm task --lease-minutes N` sets a task's lease N minutes from now. It stays off until a measured run shows it costs less with the same findings.
- `forge-planner` gives a task its `review_focus` in `plan.yaml`: the failure modes its `done_when` and its tests leave open, one line each. The task's brief hands it to the implementer and the reviewers.
- A diff that adds a strict sink (`eval` or `new Function`, TLS verification turned off, or unsafe deserialization: `pickle.loads`, `yaml.load` without `SafeLoader`, `ObjectInputStream`) is reviewed as Medium with the security reviewer, however small it is and outside every sensitive zone; launching `git` or another process is not one.
- Predicted conflicts, with Git 2.38 or later: `swarm status` says, without touching any checkout, whether each accepted task would conflict with the run branch and whether the run branch would merge cleanly into its base, and `swarm merge` predicts its merge before asking you: a conflict it foresees answers `conflict` with `predicted: true` and its `paths`, asks nothing and spends no permission. With an older Git the prediction is `unverified`.
- `forge-review-final` lists what it declined to judge and why, and the final report hands it to you with the `deferred` findings.
- Each automatic decision says what it costs if it turns out wrong (`ifWrong`: `low`, `medium` or `high`, with one line); the reports and `/forge:decisions` show it.

#### Changed
- Routing works with superpowers 7.x: however brainstorming ends, the route you chose wins over the next step it names. A plan goes to `forge:run --superpowers-plan`, a spec (also the short one superpowers 7.0.1 writes for a small change) to `forge:run --from-spec` (on «superpowers planifica, forge ejecuta», to `writing-plans` first), and an end without a file (a quick task, a small change agreed in the chat, the questions skipped) to `forge:run` with the decisions as the task text; the session never builds it itself.
- `/forge:run --from-spec` follows the triage: only a Large path imports the spec as the design's first version. On Trivial, Small or Medium the spec is the task text, every brief names it, and at the close forge stops offering it as a spec to start from.
- `sp-plans` and the routing leave out a superpowers plan with no trace of progress (no ticked box, ledger, forge record or `<title>: task N done` commit), as lens does, because superpowers' own executors finish a plan without ticking it. A request that names it still gets it, and when a request asks to carry out a plan and none is recommended, forge's why names the newest such plan.
- The shadow trial calls a reviewer whose xhigh twins found no blocker in any case `unverified` instead of passing it: with no data either way the reviewer stays as it is, and `FORGE shadow start` gathers more cases.
- Every `SKILL.md` weighs at most 16,000 bytes, so a compaction attaches it again whole: `forge:run` keeps the Medium path in `references/medium.md` and reads it again every time it gets there.
- The `PreToolUse` hook also starts on Read, Grep and Glob, for the secrets rule; outside forge's subagents it lets them through at once.
- Depends on waypoint ^0.36.0.

#### Fixed
- A commit made after a review is no longer merged unreviewed. `verdict` and `review-close` record the tree they judged as their receipt (none when the checkout had uncommitted changes). `swarm integrate` answers `unreviewed` when `task/<T>` no longer has the tree its review accepted, and the task is reviewed again; it merges the commit it checked, never a later tip of the branch. A merge on finish needs the tree the final review accepted, where it used to compare times and missed a commit made by hand on the run branch; after such a commit `swarm merge` asks you again, with `reason: tree changed since the final review`. forge's learned notes in `.forge/verify/*.md` and the run's own decisions file do not count as a change.
- After a compaction, a conversation with a loose forge task or an infinite run of its own got no text back. It is now told the task, its path, phase, brief and round and to invoke `forge:run` again before the next step, or to invoke `forge:infinite` again.

### 0.30.1 — 2026-10-24

#### Fixed
- Built with zod 4.6.7 in place of zod 3, which can exhaust memory while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5, no fix in 3.x). `.forge/config.yaml` and the decisions read as before, with the same defaults: `verify` and `verify.limits` still fill in each missing value.

### 0.30.0 — 2026-10-24

#### Added
- The product pilot (`/forge:infinite --profile product`): the `forge-market` agent researches similar products, what works, what users expect and prices, with a source for each finding, at the start and at each phase change (`market note`, `market last`; without web it says so and goes on); the scout, the critic and the planner read it. When a phase closes (`infinite phase --plan p --db d [--mark F]`, which prints `{closed, phases, held, reviewed}`), the `forge-phase-review` agent reviews the whole roadmap and proposes the re-plan (`waypoint replan`) and any change to the vision, which goes through `design-critic`; each is a `replan` or `vision` decision, recorded before the plan or the vision changes. When the phase that closed was the last one open, the review adds a phase for the gaps, debt and bugs it finds. The last phase close runs the market too, so the final rounds follow a fresh read. A spike does not re-plan in this version (`infinite phase` exits 2 there).
- `proposals replan-check --ops f --plan p --db d`, run before every `waypoint replan` of a product run: it refuses a re-plan that would retire, move, or change the title or `done_when` of a person's idea, a proposal the owner marked, a done task or a task blocked for the person, or move a task into a phase already reviewed. The phase review asks the person about such a change, and a re-plan that still tries one is dropped whole: the plan stays as it is and a debt note says why.
- `proposals retire <id> --plan p --why-file f` rejects the proposal of a task a replan retired, under that re-plan's decision, with the run's mark of its text; never a person's idea or a proposal the owner marked. A retire that resumes, with everything as it left it, prints its writes again; a proposal rejected already exits 4.
- In a product run, `proposals to-task` places each new task in its phase with a real `done_when`, its dependencies and its estimate (`--phase`, `--done-when-file` and `--estimate`, and `--depends-on` when it waits for tasks), never in the improvements phase. Without the flags it takes the placement of the critic's `keep`, for the text the critic judged; a placement that does not hold is refused, and an approval the run cannot place waits for the person as a debt note.
- In a product run whose phases with tasks are all done and none is empty, `proposals to-task` says that no phase of the plan is open, and the run opens one itself, at most once per cycle, through the re-plan path: an `add-phase` under a `replan` decision whose alternatives include leaving the approvals to the person, and a plan commit that names it. Only when that path is refused does one debt note, for the whole state, wait for the person.
- The `saturated` stop, for both profiles: `cycle --explore` records each exploration round (the scout and the critic), and after three in a row that pass nothing (no approval, and no v2 but a person's that waits for the owner), with no pending task, green validators and no open finding, verify defect or open proposal, the run stops as saturated and reports why; only an exploration round can end it so. `cycle` takes `--plan p --db d` every cycle and `--validate f` with that round's validators, and an input missing keeps the run going. Parked ideas, questions, blocked actions, deferred findings, proposals waiting for the owner's mark, approvals without it, tasks blocked for the person and approvals the run could not place are listed apart and never keep it going.

#### Changed
- Notes gain the `market` type and `sources`; `meta/infinite` carries the profile and the saturation report, whose `explored` says whether its cycle was an exploration round.
- In a product run `forge-critic`'s `keep` places the task (its phase, `done_when`, dependencies and estimate).
- In both profiles a revises chain gets at most two adapts: an adapt of a third version is judged as a drop. `proposals judge` logs each adapt, and a second adapt of the same text, in a later cycle, with no v2 added since is judged as a drop too («adapted twice; its v2 could not be added»), so a proposal whose v2 cannot be added no longer comes back every cycle. `proposals batch` gives each proposal its `version` in its chain.
- `repeated-error` compares the whole error, not the first 1000 characters `run.json` keeps of it.
- `proposals to-task` takes `--db d`, required in a product run, so a phase that is done never reads as open; a new task's id comes after the plan's `retired` ids too.
- Depends on waypoint ^0.35.0.

### 0.29.0 — 2026-10-24

#### Added
- Autonomous profiles: `/forge:infinite --profile spike|product "<idea>"` with a budget. `infinite prepare` creates or reuses the branch `forge/<profile>-<name>` and its worktree `.claude/worktrees/<profile>-<name>` (your main checkout is never touched, apart from forge's own state in `.forge/` and one line in `.git/info/exclude`); the run writes its own design (a short one for a spike, a vision for a product), takes it through `design-critic`, approves it, plans it and starts with `infinite start --profile`. It never merges into main or the start branch and never pushes. A profile runs one task per cycle in this version: `swarm start` refuses inside its worktree, and `--parallel` does not apply. `start --profile` refuses while a run is active, or when `.forge/run.json` does not read, and the run's session ids are kept in `.forge/autonomous/<runId>/sessions.json`, so a torn run.json still guards them.
- Delegated trust: in the worktrees of an autonomous run, a new or changed set of `.forge/config.yaml` commands is trusted without asking, for that run only, and noted as a `trust` decision with what changed, but only when every command passes the rules the guard would apply if the model ran it through Bash in that run; a command the guard would deny leaves the set untrusted, as before, and becomes a blocked action on the roadmap. Each command is judged as forge will run it, its placeholders filled, only in the profile's own worktree, and each start looks at the config again. A set you refused is never delegated: inside a run it is a blocked action, not a question, and so is a set forge could not judge or record.
- The proposal critic: `proposals batch` and the `forge-critic` agent judge each batch (keep, adapt, drop or clash); `proposals judge` approves on its own, with the owner's mark by `forge:auto`, only what passes, and records each approval and rejection. A verdict counts only for the proposal's present text, a v2 needs its own `keep`, keeps the standing of its whole revises chain and, decided, takes every open proposal of that chain with it, and `judge` records its decision before it writes anything else. `proposals batch --pending --out f` batches every proposal still to judge, and prints the `ids` it batched.
- The person's ideas: `proposals ideas` lists the roadmap's idea notes without a proposal, `proposals add --from-note|--from-chat` turns one into a user proposal linked to its note, and the run answers in its thread; an idea that clashes with the vision is parked until the person answers (`proposals unpark --insist|--withdraw`, from this conversation or in a later note of the owner's on that proposal's thread). Only the owner's ideas take the autonomous path; anyone else's wait for the owner's mark. `proposals policy` never approves a person's idea, and a note that says what an open or rejected proposal says joins that proposal's thread.
- `decision publish --session SID --since T [--run R]`: the roadmap notes of the automatic decisions the CLI took on its own; with `--run`, only that run's, those of its design and plan before the start included. `decision add` inside a prepared profile's worktree stamps its runId, and `decision list` takes `--run R`.

#### Changed
- The guard closes more holes outside the run: `fuser -k`, `at` and `batch`; user-level config (go env, conda, poetry and bundle without `--local`, macOS `defaults`, `Set-ExecutionPolicy` outside Process); `docker context` writes and `docker exec --privileged`; git's `-c` keys and `GIT_*` variables, which now pass only through allow-lists (an unlisted `-c` key denies); the ssh family (ssh, scp, sftp, rsync's remote shell), read with a full option table where an unknown option is an unknown target; `pg_ctl` on a data folder inside the run's roots; and `taskkill /PID` from Bash reads its switches as switches, not as paths (`/IM` and `/FI` stay denied).
- `proposals pull` prints the roadmap's `owner`; parked proposals no longer fill the queue.
- Depends on waypoint ^0.34.0.

### 0.28.0 — 2026-10-24

#### Added
- The guard (`hook guard`) gains nine rules for the sessions of an autonomous infinite run (the coordinator, its execution and its members by their ids, also once the run is inactive, and, while it is active, any session inside its worktrees): `self` (never the project's `.claude/settings*.json`, no `claude` command that switches hooks or permissions off, no new run from inside (`infinite start` without `--profile`); `stop` is allowed), `files` (no write, overwrite, link or delete outside the run's worktree, its temp folder or the scratchpad), `install` (installs only inside the worktree, no download-and-run installer), `database` (writes only on what the run registered), `network`, `cloud` and `mcp-write` (no write off the machine, by Bash or by an MCP tool whose name says it writes) and `git` (no push; main and the start branch are never checked out, rebased, fetched into or moved, and merge and reset act only inside the run's worktree, so only on its own branches; no tag deleted or moved, no `-c alias.*`, `core.sshCommand` or `core.hooksPath`; no branch deleted that is not the run's; nothing the clone shares), and `machine` (nothing of the person's processes, services or user-level setup: no kill by name, by process group or of every process, no service stopped, restarted, enabled, disabled or masked, no power-off or restart of the machine, and no change to their environment variables, scheduled jobs, registry or npm, pnpm, yarn, bun or pip config; the run stops what it started by its pid). Cloud CLIs are read by their shape (a read at the verb's position allows), migrations run only with their target on the command, a database script never does, the command inside `docker run|exec` and `compose run|exec` is judged, a container mounts only the run's volumes or folders inside its worktree (read-only mounts are free) and gets no host access (`--privileged`, `--device`, a host namespace, `--cap-add` of `ALL`, `SYS_ADMIN` and the like, an unconfined `--security-opt`), and the interaction tools of the person's signed-in browser (Claude in Chrome, the desktop app's browser) are denied. Each command is read as its shell reads it (Bash, PowerShell or cmd). A command whose target cannot be seen in one of the three dangerous classes is denied, and each denial is recorded without its secrets. In such a run the guard fails closed. The autonomous profiles that start such a run come in the next version.
- `resource add --kind <k> --name <n> [--host h]` and `resource list`: the register of what an autonomous run created (a database named `fg_<run>__…` on a local host, a container, volume or compose project named `fg-<run>--…`, a redis port from 1024 to 65535 that is not 6379–6381, a new SQLite file inside the worktree).
- `blocked list` and `blocked note [--session SID]`: what the guard denied becomes a `blocked` decision with its roadmap note.

#### Changed
- A decision's alternatives may be `{option, whyNot, tradeoffs}` and the chosen option may carry `tradeoffs`; `decision add`, `decision show`, the decisions file and the roadmap note take and print both forms (`decision show` gives every alternative as an object; the roadmap note keeps a plain one as text).
- The guard's matcher also covers the MCP tools (it already covered Bash, PowerShell, Edit, Write and NotebookEdit): every MCP call of every session now starts the hook's node process, which reads files only and starts no git process when no autonomous run is involved.
- The trust rules judge a protected file by the repository that holds it, so a `CLAUDE_PROJECT_DIR` outside the session's repository no longer lets the model write the authorizations or `trust.json`.
- `/forge:infinite` keeps its execution steps, its Large triage and its stop report in references it reads at that step, so its rules survive a compaction (Claude Code re-attaches only the first 5,000 tokens of a skill).
- `forge-verify` and `forge-verify-heavy` no longer inherit the `Agent` tool (`disallowedTools: Agent`).
- Depends on waypoint ^0.33.0.

#### Fixed
- A forge call whose node binary is quoted (`& "node.exe" "…forge.cjs" hook answer`, the usual PowerShell form) no longer gets past the guard (6a N4).
- The no-roadmap refusal of `proposals to-task` names the proposal in `/forge:decide <id> confirm` (6a N6).
- The README says which characters after `hook answer` or `local set commands` make a text a call: a space or tab, an end of line, `;`, `|`, `&`, `<`, `>`, `(`, `)` or a backtick (6a N3).

### 0.27.0 — 2026-10-24

#### Added
- `hook guard`, a `PreToolUse` hook on Bash, PowerShell, Edit, Write and NotebookEdit. It denies the model's Edit, Write and NotebookEdit on the authorizations of `.forge/execution/auth/`, the trust in the commands of `.forge/config.yaml` (`<git common dir>/forge/trust.json`) and `.forge/local.yaml`, and a Bash or PowerShell call of `hook answer` or `local set commands` (also with `--cwd` between the words or a shell metacharacter right after them): only the person's answer records those. It recognises patterns and is no sandbox: quoting, node flags that take a value, scripts, the `nodejs` binary name and path names only the disk resolves can get past it, a closing quote right after the word or a quoted word (`hook "answer"`) gets past it, any text that mentions such a call and has a space, an end of line, `<`, `>`, `(`, `)` or a backtick right after the words is denied (a commit message, an `echo`), if a setting ran AskUserQuestion without its dialog the model's `answers` could reach `tool_response` (the authorizations share this and do not compare the question's header and options), and with `CLAUDE_PROJECT_DIR` outside the session's repository its auth and trust rules can miss (D9).
- `verify-close --no-learn`: it writes no surface and prints in `learned` the notes it would have added (D4).

#### Changed
- The trust in the commands of `.forge/config.yaml` is recorded by `hook answer` from the person's answer to the question forge printed, which shows the full hash of the commands it lists; it records only when every matching checkout has that one hash. The person's fallback is to type the line Claude gives in the prompt, `! FORGE local set commands allowed --expect <hash> --cwd "<dir>"` or `… denied --cwd "<dir>"`, with FORGE written as `node "<absolute path of forge.cjs>"` and `<dir>` the checkout. No skill runs `local set commands` any more (D9).
- `proposals to-task` exits 2 for a proposal that only a mark in `approvals/` approves, with no decision of this checkout, on a roadmap without the owner's rule; `proposals list` gives it the reason `no-rule`, and the refusal says to approve it in this checkout (`/forge:decide <id> confirm`) or publish the roadmap with `/waypoint:plan` (D3).
- `/forge:review` closes its verification with `verify-close --no-learn`: it leaves no surface file changed, and its report lists the notes and how to keep them with `surfaces learn` (D4).
- With `validate.retry: flaky` and a `--baseline`, a test validator (`test`, `e2e`) that fails and did not fail on the base runs once more; a pass then is `flaky` and enters the history. The baseline retry does not apply to typecheck, lint or build; the flaky history and `always` apply to every kind (D7).
- `prep`'s `validate` carries `--baseline`, and `validate --baseline` names the validators on stderr, only when one failed: `new failures: …; already failing on the base (not yours): …`; the implementers fix only the new ones (D8).
- A review where verify abstains (blocked, or only the environment failed) lists the verify findings it left open in `deferred` as `env-unverified`, only when the review accepts; they stay open, and `swarm step` says so (H1).
- The Small path closes its verification with `verify-close`; Large closes its flow pass and commits its notes before the final review's verdicts (H2, H3).

### 0.26.0 — 2026-10-20

#### Added
- `verify-env --task <id>-<n> --dir <review dir>`: a free port of `verify.ports` (`41000-41999` by default) and a browser profile of its own for each verification, so two of them never share either; the same round gets the same ones again (K2-07).
- `verify-spawn --dir <evidence dir> [--cwd <code checkout>] -- <cmd…>`: the verify agent starts what it needs detached, in the code checkout it is given, its output in `logs/`, each spawn recorded in `logs/<n>.pid.json` with its start time and image; it prints `{started, pid, log, running}`. A command that ends within 1 s with another code did not start (`code`, `logTail`); one that ends with 0 is started and done, and is not recorded. On Windows the command runs through cmd.exe (`%NAME%` expands; a line break in an argument is refused) (K2-03, K2-20).
- `verify-preflight --plan <plan>`: the surfaces an execution's plan may use that need the person, asked once before any task starts; `--skip <name>` keeps «No, esta vez» for the whole run, and only the coordinator records it, from the main checkout (K2-08).
- The flow pass: `verify-plan --run` plans the surfaces of a run's integrated result since the last pass, at depth flow, and `verify-close --flow` closes it (a `verify-flow` event, `flow` in `execution.json` and in `runs/<runId>`). Its folder is `.forge/work/flow-<runId>-<n>/` and never reuses a number; `since` comes from the last pass, else from the run's own recorded integration merges; `verify-close --flow` closes only a real pass folder, from the main checkout. `verify.flow: final` (the default) runs it before Large's final review, which takes its `verify.json` with `verdict --verify`; `phase` also when a phase's last task is integrated (`swarm step` says so); `off` never. An ephemeral run does it at the end of its batch. `verify-plan --run --whole-run` plans the whole run instead of what is new since the last pass (the final review's pass and its re-review) (K2-13).
- `surfaces digest --run <runId>`: what a run's verifications learned, by surface, bounded, shown once at its end (K2-11).
- `review-prep --sensitive` (security reviews whatever the diff touches) and `--report` (red validators never hold a review that fixes nothing) (K4-06, K2-17).

#### Changed
- `verify-cleanup` stops a process only while it is still the one recorded (a reused pid goes to `reused`; one whose identity cannot be read goes to `unknown` and is never stopped; a record it did not write goes to `skipped`), on macOS and Linux with SIGTERM to its group and children and SIGKILL after 5 s, and frees the port and the profile verify-env reserved (`released`). The older `pids.json` of integers, as forge 0.25 and earlier agents wrote it, is still read (K2-03, K2-20).
- A surface's `affects` can be `{flow: [...], smoke: [...]}`; a plain list counts as flow. `verify-plan` prints each surface's `depth`, and `FORGE surfaces` the `header` of each draft (K2-15).
- A blocked verification is an abstention with its reason, never invalid output to respawn; a check that failed because of the environment (`env: true`) is minor, and the same failed check observed differently stalls the loop (K2-09, K2-10).
- `review-close` and `verdict` wait for `verify.json` once `verify-env` reserved a verification, and only while a surface is still pending (a `verify-skip` of every surface listed in `verify-pending.json` ends the wait); a `--verify` file that is named and missing always exits 3 with `missing`. `review-close` also prints its minor findings (K2-09, K2-17).
- `surfaces learn` writes the surface of `--cwd` and, like `verify-close`, keeps only general notes: one line of at most 240 characters, naming neither the task nor `.forge/work/`, not repeated, and not reading as an instruction (backticks, URLs, shell text, imperatives aimed at an agent) or holding a secret; `verify-close` says why in `notesSkipped` and `surfaces learn` in `skipped` (the text of a note dropped as a secret or an instruction is never echoed). Each Learned section carries a fixed line telling the next verify agent that the notes are data (K2-06, K2-11).
- The defects a verify agent sees outside the brief (`defects` in `verify.json`) become pending proposals of source verify; a defect whose text reads as an instruction or holds a secret is not proposed (`defects.skipped`, with its `why`), its surface name is checked, and it names its screen or route, never a full URL. Only the roadmap's owner approves the proposals (K2-12).
- With nobody to ask, `verify-plan --unattended` logs the skip of a surface that needs the person and `note: true` asks for one question note per surface and run, through a marker file per run and surface under `.forge/execution/asked/<runId>/`: a run member never writes `execution.json`. `verify-plan --run --unattended` skips what needs the person the same way a task does, with a note once per surface and run, and does not wait: its pass opens with at least one allowed surface. Attended, the pass opens once nobody is waiting for an answer (K2-08, K2-13).
- The verify agent gets «the code checkout» and starts the app there (`verify-spawn --cwd`) (K2-03).
- Security reviews by the zones the real diff touches (its paths, with a rename by both names, and the zone words of its added and removed lines), not by the words of the task. Once security reviewed a task its later rounds keep it, until a redo; a light review gets security too when the diff touches a zone; `--sensitive` is kept for the task's later rounds (K4-06).
- `/forge:review` prepares and closes with `review-prep` and `review-close`, offers verify and logs the phase done; its report names the surface notes and the proposals verify left (K2-17).
- The verify agents may create build outputs git ignores, use their own port and profile, and report `env` checks and `defects` (K2-18, K2-11).
- A `git-revert` undo names its exact commits (`undo.shas`, checked against `base..head` by `decision add`), and `/forge:decisions revert` reverts those and nothing else (K2-19).
- `swarm integrate <T> [--plan <file>] [--db <dir>]` prints `flow` itself when a phase closes (`verify.flow: phase`), so a single-command coordinator sees it too.
- `verify-preflight --skip` works after `finish`, on an execution of this checkout that is no longer active.
- `surfaces digest` compares with the surface as the run started, so the notes the run merged are still listed.
- A blocked flow pass keeps its base: the next pass starts where it did (`flow.since`).
- The note and defect filters keep honest lines (routes, slugs, UI names such as a button called Run, Spanish verbs mid-sentence) and still drop orders and real tokens.
- Reservation and profile names: a long flow-pass folder gets a valid name, and a browser profile names its checkout.
- `execution/asked/<runId>` is pruned with its run's state.
- Depends on waypoint ^0.32.1.

#### Fixed
- A reservation file's content can no longer name a file to delete.
- `verify-close` stops the processes and frees the port and the profile even when `verify.json` is unusable.
- A fix round's security carry follows the fix's content, not just its paths.
- An environment failure no longer closes a product finding of the same check.
- A check name over 200 characters re-matches its finding.
- A note or a defect dropped as a secret or an instruction is not echoed back.
- The note and defect filters read an honest line as one (a route, a slug, a button called Run, a Spanish verb in the middle of a sentence) and still drop real tokens and orders: `debes` and `no compruebes` anywhere, `ignora`, `ejecuta`, `skip` and `ignore` as orders, a path after `run`, and «can skip».
- `/forge:infinite` makes a whole-run flow pass at each finish (one more verify agent per finish). `verify-plan --run --whole-run` records `whole` in `flow.json` and `execution.flow`, and answers `flow: null` when that pass already closed at this commit.
- `/forge:verify` by hand closes with `verify-close`, so its defects become proposals. In an execution, proposals are left to the end-of-run digest.
- On Windows, a forge process that created `.forge/execution.lock` while another one removed it got `EPERM` and crashed: it exited 1 and its update was lost. It now waits as for a busy lock. The same holds for the port locks of `verify-env`.

### 0.25.0 — 2026-10-19

#### Added
- `begin --task id [--cwd d] [--locale es|en] [--autonomy auto|ask]`: the start of a task in one call. It prints the changes of the tree that are not forge's with the question to ask about them, takes the tree snapshot (`snapshotError` says why when it could not), and prints the TDD line, the resolved autonomy and workflow and an untracked `.forge/.gitignore`; it asks, commits and stashes nothing (J-12).
- `route.hint: on|off` in `.forge/config.yaml`, and `FORGE_ROUTE_HINT=off`, turn off the one-line hint of `UserPromptSubmit`; a route half done is reminded anyway (K1-03).

#### Changed
- forge:run starts each task with `FORGE begin`. The close of a review round moved to `references/review-close.md`, which Medium and the task steps cite, so a run member never reads forge:run's `SKILL.md`. The Small verification, the surface permission rule, the start from a spec and the summary of auto mode moved to the references that hold each case. Its size on invoke went from ~7.8k to ~6.1k tokens (`SKILL.md` 22 479 → 17 727 bytes), and `review-close.md` is 3 314 bytes. A Large coordinator reads 95 978 bytes of skill text (`SKILL.md`, `large.md`, `execution.md`, `step.md`, `task-steps.md`, `review-close.md`, `verify.md`, `decisions.md`) (J-12).
- The routing hint leaves out messages from agents (a prompt that opens with a harness or agent tag; a JSX-opening prompt keeps the hint), questions that are not a polite request, and prompts that open with an interrogative; it keeps polite requests («hola, ¿puedes…?», "can we…", «añade…, ¿vale?») (K1-03).
- `forge route` recommends forge for a Large request (superpowers designs only to build a spec that exists, `--build-spec`), and the plan or spec the request names: matched against every pending one, not only the three it lists, the longest name winning and accents aside, and named in the recommendation's `why`; a request that names one no longer offered (by its path, file name or a title of several words) gets none recommended, never the newest instead (K1-06, K1-07).
- `sp-plans`, `sp-specs` and `forge route` no longer offer a plan done in the main checkout (its SDD ledger), by forge's record from any worktree, or by its `<title>: task N done` commits, nor a spec a plan already cites (among the newest 200 plans) or a route already handed off; `sp-specs` reads the routes and no commits (K1-07).
- forge:route carries the raising rules of forge:run and the Bounded hand-off: a brainstorming that writes no spec is handed over to forge:run with the agreed decisions as the task text (K1-06, K1-10).
- `scripts/route-eval` runs three configurations (with superpowers, without it in the test repository's own settings, without the hint) over 16 prompts with what each expects, and reports false negatives and positives and the cost. A Small prompt counts apart, either way: forge's rules send it to forge:route, which steps aside. `--dry-run` creates nothing, any other argument or a flag without its value exits 2 before any work, and a real run removes its work folder unless `--keep`. Every session starts from the demo shop's first commit, the configurations with the hint drop an exported `FORGE_ROUTE_HINT`, and the summary says when a session's plugins contradict its configuration. The demo shop has 6 files, so forge no longer triages it as greenfield, and every prompt's expectation is checked offline against forge's triage. The pass, and the manual one of the mixed modes, are ready and not run (K1-02, K1-06).
- forge:run's references hand a route off with its spec (`--from-spec`) or its plan (`--superpowers-plan`), and a superpowers plan closes its route on every stop.
- The long-line check covers every forge CLI file.
- Depends on waypoint ^0.32.0.

#### Fixed
- A superpowers SDD ledger counts for a plan only when its first line names that plan's path, or an absolute path that ends with it: one that names `pkg/docs/…/x.md` no longer counts for `docs/…/x.md` in `sp-plan tasks`, the triage and the routing (`sddComplete`).
- Writing `.forge/execution.json` or a task's public file tries a rename that Windows refuses for a moment (`EPERM`, `EBUSY`, `EACCES`: an antivirus, or another process holding the file) again, up to five times, before it fails.

### 0.24.0 — 2026-10-19

#### Added
- `swarm tick` (a `start` in sessions mode) and `swarm relaunch` print `launch`: the member's session as forge composes it (worktree, branch, name, the `/forge:member` prompt, `command` and `run`, with `swarm.member`'s effort and model); the coordinator runs `launch.run`. A `--plan` that cannot go into it exits 2 before anything is written (A-19).
- `sp-plan check` of a superpowers task without checkboxes records it in `.forge/sp-done/<slug>.md` of the main checkout, which `sp-plan tasks` and the triage read from any worktree, and the routing from the main checkout; the output gains `recorded`. The record names the plan by its repository path (the same from any worktree), appends instead of rewriting, and a failed write fails the check (exit 2) (D-17).

#### Changed
- forge finds waypoint's CLI through `installed_plugins.json` (the entry of forge's own marketplace first) before scanning the cache, so a higher version left by a downgrade, or one from another marketplace, is no longer picked (I-18).
- A crash of a validator run (a segfault, a core dump, V8 out of heap, a fatal error) beside a failure the base already had, a failing test or a tsc error, is no longer excused as a failure that was there; a crash line also counts as a failure line (handover from 1a).
- `execution.json` is only written under its lock (`saveExecution` is private), and two real processes test it (I-15). One whose `project` is not a safe id reads as none, as one with such a run id or coordinator already did.
- `swarm tick` and `swarm next` read the roadmap's listings with the shared tolerant reader and say on stderr each document they skipped, as waypoint does; `swarm step` passes the tick's warnings on to its stderr (I-14).
- The CLI is one module per command (`src/forge/cli/commands/`, `src/forge/cli/swarm/`), with the same commands, flags and outputs (I-12).
- A `swarm.launcher: herdr` left in a config reads as `bg`, and the member's launch says so (I-18).
- Depends on waypoint ^0.31.0.

### 0.23.0 — 2026-10-18

#### Added
- Your trust in the commands of `.forge/config.yaml` (each validator's `cmd` and `affected_cmd`, and `swarm.setup`), tied to their hash: the triage prints `trust` with its question, `local set commands allowed --expect <hash>|denied|none` records the answer, and nothing runs them without it (exit 2; `swarm start` exits 3; a run stalls with `untrusted-commands`: with you there the coordinator asks and starts a new run, unattended it leaves one note per set of commands). «No» runs only the validators forge detects. The trust lives in `<git common dir>/forge/trust.json`, so a committed `.forge/local.yaml` grants nothing, and outside a git repository forge asks every time (when git cannot tell where the repository is, `local set commands` says so). The question lists every command, with any non-ASCII character shown as `<U+XXXX>`, and a duplicate validator name is a config error (I-03).
- A final merge needs your recorded answer: `swarm merge` prints `needs-authorization` with its question, the new hook `answer` (PostToolUse on AskUserQuestion) records your answer in `.forge/execution/auth/`, and `--yes` merges only on that yes, from the same session within the hour. An away-from-keyboard auto-submit, or a yes with a note, does not count, and one answer allows one merge; a question that another record copies is asked afresh, so a copy cannot keep it unanswerable. `authorize merge-on-finish` records the start question; asked before the run exists (auto mode at launch), it takes `--project`, names that project and counts only for it and that session, for 24 hours. `swarm propose` prints the `runId` and `swarm start --run-id` adopts it, so a yes given before a `/clear` still counts. Run ids have propose's exact shape and are never reused (I-03).

#### Changed
- `swarm start --merge-on-finish` without your recorded yes starts with `mergeOnFinish: false` and says why; a `forge/…` branch needs no answer. Merge-on-finish merges a finished run once, and only after the final review accepts. In auto mode the merge question is asked at launch even when the request already says to merge (I-03).
- The README recommends `Bash(node *forge.cjs*)` in `.claude/settings.local.json` of the projects you trust, `deny: Bash(*forge.cjs* hook *)` so Claude cannot call the hook commands by hand, and optional `ask` rules for every final merge and for `local set` (I-03).
- A surface permission in a `.forge/local.yaml` that git tracks grants nothing, and a tracked `.forge/learned.jsonl` records nothing, so a repository cannot ship an allowed surface; `local set surfaces.<name> allowed` refuses and says to untrack the file. When git cannot tell whether they are tracked (it refuses to run there, or fails), they grant nothing either (I-03).
- Depends on waypoint ^0.30.0.

### 0.22.3 — 2026-10-18

#### Changed
- Depends on waypoint ^0.29.0, whose roadmap shows the history of the runs forge publishes in `runs/`, one forecast end and Plan's filters for deferred findings and rounds over the cap.

### 0.22.2 — 2026-10-17

#### Changed
- Depends on waypoint ^0.28.0, whose roadmap shows forge's data in its new Summary, «In progress» and task detail, and lets only the roadmap's owner approve proposals, writing the owner's mark itself. `/forge:decide <id> confirm` remains for a mark written elsewhere.

### 0.22.1 — 2026-10-17

#### Changed
- The design loop in auto mode converges: round 1 with its critical and major proposals applied and the minor ones dismissed with their reason, then `round --verify` on what changed until the critic says `ready` (at most 3 rounds; a third `changes` verdict stops the loop and asks you), and approval only when nothing critical or major is left and no applied change is unread.
- `/forge:infinite` in auto mode reopens the approved design for a Large task (`/waypoint:design reopen`, once per task) and syncs the plan's `design_version`; `forge-planner` gives each task the `design_ref` of its section. A loop that stops without approval leaves the design a draft and blocks the task with a question; a task closes its pass only once the design is approved and the plan has tasks for its section, and until then no cycle reopens the design or builds the task.
- Reverting a design approval reopens the design with `--kind reopen`.
- Requires waypoint ^0.27.0.

### 0.22.0 — 2026-10-17

#### Added
- `FORGE roadmap-doc <T>` writes the task's `state/T` update, built by the CLI: a forge block of at most 4 KB (brief, stage, review rounds with their findings and reviewers, the accepted round, validators with time and cache, verification, stage times, integration, deferred findings), the evidence of every check by round (`--assets` adds the uploaded screenshots and keeps them) and its `exec`. `swarm task`, `report`, `step`, `integrate` and `merge` print the same `publish`, `swarm task` and `report` take `--claim`, and `swarm status` prints `meta/run`.
- `FORGE roadmap-run --run <id> | --task <id>` writes `runs/<runId>`, the summary of a run once it ends (or of a task closed outside one), and `cleanup`, the executor sessions to remove; `swarm close` prints it.
- `infinite start`, `cycle` and `infinite status` print `meta/infinite` with its coordinator (seat, Claude's id and lease).
- `swarm integrate` keeps the integrated `sha` and prints `meta/metrics` apart; the roadmap knows when a task is done but not merged yet.
- `decision add --session <SID>` prints the decision note and, with `resolves`, the update that closes the question it answers.
- Only the roadmap's owner approves: `proposals decide` and `policy` print the owner's mark (`approval`: status, `decidedAt`, `by` and a SHA-256 `digest` of the proposal's id and decided fields, so a proposal edited after its approval is no longer approved), `decide confirm` marks an earlier decision, `proposals pull --approvals --page` copies the marks, and `to-task`, the infinite run and `proposals list` (`unowned`) count only proposals whose mark agrees with them. `to-task` refuses a spent proposal (one already turned into a task). `reopen` prints the deletion of the remote mark, and a mark counts only if this checkout's latest decision for the proposal matches it. A roadmap published before waypoint 0.26.0 lacks the owner's rule: republish it with `/waypoint:plan` after upgrading, and until then no mark counts.

#### Changed
- Auto-approval fails safe: only proposals forge itself added are auto-approved, and only with objective signals (a tests proposal names a test file); nothing that proposes deleting or migrating data, or touches a sensitive zone by its path or its words, is approved without you.
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

### 0.16.0 — 2026-10-27

#### Added
- **lens finds this conversation's project.** It used to read the folder the session started in, so a conversation started in a folder above several repositories and working in one of them showed only Now, Subagents and Usage. It now reads the session root or a repository one level below it, chosen by this conversation's anchor: a forge run it coordinates or is a member of, a waypoint binding of its own (these join the project, and everything shows as before, other sessions' work in it included), or its own work alone, a lone forge task or a superpowers ledger or plan it wrote (only that work, and the needs tied to its own tasks, show). A shell `cd` does not move it.
- The anchor is searched again only on the session start, opening the panel, a waypoint or forge CLI call or skill of the main session (not of a subagent), writing a superpowers ledger or plan, the session root moving, or the anchor being lost; the ordinary refresh walks no other repository. A folder below the session root counts only when it is a git checkout.
- When the session root or the anchored repository cannot be read, the panel and the photo say it in one line with the path and the reason (`cannot read <path>: <reason>`). A missing folder says nothing; a refused unrelated folder only goes to the debug log.

#### Changed
- **A clean session shows only its own.** With no anchor nothing is read from project files (no Roadmap, Execution, Tasks in progress, Waiting for you, superpowers card, proposals, infinite run or automatic decisions); Now, Subagents, Usage, Todos and Claude Code tasks stay, and the language is Claude Code's `language` setting. This holds also when the session started inside the repository: another session's run and tasks no longer show there, dimmed or not.
- The usage file `.forge/usage/<session>.json` is written only with an anchor, in the anchored repository, once it has a `.forge/`.

### 0.15.0 — 2026-10-26

#### Changed
- The **Todos** and **Claude Code tasks** cards are never drawn empty: not before the first call, nor after an empty TodoWrite or once the only task is deleted.
- `/lens` opens the pane first and reads the files after, so it answers at once also with several agents working; an inline pane opened before its first read is asked again for the rows its cards take. `/lens foto` waits at most 5 s for its read, then takes the photo from what lens holds.
- Rebuilt with the code it shares with forge 0.32.0 and waypoint 0.37.0.

#### Fixed
- lens with Claude Code's built-in `cc-plugin-sec-default` plugin in front, as it is on Team and Enterprise organizations and on managed installations: that plugin sends every `classic.*` hook and `session.compact` past the plugins you install, so lens saw no subagent start or end, no Claude Code task and no compaction. It now follows subagents from `agent.spawn` and their own `turn.complete` (the agents list checks them on each refresh), fills the Claude Code tasks card from the TaskCreate and TaskUpdate calls, and tells a compaction from a main request that carries fewer messages than the one before, the same with that plugin in front or without it. A test keeps lens and waypoint's band off every event that plugin passes over.
- A `/lens` that failed or ran out of time left only «lens registered /lens but no command.run hook answered it»; it now answers with a readable reason and leaves it in the debug log.
- The superpowers card of a superpowers 7 run, whose ledger names its plan by an absolute path (`X:/…`, `X:\…`, `/x/…` or `/cygdrive/x/…`): lens reads that plan when it lies inside the project or, from a worktree, its main checkout, also by the real path of a project under a symbolic link. Without a plan it can read, the card shows «N done», with no total and never a false 100 %.
- A subagent resumed by a message keeps its task, and an agents list that still says it runs just after it ended no longer brings it back.

#### Known limits
- The real cause of «no command.run hook answered it» (`/lens live`) was not reproduced: `/lens` now answers with the reason and leaves it in the debug log.
- The inline pane opened again with its cards' rows is untested against a real engine.
- A `/rewind` counts as a compaction.
- A subagent continued with SendMessage shows as finished between its runs.
- If `cc-plugin-sec-default` ever skipped `agent.spawn`, lens would only see subagents through the agents list.

### 0.14.0 — 2026-10-26

#### Added
- The **Waiting for you** card: what waits for your answer, oldest first, up to 6 rows and `+N`: a review round's question, a merge to authorize, your trust in the commands of `.forge/config.yaml`, a stopped execution, the roadmap's open questions, the proposals to decide, a design ready to approve and a surface permission. Each row says where it is, how to answer it (the command, or «your turn in the coordinator's conversation» while that conversation is open) and how long it has waited; a source that could not be read says so. The band shows `» waiting for you N`. It reads only the newest of each source: 20 authorizations, 50 proposals and 100 notes of the roadmap's cache.

#### Changed
- The **Todos** card appears once the session called TodoWrite, the **Claude Code tasks** card once it heard a `TaskCreated` or a `TaskCompleted`, and todos alone no longer bring the band up. Since Claude Code 2.1.233 the newest models (Opus 5.5 among them) have no TodoWrite and no task tools by default; `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in Claude Code's environment brings the tools back, and the cards with them.
- Rebuilt with the code it shares with forge 0.31.0 and waypoint 0.36.0; nothing else lens shows changes.

### 0.13.11 — 2026-10-24

#### Changed
- Rebuilt with the code it shares with forge 0.30.0 (the run's exploration rounds and saturation report); nothing lens shows changes.

### 0.13.10 — 2026-10-24

#### Changed
- Rebuilt with the code it shares with forge 0.29.0 (the autonomous block of run.json with its profile, branch and worktree, and a proposal's `parked`); nothing lens shows changes. In a profile run, lens in the main checkout shows the main checkout's proposals, not the profile worktree's.

### 0.13.9 — 2026-10-24

#### Changed
- Rebuilt with the code it shares with forge 0.28.0 (decisions with trade-offs, the autonomous block of run.json); nothing lens shows changes.

### 0.13.8 — 2026-10-24

#### Changed
- Rebuilt with the band model of waypoint 0.32.2 (`coordinatorOpen` on the notice of a run); nothing lens shows changes.

### 0.13.7 — 2026-10-20

#### Changed
- Rebuilt with the code it shares with forge 0.26.0 and waypoint 0.32.1 (a decision's `shas`; an execution's `verifySkip` and `flow`); nothing lens shows changes.

### 0.13.6 — 2026-10-19

#### Changed
- Its bundle carries no zod and is minified (I-13). Its roadmap card shows a plan that `waypoint validate` rejects (the CLI is the one that validates), without the tracks, phases and tasks whose id breaks the plan's id rule, and with titles and phase names as one clean line. Its superpowers card reads a plan's title in linear time (carry from 4d).

### 0.13.5 — 2026-10-18

#### Changed
- Rebuilt with esbuild 0.28; nothing lens shows changes (I-17).

### 0.13.4 — 2026-10-18

#### Changed
- Rebuilt with waypoint 0.29.0's metrics, which no longer carry the old ETA; nothing lens shows changes.

### 0.13.3 — 2026-10-17

#### Changed
- Rebuilt with waypoint 0.28.0's metrics (each version's progress); nothing lens shows changes.

### 0.13.2 — 2026-10-17

#### Changed
- Its bundle follows waypoint's design loop: the design band counts the critiques in `docs/waypoint/<project>/design/critiques/`, merges the `dismissed.json` of both places as waypoint does, and leaves out the proposals an interview resolved.

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

## java

### 0.1.1 — 2026-10-26

#### Changed
- `architecture-reviewer` runs git as `git -C <root>` and Gradle as `./gradlew -p <root>` from wherever it starts, so «run it from the repository root» and «never `cd`» no longer contradict each other.
- Gradle runs with `--no-daemon` by default and always in the foreground, in the reviewer and in the testing reference: a daemon or a background run outlives the review or the session.
- The two Boot starters (Boot 3 with Jackson 2, Boot 4 with Jackson 3) are stated as of 2026-10, and `java-oss-library` asks to confirm in `gradle/libs.versions.toml` that both still exist.

### 0.1.0 — 2026-10-26

#### Added
- First version, for Java and Spring Boot. `spring-hexagonal-ddd` (`/java:spring-hexagonal-ddd`, or by itself when its description matches the work) fixes the eleven rules of a service with DDD and hexagonal architecture: a core free of the framework, ports and the package layout, aggregates and value objects, domain events apart from integration events, the outbox in the same transaction, a `DomainException` with its `code` rendered as an RFC 9457 problem, ArchUnit as the guard, every read through specification-repository, idempotent consumers that tolerate events out of order, a business «no» as a result and never a remote exception, and Flyway never editing an applied migration. Six references (tactical DDD, the hexagonal layout, cqrs and specification-repository, messaging and the outbox, persistence and Flyway, testing) are read when the work reaches them. When the project lacks what a rule names, the skill follows the project's own mechanism and says which rule could not apply.
- `java-oss-library` (`/java:java-oss-library`), for the upkeep of Java libraries built like spring-boot-cqrs and spring-boot-specification-repository. It sends Claude to the repository's `AGENTS.md`, which stays the contract, and adds only what that file lacks: build changes go to `build-logic`, what a new module must be added to, the two Boot starters, 100 % coverage, the Maven Central release, the `agent-ready` and `needs-design` issues, the merge train after a squash merge, and `docs/superpowers` kept out of `main`.
- `architecture-reviewer` (`@agent-java:architecture-reviewer`), an on-demand, read-only reviewer on Opus at high effort with `spring-hexagonal-ddd` preloaded. It reads a branch's diff, or a diff file, against those rules, runs ArchUnit or `./gradlew quality` when the project has them (never what needs Docker) and returns each finding with its file, line, rule and severity, and a verdict. It is not a forge reviewer: nothing runs it by itself.
- It pins no version: the skills read them from the project's `libs.versions.toml` or from Context7. It is text only, with no hooks, and needs none of the other plugins.

## web

### 0.1.1 — 2026-10-26

#### Changed
- `astro check` takes the TypeScript range in the `peerDependencies` of `@astrojs/check` (TypeScript 6 as of 2026-10), read there and not from memory, instead of a fixed «TypeScript 6».
- Rule 10 allows a short `AGENTS.md` with what must travel with a site's repository (commands, layout, conventions); what it forbids is copying the skill's rules into it. `CLAUDE.md` and `.claude/` stay out.
- Lighthouse's headless Chrome starts on a free port and with the GPU flags (`--enable-gpu --use-angle=d3d11` on Windows).
- Dokploy's issue 5417 and Vite's `data:video/mp2t` worker URL are dated (seen in 2026-10).

### 0.1.0 — 2026-10-26

#### Added
- First version: the `astro-dokploy-site` skill, for a static Astro site with Preact islands that pnpm builds into a Docker image where nginx serves `dist`, deployed by Dokploy and gated by GitHub Actions. It settles the build and the islands (the `mounted` pattern, `min-height` against layout shift, the literal Vite worker call, MDX prose with components), the CSP (`security.csp` with hashes per page, hashed `is:inline` scripts, no `<style is:inline>` in figures, `worker-src`), the checks (Prettier as its own gate, `astro check` with TypeScript 6, Playwright's webServer under Claude Code, Lighthouse on Windows and in CI, real Chrome), the deploy (the Dockerfile at the root, nginx headers and MIME types, Dokploy's path and context fields) and a site repository without `CLAUDE.md`, `AGENTS.md` or `.claude/`. Four references (islands, CSP, checks, deploy) hold the procedures and are read when the work reaches them. It is text only; install it at user scope, since a site's repository carries no `.claude/`.

## ml

### 0.1.1 — 2026-10-26

#### Changed
- Rule 2 no longer pins `cu128`: it takes the highest `cuXXX` index that carries the torch the project asks for, confirmed with `uv lock` (as of 2026-10-26, cu128 stops at torch 2.11.0 while cu130 and cu132 reach 2.14.1), and its `pyproject.toml` pattern is on cu130.
- The rest between long jobs (15–20 minutes by default) and not stacking heavy jobs on the GPU are general advice for a GPU that runs hot under load, not the policy of one machine; the cap of three GPU jobs at once is gone, and the VRAM budget still decides.
- The renames of trl 1.x and transformers 5.x, and the JSEP and asyncify notes of in-browser inference, are dated (2026-10).

#### Known limits
- The cuXXX and torch figures of rule 2 are dated 2026-10-26 and will go stale.

### 0.1.0 — 2026-10-26

#### Added
- First version: the `ml-local-gpu` skill, for machine learning on a local NVIDIA GPU. It reads the project's `pyproject.toml`, lock, CI and README first and pins no package version; runs everything through `uv run`, with the torch wheel for the GPU or the CI; sizes jobs from the free VRAM `nvidia-smi` reports, with at most three at once; runs a job of 30 minutes or more alone, with the GPU's temperature at its start and end and 15–20 minutes of rest after it; checks trl, transformers and peft calls against the installed version; splits validation by the unit that leaks, never by row; runs notebooks whole and checks every claim against their outputs; writes text with `newline='\n'`; and runs `ruff format` when the CI checks it. Two references, read when the work gets there, cover inference in the browser with ONNX Runtime Web on WebGPU (one session at a time, the download agreed per model) and publishing on Hugging Face (cards in English, an acceptance criterion written before training, the token from `HF_TOKEN` or the login). It is text only and needs none of the other plugins.

## crew

### 0.1.1 — 2026-10-26

#### Changed
- `novice-reader` and `playtest-qa` run only when you ask for them by name: their descriptions say so.
- `playtest-qa` closes a project server started through npm as a tree on Windows, `taskkill /T /F /PID` by its PID, never by name.
- The limit of two headless browsers with the GPU at once holds for any headless browser on the machine, not only those of `playtest-qa`.

### 0.1.0 — 2026-10-26

#### Added
- First version, with two agents you call by name. `novice-reader` (Opus, high effort, read-only) reads documents, courses or web pages as one newcomer (a full-stack developer with no ML by default, a junior Java developer, a recruiter or a persona you describe) and reports where they get lost, the terms left undefined, the steps they cannot follow and what they would skip, each with its exact quote, its place and a severity. It never rewrites; given its earlier report, it checks the fixes and the seams they left.
- `playtest-qa` (Opus, medium effort) plays a browser game prototype as a new player, with real keyboard and mouse input in headless Chrome on the GPU and never through the game's own functions: by default the tutorial and the first half hour. It checks that there is always something to do, that the player sees in numbers whether they improve and that the theme explains each mechanic, and gives figures per minute. At most two of its browsers run on the machine (a queue of two slots), it uses the project's own server or a static one with the right MIME types, and it stops only the processes it started, by PID. crew is text only and needs none of the other plugins.
