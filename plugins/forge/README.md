<div align="center">

# 🔨 forge

**An adaptive way of working for Claude Code.**
Triage by size, the right model for each role, your own tools first, independent weighted review, and parallel or unattended runs when the work is big.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.14.0](https://img.shields.io/badge/version-0.14.0-fab387?style=flat-square)
![depends on waypoint ^0.18.0](https://img.shields.io/badge/depends%20on-waypoint%20%5E0.18.0-cba6f7?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/paths.en.svg" alt="forge triage routes a task to the Trivial, Small, Medium or Large path; below, the implementer ladder and the three reviewers" width="100%"></p>

## Contents

- [Why forge](#why-forge)
- [Install](#install)
- [Usage](#usage)
- [Paths](#paths)
- [Agents](#agents)
- [The Large path](#the-large-path)
- [With superpowers](#with-superpowers)
- [Routing and auto mode](#routing-and-auto-mode)
- [Execution modes](#execution-modes)
- [Infinite mode](#infinite-mode)
- [Proposals](#proposals)
- [Verification](#verification)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)

## Why forge

Doing every task the same way wastes effort. A full review of a one-line fix costs more than it saves, and a big change without one breaks things. forge sizes each task first and spends accordingly:

- **Proportionate.** Trivial work stays in the main session. Only Medium and Large work pays for independent review.
- **Tools before opinions.** Your tests, linters, type checker and build run before any reviewer reads the diff.
- **Independent review.** Reviewers are separate agents that never wrote the code. They judge it against the brief and return scored verdicts, and forge weighs those into a decision.
- **The right model for the role.** Mechanical work goes to Haiku; delicate work goes to Opus at extra-high effort.
- **Scales out.** Big plans run as an execution of parallel tasks, and infinite mode keeps improving the project within a budget.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install forge@bg-kit
```

forge depends on [waypoint](../waypoint/README.md) ^0.18.0, which is installed with it. [lens](../lens/README.md) is optional and recommended. Restart Claude Code after installing or updating. Recommended permission: `Bash(node *forge.cjs*)`.

## Usage

| Command | What it does |
| --- | --- |
| `/forge:run <task>` | Triage the task and work it on the path its size calls for. |
| `/forge:run --parallel N <task>` | Same, running up to N tasks at once on the Large path (3 by default, max 10). |
| `/forge:run --from-spec <spec> [<task>]` | Start the Large path from a superpowers spec, imported as the design's first version. |
| `/forge:run --superpowers-plan <plan>` | Run a superpowers plan task by task on the Medium path, with validators, review and verdict. |
| `/forge:run --auto <task>` | Work the task in auto mode: questions only at launch, every decision recorded. |
| `/forge:review [<base>]` | Review a branch with forge's validators and reviewers, without fixing it. |
| `/forge:infinite [--cycles N] [--hours H]` | Unattended improvement cycles within a budget. |
| `/forge:decide <id> approve\|reject\|comment <text>` | Decide or comment on a proposal from any session. |
| `/forge:decisions [revert <n>]` | List what forge decided without asking, and undo one after your confirmation. |
| `/forge:verify [surface]` | Check the work by using it (web, emulator, CLI...), or create and edit verification surfaces. |
| `/forge:stop` | Stop the infinite run or the execution. |

```text
/forge:run Fix the off-by-one in pagination            → Trivial or Small
/forge:run Add rate limiting to the public API         → Medium: short plan, implementer, validators, review
/forge:run Rebuild checkout with multi-currency support → Large: design, plan, roadmap, then each task
```

## Paths

| Path | Gate | Executor | Validation | Review |
| --- | --- | --- | --- | --- |
| **Trivial** | none | the main session; `mech` when it is one request of a batch | validators on the changed file | none |
| **Small** | none | always delegated: `mech` (Haiku) for mechanical work, `impl-light` (Sonnet) otherwise; the session itself only when the whole change is already in its context and is 10 lines or fewer | all validators + reading the diff | none |
| **Medium** | short plan, continues unless stopped | `impl` / `impl-heavy` | all validators | correctness (+ security when sensitive) |
| **Large** | mandatory approval of the design | `/waypoint:design`, `/waypoint:plan`, then each task at its own size (Trivial `mech`, Small `mech` / `impl-light`, Medium `impl` / `impl-heavy`, Large `impl` / `impl-heavy`) | all validators | per task, by its real diff: one light correctness review on Sonnet for Small or less, otherwise correctness (+ security when sensitive, + perf on performance tasks); final whole-branch review |

Triage reads the task text, the files it is likely to touch and the sensitive zones (auth, data and migrations, public API, dependencies, CI), and picks the validators that apply. `forge triage` also prints the `implementer` for the size (its role, agent, whether the session does it itself, and why), resolved through the profile; `--batch` marks one request of several.

**The review loop.** Reviewers write JSON verdicts. `forge verdict` weighs them into a score, and `forge round` decides the next step: `done`, `resume` (fix with the same implementer), `fresh-stronger` (a new implementer one tier up), `redo`, `breaker` or `stalled`. From round 3 it moves up a tier, and Large tasks get up to 4 rounds.

## Agents

| Agent | Model | Effort | Use |
| --- | --- | --- | --- |
| `forge-mech` | Haiku | default | mechanical work: renames, data, code already written, builds |
| `forge-impl-light` | Sonnet | default | small, bounded changes |
| `forge-impl` | Opus | medium | medium implementation and investigation |
| `forge-impl-heavy` | Opus | xhigh | important or delicate implementation |
| `forge-fable` | Fable | default | only when you explicitly ask for it |
| `forge-review-correctness` | Opus | xhigh | correctness review |
| `forge-review-security` | Opus | xhigh | security review |
| `forge-review-perf` | Opus | xhigh | performance review |
| `forge-verify` | Sonnet | high | uses the work through a surface and reports evidence (`forge-verify-heavy`, Opus, also high, on the `quality` profile) |
| `forge-planner` | Opus | xhigh | Large path: turns an approved design into a waypoint plan |
| `forge-scout` | Opus | medium | infinite mode: evidence-backed improvement proposals |

Implementers write their report to `report-<n>.txt` and also include it in their reply. The `economy` profile steps implementers down one tier and `quality` steps them up; reviewers never change with the profile. The light review of a small plan task runs `forge-review-correctness` on Sonnet at medium effort.

## The Large path

1. `/forge:run` runs `/waypoint:design` and **waits for you to approve the design**.
2. `forge-planner` writes `plan.yaml` and `/waypoint:plan` publishes the live roadmap.
3. `/waypoint:work` claims each task, and its "do the work" step becomes the forge loop: `brief --plan`, `triage --plan` (who implements it, by the task's size), an implementer, the validators, `triage --base` (the size again, now from the real diff alone) and the reviewers that size calls for, for up to 4 rounds. A diff of 3 files or fewer and 200 changed lines or fewer, outside sensitive zones, gets one light correctness review on Sonnet, unless the task touches a sensitive zone (its text, its plan zones or its diff); a larger one gets correctness, plus security on sensitive zones and perf on performance tasks.
4. When the tasks are done, `review-correctness` reviews the whole branch against the design and the plan, with at most one fix and one re-review. The re-review gets fresh validators and a fresh diff, and a `redo` verdict is treated as a fix.

The run's base is kept in `.forge/work/<project>/run.json`, written once after the design is approved. While a task runs, the coordinator renews a lease (`leaseUntil`, 10 minutes) on the task's state and on its own waypoint session, so parallel sessions do not recover a task that is still being worked. Besides the lease, the coordinator leaves a local signal in `.forge/live/` (see [Live signal](#live-signal)).

## With superpowers

forge works next to [superpowers](https://github.com/obra/superpowers) and reuses what it wrote. It finds it in `installed_plugins.json` (under `CLAUDE_CONFIG_DIR` when set); when superpowers is missing or turned off, these bridges stay quiet.

- **A spec becomes the design.** `/forge:run --from-spec <spec>` (or `/waypoint:design new --from <spec>`) imports a brainstorming spec as the design's first version: same sections, «Imported from» on its page, and the pillars taken from the spec. forge recommends a critic round, then follows the Large path. Without the flag, the Large path offers once to start from a spec superpowers wrote in the last 14 days.
- **A plan runs through forge.** `/forge:run --superpowers-plan <plan>` takes the plan's unfinished `### Task N`, in order and one at a time, on the Medium path: each one becomes a brief with its steps verbatim, goes through validators, verify, reviewers and the verdict, and its boxes are ticked when it is accepted.
- **TDD.** With `tdd: superpowers` in `.forge/config.yaml`, every implementer brief asks the implementer to follow superpowers' `test-driven-development` skill and to report the failing run and then the passing one; the correctness reviewer flags a missing one as important.
- **Review any branch.** `/forge:review [<base>]` reviews a branch against its base (by default, where it left the default branch): validators against a baseline of the base, correctness, security on sensitive zones and perf when asked, and a scored verdict. It never fixes or merges; it offers `/forge:run` with the findings.

## Routing and auto mode

**Routing.** forge puts a short rule in each new session (a `SessionStart` hook) and, on prompts that look like coding work, a one-line hint (`UserPromptSubmit`): before any other process skill, superpowers' included, the session runs `forge:route`. It triages the request, and trivial and small work go on without it. For Medium and larger work it asks once who does it: forge, superpowers, «superpowers diseña, forge construye» (brainstorming writes the spec, forge builds from it) or «superpowers planifica, forge ejecuta» (superpowers writes the plan, forge executes it); without superpowers, forge or no forge. The recommended option comes first. While superpowers designs or plans, the prompt hook reminds the session that chose the route to hand over to forge. A recent spec is recommended only when the request asks to build it. The hooks stay quiet inside forge's own executions and infinite runs, and with `workflow: superpowers` or `workflow: off`.

**Preferences.** `workflow:` (`ask`, `forge`, `superpowers`, `superpowers-design`, `superpowers-plan`, or `off` for no forge) and `autonomy:` (`ask`, `auto`) go in `.forge/config.yaml` (the team's) or `.forge/local.yaml` (yours: `forge local set workflow <w>|none`, `forge local set autonomy ask|auto|none`). What the request says wins, then `local.yaml`, then `config.yaml`, then `ask`; `forge prefs` prints the result and where each value came from.

**Auto mode.** With `autonomy: auto`, `/forge:run --auto` or a request that says so, forge asks only at launch, in one message: changes in the tree that are not the task's, whether to merge the run branch at the end (Large), and the budget (infinite mode). Then it decides alone and records each decision (`triage --autonomy auto`, `swarm start --autonomy auto`): the route, raising the path, applying the critic's critical and major proposals (up to 3 rounds), approving the design when `waypoint design-gate` allows it, confirming the plan and choosing the mode. Any other doubt becomes a question note and the safe path. It never merges into main without the launch answer, pushes, deletes, publishes beyond the private roadmap, touches changes that are not the task's or surface permissions, starts infinite mode without a budget, closes escalations or decides proposals outside the policy. In infinite mode with auto, a Large task is designed, approved and planned on the infinite branch instead of being blocked.

## Execution modes

<p align="center"><img src="../../docs/assets/swarm.en.svg" alt="A coordinator session on the run branch forge/run-<project> launches an implementer subagent per ready task, each in its own task worktree; tasks are integrated into the run branch one at a time and merged into your branch at the end" width="100%"></p>

On the Large path and in infinite mode, forge runs the plan's tasks through **one planner** that works per task: `forge swarm tick` decides which tasks are ready (their dependencies are integrated and their zones do not overlap) and which finished work to integrate, up to `swarm.parallel` at once. There are two modes:

- **subagents** (the default). The coordinator session works each task with subagents in a git worktree of its own.
- **sessions**. Each task runs in its own `claude --bg` session, named `wp-<project>-<T>`, in the worktree `.claude/worktrees/task-<T>`. That session runs the forge loop for its one task, publishes its stage and never integrates: the coordinator does.

Sequential execution is not a third mode: it is subagents with N = 1.

**When to pick each mode.** Subagents is the default: it costs less and everything happens in one session. Choose sessions for very long plans, or when you want to talk to each task.

**How the mode is chosen.** forge proposes one (`forge swarm propose --plan <plan>` says how wide the plan is and recommends a mode and N), or you say it ("en enjambre", "con subagentes", "en paralelo", "secuencial"), or you fix it with `swarm.mode` in `.forge/config.yaml`. N is your `--parallel N` if given, else the recommendation, capped by `swarm.parallel`.

**The run branch.** An execution works on `forge/run-<project>`, in the worktree `.claude/worktrees/run`. Open the app from there to see the run's work as it grows. Your checkout is not touched until the final merge, which asks for your permission, or uses the one you gave when the run started (`--merge-on-finish`). `swarm start` refuses the default branch as `--branch`, and never pushes.

**Task worktrees.** Each task gets `.claude/worktrees/task-<task>` on the branch `task/<task>` (`forge swarm worktree <task>`). Right after creating a worktree, forge installs its dependencies with `swarm.setup` in `.forge/config.yaml`. Without it, the command is deduced from the lockfile: `npm ci` for `package-lock.json`, `pnpm install --frozen-lockfile` for `pnpm-lock.yaml`, `yarn install --frozen-lockfile` for `yarn.lock`. A Python `.venv` has no safe default: set `swarm.setup`. The result (its command and the last lines of output) is shown to you, and a failed install never stops the run.

**Integration.** A finished task is merged into the run branch with `forge swarm integrate <task>`, one merge at a time, running the validators after each one. Failures that **already existed** on the run branch do not block: the validators are compared with a baseline cached per scope, target and commit in `.forge/execution/baseline/`, and only new failures roll the merge back (a conflict does too). The final `forge swarm merge` into your branch does the same and answers `merged`, `needs-authorization`, `main-dirty` or `conflict`.

**Stopping.** `/forge:stop` (or `forge stop`) ends the execution: the coordinator sees the stop and finishes its step, and a run whose session is gone is closed anyway. After a stall caused by a conflict or a blocked task, `forge swarm retry <task>` reactivates the execution without another `/forge:run`.

**State and visibility.** The state lives in `.forge/execution/` (the run, one file per task) and is mirrored to the roadmap's `meta/run`. The roadmap, lens and the band show it: one row per running task with its stage, agent, duration and liveness. Executor and manual sessions appear with their own liveness.

**Stalled fronts (sessions mode).** The planner watches each session. After 15 minutes without a stage change, if the session is idle, `swarm nudge` sends it a reminder. If the session stopped, `swarm relaunch` starts it again with a handover note, `.forge/work/<T>/handover.md`, at most 2 times; the third failure blocks the task. A relaunched session gets a 10-minute window before it is judged again. A task its session marks blocked is blocked in the execution too: it frees its slot and is never nudged nor relaunched. When the last task is claimed by another live session, the run waits instead of stopping.

**Manual sessions.** Any session where you run `/waypoint:work`, or ask it to "take a pending task", joins the execution with the role `manual` at any time (`swarm join`). It takes tasks with the same planner (`swarm next`), works in its own task worktree (`swarm worktree <T> --member`) and reports its stages (`swarm report`); the coordinator integrates its work. A member only acts on its own task and never writes `execution.json`.

**Resume and handover.** `claude --resume` of the coordinator or of an executor receives the execution's context on SessionStart. A new session takes over from the coordinator only when it is stopped (`swarm takeover`); otherwise it joins as a manual member. A run member cannot take over. If the run branch is behind its base, `swarm start` brings it up to date (`baseSync`: `created`, `up-to-date`, `fast-forward` or `merged`); on a conflict it refuses and nothing is lost.

**Unattended.** In `/forge:infinite`, under `/goal` and in run members, forge does not ask. It leaves question notes on the roadmap and records every decision it takes in your place.

**Decisions.** Each decision forge takes without asking is recorded with what it chose, the alternatives, why and how to undo it (`forge decision add`). With a roadmap it also appears there as a decision note tagged **auto**. Without one it goes to `docs/forge/decisions/<scope>.md`, committed with the work. Every final report ends with an «Automatic decisions» section, lens and the band show how many there were in the last day, and `/forge:decisions revert <n>` undoes one (a `git revert` of its commits, reopening the design, removing the plan tasks it added that have not started, or deleting its branch) after asking you.

**Requests during an execution.** New work lives on the run branch, not on your branch. In the coordinator session, a Trivial or Small request you want now is done in the run worktree with its own commit (or becomes a task that depends on the running one if the files overlap); a Medium request becomes a new plan task that the next tick starts; a Large one or a new block gets its own design and plan without stopping the execution; questions are answered in the session, and what must stay goes as a roadmap note. In another session the same rules apply as a manual member.

**Several requests at once.** Several independent requests in one message, and the independent briefs of a Medium task, run in parallel as an **ephemeral execution**: the same planner, always with subagents, with N = min(`swarm.parallel`, parallel tasks). Each task works in `.claude/worktrees/task-<id>` from your current branch and is integrated **into your current branch**, one at a time, as soon as it is accepted; there is no run branch and no merge question. Integration refuses if your checkout is no longer on the branch the run started from. A task with no zones runs alone, and dependencies and cycles are checked. You see it in lens and the band and, when the project has a roadmap, there as **Loose tasks** (outside `plan.yaml` and the plan's progress). A Large request leaves the batch, and with a single task there is no ephemeral execution. `swarm start` refuses while another run is active that it is not resuming. A conflict when integrating the task of an executor or manual session gets one fix round with the coordinator's subagents (`swarm retry <T> --adopt`, which refuses if the holder's worktree has uncommitted changes); on the second, it escalates.

**The launcher.** `swarm.launcher: bg | herdr` chooses how a session is opened. A time-boxed spike found that herdr cannot open panes from the command line, so `--launcher herdr` exits with code 2 and the coordinator uses `bg`. herdr is not supported yet.

### Live signal

`forge hook live` runs on SessionStart, SessionEnd, SubagentStart, SubagentStop and Stop. The coordinator of an active execution and the registered members (`.forge/members/<SID>.json`: executor and manual sessions) write `.forge/live/<sessionId>.json` in the main checkout, each with its role, the last event, the time and the subagents that are running. The hook always works on the main checkout, also from a task worktree. The first Stop or SubagentStart of the execution binds the coordinator: from then on only that session writes the coordinator's signal. lens and the band read it: a session is shown as **silent** after 7 minutes without events and **stopped** after 12, unless the signal lists a subagent started less than 3 hours ago (a coordinator waiting on a long agent stays alive). Subagents that started more than 3 hours ago are dropped. The roadmap does not read `.forge/live`: it uses the leases in the coordinator's `sessions/<SID>` and in each task's `state/<T>.exec`, which the coordinator extends to the agent's expected budget (at most 90 minutes) when it dispatches one. The hook prints nothing and never fails.

## Infinite mode

`/forge:infinite [--cycles N] [--hours H]` needs an approved waypoint design, a plan and a budget. It asks once when no budget is given, and `forge infinite start` refuses to start without `--cycles` or `--hours`. It runs `forge infinite start`, writes `meta/infinite` to the roadmap and ends the turn. The first Stop hook binds that session to the run, so use one session per checkout.

**Each cycle** forge:

1. pulls decisions from the roadmap;
2. turns approved proposals into plan tasks (`proposals to-task`);
3. works one task through `/forge:run` inside `/waypoint:work`. A task triaged as Large is not designed unattended: it is blocked with a question for you, and the run moves on;
4. when `waypoint next` finds no task, or every 3 cycles, spawns `forge-scout` to write new proposals (`proposals add`, `proposals policy`);
5. records the cycle with `forge cycle --progress yes|no`.

**Policy.** Only low-risk, verifiable proposals are auto-approved: a tests fix, small quality debt, perf with a benchmark in the evidence, or security with a test in the evidence. Features, dependencies, architecture and any medium or high risk wait for you (on the roadmap, in lens or with `/forge:decide`). A proposal similar to a rejected one is refused unless its evidence is new. One similar to an open proposal is always refused; a v2 names the proposal it revises with `--revises`. **Nothing is merged into main or pushed without your authorization.**

**Stop conditions:**

- the file `.forge/stop` exists;
- the budget (cycles or hours) is used up;
- 3 cycles in a row made no progress;
- the same error happened twice in a row;
- the Stop hook blocked twice without a recorded cycle;
- nothing is approved while the pending queue is full.

When a stop condition first appears, the Stop hook marks the run inactive and blocks once, so the session closes the run: it turns off `meta/infinite` and reports. An inactive run never blocks again. `/forge:stop` marks the run inactive itself, so a run whose session is gone can be stopped and a new one started. A run left idle resumes when the next turn in its session ends. waypoint's own Stop hook coexists; forge blocks only while `run.json` is active.

## Proposals

A proposal is a document with these fields:

```json
{ "ts": "…", "category": "perf", "risk": "low", "title": "…", "rationale": "…", "evidence": "…",
  "pillar": "…", "estimate": "…", "path": "small", "status": "proposed", "source": "scout", "author": "…" }
```

| Field | Values |
| --- | --- |
| `category` | feature, security, perf, quality, tests, deps |
| `risk` | low, medium, high |
| `status` | proposed, discussing, approved, auto_approved, rejected, done |
| `source` | scout, user |

Only `proposed` and `discussing` proposals can be decided, and only by you (on the roadmap page or with `/forge:decide`). Sessions only create proposals and comment on them. A local mirror lives in `.forge/proposals/<id>.json`; the roadmap's database wins for the decided fields (`proposals pull`).

`/forge:decide` works from any session, even without the roadmap. In that case only the local copy and the ledger change, and the next `proposals pull` replaces the local decision with the roadmap's state. With `--from <db doc json>`, the CLI checks the decision against that document and records nothing. After the roadmap update succeeds, `/forge:decide` stores the updated document with `proposals save --from`, so a failed or refused roadmap write never leaves a local decision behind.

While forge works a waypoint task, it also writes a small `forge` block (path, phase, agent, validators, verdict, round) to the task's `state/T` document, which the roadmap and lens show.

## Verification

Tests and reviewers read the code; verification **uses** the result. A **surface** is something in the project that can be checked by using it: a web page, an app in an emulator, a simulated device, a CLI, a desktop app. A surface has no type: it is a Markdown file in `.forge/verify/<name>.md` that says in free text how to start it and how to try it.

**Surfaces appear in three ways:**

- **By chat.** Tell the session how to check something ("start the emulator, pair the scale, weigh") and it writes the file for you, without asking.
- **By detection.** forge spots a web app, an Android or Flutter project and the like, and proposes a draft surface for you to accept.
- **By experience.** `forge-verify` appends what it learned (a slow first start, a flag that must be on) to the surface's `Learned` section, so the next run starts smarter.

**When it runs.** On Medium and Large tasks, when the diff touches a surface's `affects` globs. A surface without `affects` is always a candidate and the session decides. On Trivial and Small tasks it runs only when the task asks for it. A surface runs only if you have allowed it (see Configuration).

**The agent.** `forge-verify` (Sonnet; `forge-verify-heavy` on Opus with the `quality` profile) starts the surface, tries the task's main flow and writes `verify.json` plus screenshots under `.forge/work/<id>/`. It runs in parallel with the reviewers, and its failures count in the verdict like a reviewer's. It never edits project files, never commits, pushes or merges, and never installs project dependencies. `verify.limits` caps how many checks, screenshots and minutes it spends.

**Evidence on the roadmap.** With `evidence: upload` (the default) the screenshots are uploaded to the roadmap and appear in the task detail. Uploading makes the roadmap **organization-internal**, so it can no longer be shared publicly; forge tells you once. With `evidence: local` nothing is uploaded and the roadmap stays publicly shareable. Evidence stays under `.forge/work/` either way.

## Configuration

`.forge/` in the project holds `config.yaml`, `verify/` (the surfaces), the ledger, `local.yaml` (your preferences and surface permissions), `learned.jsonl` (the `Learned` lines forge added), `status.json` (the last task, with `taskStartedAt`, `stageSince`, `stages` (seconds per phase) and `doneAt` for lens's timings), `work/<task-id>/` (briefs, diffs, reports, reviews, verification evidence), `proposals/`, `run.json`, `execution/` (the execution and its baselines; each task in `execution.json` records `finishedAt` when it is integrated, blocked or adopted with `swarm retry <T> --adopt`), `live/` (the local signal) and `usage/`. Git ignores everything in it except `config.yaml` and `verify/*.md`.

```yaml
profile: balanced              # balanced | economy | quality
detect: true                   # default true
exclude: [build]               # detected validators you do not want, by name
validators:                    # manual
  - name: unit
    cmd: npm test
    kind: test                 # letters, digits and _ . : -
    affects: ["src/**", "test/**"]
  - name: a11y
    cmd: npm run a11y
    kind: a11y
    when: medium               # optional: always | medium | final
verify:
  limits: { checks: 8, shots: 10, minutes: 10 }   # optional; these are the defaults
evidence: upload               # upload | local; default upload
validatorTimeoutSec: 600
tdd: off                       # off | superpowers: implementers follow superpowers' TDD skill
workflow: ask                  # ask | forge | superpowers | superpowers-design | superpowers-plan | off
autonomy: ask                  # ask | auto
swarm:
  parallel: 3                  # tasks at once; 1 runs one at a time; max 10
  mode: subagents              # optional: subagents | sessions
  setup: npm ci                # optional: installs a new worktree's dependencies; default deduced from the lockfile
  launcher: bg                 # bg | herdr; default bg
```

`swarm.setup` is a command of up to 500 characters, run in each worktree forge creates. `.forge/config.yaml` is the one file of `.forge/` that git does track, so a `setup` you commit applies to everyone who runs the project.

> **Changed in 0.6.0:** a `validators` list in `.forge/config.yaml` no longer turns detection off; detected validators are used too, and yours win by name. Set `detect: false` for the previous behaviour.

**Validators.** With `detect: true` (the default), forge detects the project's tools and merges your `validators` list into them; a manual validator replaces a detected one with the same name, and `exclude` drops detected ones by name. With `detect: false` only the listed set runs, and `validators: []` means none.

- `kind` is any name made of letters, digits and `_ . : -` (`test`, `lint`, `e2e`, `a11y`...). `when` says when a validator runs: `always`, `medium` (Medium and Large tasks and the final review) or `final` (only the final review of a Large run). A `kind` forge does not know defaults to `medium`.
- `verify.limits` accepts at most `checks: 20`, `shots: 30` and `minutes: 60`.
- `evidence` is `upload` or `local`, as described in [Verification](#verification).

**Surfaces** live in `.forge/verify/<name>.md`: an optional header (`affects` globs that make the surface a candidate, `tools` it uses), free-text instructions, and notes under `## Learned`.

```markdown
---
affects: ["src/ble/**", "src/devices/**"]
tools: [adb, chrome-mcp]
---
# Bluetooth scale

Start the Pixel_7 emulator and the app with `npx cap run android`.
The scale is simulated with `node tools/fake-scale.js` (it advertises "SCALE-01").
Pair from Settings > Devices and weigh: the weight must show on the main screen.

## Learned
- 2026-10-14: pairing fails if the emulator has Bluetooth off: `adb shell svc bluetooth enable`.
- 2026-10-15: the app takes about 40 s to start the first time.
```

**Permissions.** `.forge/local.yaml` (not in git, one for every worktree of the repository) holds your allow or deny per surface, and the first time a surface would run, the session asks. The permission is tied to the file's content (a hash of the whole file, except the `Learned` lines forge added itself): if anyone edits the surface, for example in a commit, a PR or a task, it asks again, shows the diff since you allowed it and offers «yes, always», «not this time» and «never in this project». `surfaces learn` records each line it adds in `.forge/learned.jsonl`, so forge's own notes never trigger the question, also when parallel tasks add notes to their own copies; lines added by anyone else do. Only you grant a permission: the session never re-allows a surface a task changed.

**Matching.**

- `affects` is a list of globs over repo-relative paths with `/` separators. `*` matches within one path segment and `**` matches across segments (`src/**`, `web/*.ts`); no other glob syntax is supported.
- A validator with `affects` runs on `validate --affected` only when one of the changed paths matches. Without `affects`, it always runs.
- Which validators run depends on the kind and the moment: `test`, `lint`, `typecheck` and `other` always run; `build` is skipped with `--affected`; `e2e` runs only on Medium and Large tasks when its `affects` match the diff (or it has none), and at the final review; `bench` runs only at the final review. A kind forge does not know runs on Medium and Large tasks and at the final review. A validator's `when` overrides all of this. `--all` therefore does not run every validator.

## CLI reference

Run as `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs" <command>`.

<details>
<summary><b>Tasks and review</b></summary>

- `triage [--task id] [--batch] [--autonomy auto|ask] [--locale es|en] (<text> | --text-file f)` - classify a task: path, files, sensitive zones, validators and the `implementer` (role, agent, self, why). `--batch` marks one request of several, so a Trivial one goes to `mech`. `--text-file` reads the text from a file, so it never goes through a shell. `--autonomy auto` records that the task runs in auto mode. It also prints `announce`, the line the session shows (path, reason, implementer and new validators, in the `--locale` language, else the plan's), `gate` (`plan` for Medium: the short plan comes first) and, while `.forge/.gitignore` is not in git, `untracked`. A short request that changes one quoted text («change the page title to "X"») is Trivial.
- `triage --plan p --task T` - triage a plan task from its zones and `done_when`; it prints the `implementer` too. A plan task ignores the greenfield rule, and a Large one goes to `impl` (`impl-heavy` on a sensitive zone).
- `triage --plan p --task T --base sha` (also without `--plan`, with a text) - size an implemented task again from its real diff, `git diff --numstat <sha>..HEAD`: more than 3 files or more than 200 changed lines is Medium, more than 10 files is Large, a sensitive zone is at least Medium. The size comes from the diff alone: a sensitive zone is a floor of Medium, and so are the earlier `--base` sizings of `T`; for a plan task only the triages of its own plan project count. It also prints `diff` (`base`, `files`, `lines`, `path`) and `review` (`light`, `reviewers` with their `agent`, `model` and `effort`, and the verdict `flags`).
- `brief --plan p --task T [--design d]` - print a task brief built from a waypoint plan task, including the `Commit title prefix` line that implementers use.
- `brief --superpowers-plan f --task N` - print the brief of task N of a superpowers plan: the plan's header and global constraints, the task's body verbatim and the rules forge adds (plus the TDD line with `tdd: superpowers`).
- `triage --task id --superpowers-plan f` - triage a superpowers plan from its pending tasks and their files; the path is always Medium.
- `sp-plan tasks <f>` - a superpowers plan's header and tasks (`n`, `title`, `files`, `steps`, `done`).
- `sp-plan check <f> --task N` - tick the boxes of task N only (never inside code), keeping the file's line endings.
- `sp-specs` / `sp-plans` - the specs (not imported yet) and the plans (with tasks left) superpowers wrote here in the last 14 days, 3 at most.
- `sp-path <skill>` - the `SKILL.md` of a superpowers skill, or `null` when superpowers is not installed for this project.
- `tdd` - the config's `tdd`, whether superpowers is installed, and the TDD line briefs carry (`null` when off or not installed).
- `prefs [--workflow w] [--autonomy a]` - the resolved `workflow` and `autonomy`, and where each came from (`request`, `local`, `config`, `default`).
- `route --task id --path p [--workflow w] [--autonomy a] [--run-plan] [--build-spec]` - the routing options, superpowers and its recent specs and plans, and the recommended option. `--run-plan` and `--build-spec` say the request asks to carry out an existing plan or build an existing spec.
- `route set --task id --chosen o --by user|auto [--spec f] [--plan f] [--session s]` - keep the chosen route in `.forge/route.json` and record the `route` decision; only the session `--session` names is reminded of it.
- `route stage --stage s [--task id] [--spec f] [--plan f]` - move a pending route on (`designing`, `planning`, `handed-off`, `done`).
- `hook route-session` / `hook route-prompt` - the routing hooks (SessionStart, UserPromptSubmit); they print nothing on any error.
- `local set workflow <w>|none` / `local set autonomy ask|auto|none` - your own preferences in `.forge/local.yaml`.
- `validate [--affected a,b | --all] [--path trivial|small|medium|large] [--base sha] [--final] [--task id] [--base-run | --baseline f]` - run the project validators that apply (see Matching); `--base` gives the diff that e2e `affects` are matched against, `--final` selects the final review's set. `--base-run` marks a run on the base commit, before any change; `--baseline f` takes that run's JSON and marks a failure the base already had `preexisting`, which neither the exit code nor the verdict counts. A test runner that finds no tests passes as `skipped: "no-tests"`.
- `verdict --task id --dir d [--validators f] [--sensitive] [--perf]` - weigh the reviewers' JSON files into a score. A reviewer is listed with `invalid: true` when its output was unusable (`dropped: 0`, counted as an abstention) or when some of its findings were dropped (`dropped` > 0; the review keeps its verdict and still scores, and the skill records the dropped findings as a ruling).
- `round --task id --path medium|large` - decide the next step of the review loop (`done`, `resume`, `fresh-stronger`, `redo`, `breaker`, `stalled`; `tierUp` from round 3).
- `log --kind k [--task id] [--data json | --data-file f]` - append to the ledger. A `triage` entry that raises the path may carry a `why`, which the next `announce` names.
- `decision add --data-file f [--task id]` - record a decision forge took (strict JSON: `point`, `what`, `chosen`, `why`, `by`, optional `alternatives`, `weight`, `revert`, `undo`, `safePath`, `revertOf`, `task`, `runId`); prints it with its number `n` and keeps `.forge/decisions.json`, the summary lens and the band read. During an active execution it carries the run's id.
- `decision list [--task id] [--run id] [--since iso] [--all] [--auto]` - the decisions, numbered; with no filter, those of the latest scope. `--auto` leaves out your own answers.
- `decision show <n>` - one decision, with its `undo`.
- `decision md --scope s [--out f] [--locale es|en]` - write the automatic decisions of a scope to `docs/forge/decisions/<scope>.md` (or `--out`); writes nothing when there are none.
- `last --task id` - the path, last phase event, last verdict and last round of a task.
- `agents` - agent names for the active profile.
- `surfaces [learn --name N --notes-file F [--heading H] | proposed --name N]` - list the surfaces and detected drafts; append notes to a surface's `Learned` section; mark a draft as proposed.
- `tools [--surface N]` - check the tools a surface lists: `found` (on the PATH or among the MCP servers configured for Claude Code: plugins, `.claude.json`, `.mcp.json`), `missing` (a known program that is not installed) or `unknown`.
- `local get [surfaces.<name>] | set surfaces.<name> allowed|denied|none [--expect <hash>]` - read or write surface permissions in `.forge/local.yaml`; `allowed` also keeps the allowed text (a git blob) so a later change can be shown as a diff, and with `--expect` it refuses when the surface changed after `verify-plan` printed that hash.
- `verify-plan --task id --path p --base sha [--asked] [--locale es|en]` - decide whether verification runs and which surfaces are candidates; a changed surface comes with its `diff`, its `commits` and the question to ask (`ask`).
- `verify-result --task id --dir d` - record the result of a `verify.json` outside a verdict (a Small task, a check by hand), so lens shows the task finished.
- `verify-cleanup --dir d` - stop the processes `forge-verify` left running (from `pids.json`).
- `waypoint-cli` - print the absolute path of waypoint's `waypoint.cjs` (found next to this plugin, highest version); exits with 2 when it is not found.
- `tree snapshot --task id [--cwd d] [--force]` / `tree check --task id --base sha [--cwd d]` - record the tree when a task starts (the first snapshot is kept) and, before closing it, list the files the task's commits hold (`task`) apart from the new (`appeared`) and modified (`changed`) files nobody in the task created: those are the person's, and the session never deletes or reverts them.
- `config get <key>` - the current value of a `.forge/config.yaml` key of the main checkout, defaults applied (`config get evidence` prints `upload` or `local`); read right before acting, since the person can change it while a task runs.

</details>

<details>
<summary><b>Proposals</b></summary>

- `proposals add --file f [--author a]` - create a local proposal (id `p` + timestamp + 4 characters); `--author` wins over an `author` in the file.
- `proposals list [--status s]`
- `proposals decide <id> approve|reject|discuss [--reason-file f] [--by who] [--reopen]` - decide the local copy, log it and print the `write` payload. With `--from <db doc json>` it only checks that document and prints the `write`. A proposal already decided is refused (it says who and when); `--reopen`, used only after the person confirms, changes an approval or a rejection and keeps the earlier decision in its `history` (never a `done` proposal or one already turned into a task).
- `proposals save --from <db doc json> [--id id]` - store a roadmap document as the local mirror, and log the decision if its status changed.
- `proposals pull --dir d` - refresh the local mirror from the roadmap's `proposals` documents.
- `proposals policy`, `proposals to-task` - auto-approval and turning approved proposals into plan tasks.

</details>

<details>
<summary><b>Infinite mode and execution</b></summary>

- `infinite start --cycles N | --hours H [--locale code]`, `infinite status`, `cycle --progress yes|no`, `stop` - `--locale` records the person's language: the Stop hook and every wake remind the session to answer in it.
- `swarm start --project P --session SID [--mode subagents|sessions] [--parallel N] [--merge-on-finish] [--branch B] [--kind plan|ephemeral] [--tasks F]` - start or resume an execution (`--kind ephemeral --tasks F` starts an ephemeral one from the JSON file F of loose tasks and writes its state to `.forge/loose.json`); creates the run branch and its worktree (or brings a stale one up to its base, `baseSync`) and prints the `setup` result and `announce`, the lines the session shows (mode and N, branch, where to open the app, the final merge and how to stop it). `--locale <code>` records the person's language, used for those lines and repeated at every hook block and wake. It also sets git's union merge for `.forge/verify/*.md` (in `.git/info/attributes`), so `Learned` notes added by parallel tasks merge without conflicts. Run it from the main checkout.
- `swarm status` - the execution state, per task.
- `swarm propose --plan P | --tasks F` - the plan's (or the loose tasks') width and the recommended mode and N.
- `swarm worktree <task> [--member SID]` - create the task's worktree and branch (and run `swarm.setup`); `--member` is for a member session, which creates its own.
- `swarm join --session SID --role executor|manual [--task T] [--name N] [--hook-session ID]` - register a member in `.forge/members/<SID>.json`. `SID` is its waypoint session id; `--hook-session` is Claude's own session id (the skills pass `${CLAUDE_SESSION_ID}`), which the hooks use to recognise the member; a rejoin without it keeps the one recorded.
- `swarm report <task> --session SID --stage S [--status running|accepted|blocked] [--agent A | --no-agent] [--round N] [--lease ISO]` - a member publishes its own stage and live signal (it never writes `execution.json`).
- `swarm next --plan p --db dir --session SID` - offer a manual member a ready task.
- `swarm relaunch <task> --plan p` / `swarm nudge <task> [--plan p]` - restart a stopped sessions task with a handover note (at most 2 times), or remind an idle one (the plan gives the reminder's language).
- `swarm takeover --session SID [--db dir]` - take over the coordinator when it is stopped; a run member cannot. The coordinator becomes `SID`, and the Stop hook binds to that session at its next stop.
- `swarm task <task> --stage S [--agent A | --no-agent] [--round N] [--status running|accepted|blocked] [--detail-file F] [--lease ISO]` - record the task's stage, agent and round; `swarm task <task> --drop` forgets a task whose claim was lost.
- `swarm tick [--plan p --db dir] [--agents F]` - decide what to launch, nudge, relaunch and integrate; in an ephemeral execution it takes no `--plan` or `--db` (`--db` is a copy of the roadmap's `state` and `sessions` documents; `--agents` is a JSON file of the background sessions, `[{name, state: working|idle}]`).
- `swarm integrate <task> [--retry-deps]` - merge an accepted task into the run branch, comparing the validators with the baseline. It installs the dependencies again when the merge brings or changes a manifest or lockfile (`setup`), puts them back after a merge it rolls back, and prints `newValidators` and `say`, the lines the session shows (new validators, validators excused as already failing). An install that fails answers `run-deps` and is not retried until the manifests change, or with `--retry-deps`.
- `swarm merge [--yes] [--retry-deps]` - merge the run branch into your branch; without `--yes` it needs the permission given at start. When your branch has not moved, the merged tree is the run branch's, so the validators run in the run worktree and nothing is installed in your checkout.
- `swarm retry <T> [--adopt]` - put a task in conflict or blocked back to work. `--adopt` gives the conflicting task of an executor or manual session one fix round with the coordinator's subagents; it refuses if the holder's worktree is dirty.
- `.forge/loose.json` - the state of an ephemeral execution (its loose tasks, with title, zones and dependencies).
- `swarm sleep <seconds> [--mark]` - wait between ticks (up to 900 s); `--mark` only records the wake-up time.
- `swarm stop [--reason stopped|budget]`
- `stop` - stop the infinite run and the execution.
- `hook live` - the live-signal hook (stdin: the hook event). It prints nothing.
- `--cwd <dir>` - on any command, run it as if from that directory (validators, git and the project's files), so a coordinator never has to `cd` into a worktree.

</details>
