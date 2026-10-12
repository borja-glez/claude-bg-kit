<div align="center">

# 🔨 forge

**An adaptive way of working for Claude Code.**
Triage by size, the right model for each role, your own tools first, independent weighted review, and parallel or unattended runs when the work is big.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.6.0](https://img.shields.io/badge/version-0.6.0-fab387?style=flat-square)
![depends on waypoint ^0.11.0](https://img.shields.io/badge/depends%20on-waypoint%20%5E0.11.0-cba6f7?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/paths.en.svg" alt="forge triage routes a task to the Trivial, Small, Medium or Large path; below, the implementer ladder and the three reviewers" width="100%"></p>

## Contents

- [Why forge](#why-forge)
- [Install](#install)
- [Usage](#usage)
- [Paths](#paths)
- [Agents](#agents)
- [The Large path](#the-large-path)
- [Swarm](#swarm)
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
- **Scales out.** Big plans run as a swarm of parallel sessions, and infinite mode keeps improving the project within a budget.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install forge@bg-kit
```

forge depends on [waypoint](../waypoint/README.md) ^0.11.0, which is installed with it. [lens](../lens/README.md) is optional and recommended. Restart Claude Code after installing or updating. Recommended permission: `Bash(node *forge.cjs*)`.

## Usage

| Command | What it does |
| --- | --- |
| `/forge:run <task>` | Triage the task and work it on the path its size calls for. |
| `/forge:run --parallel N <task>` | Same, with a swarm of up to N parallel sessions on the Large path. |
| `/forge:infinite [--cycles N] [--hours H]` | Unattended improvement cycles within a budget. |
| `/forge:decide <id> approve\|reject\|comment <text>` | Decide or comment on a proposal from any session. |
| `/forge:verify [surface]` | Check the work by using it (web, emulator, CLI...), or create and edit verification surfaces. |
| `/forge:stop` | Stop the infinite run or the swarm. |

```text
/forge:run Fix the off-by-one in pagination            → Trivial or Small
/forge:run Add rate limiting to the public API         → Medium: short plan, implementer, validators, review
/forge:run Rebuild checkout with multi-currency support → Large: design, plan, roadmap, then each task
```

## Paths

| Path | Gate | Executor | Validation | Review |
| --- | --- | --- | --- | --- |
| **Trivial** | none | the main session | validators on the changed file | none |
| **Small** | none | main session, `impl-light` or `mech` | all validators + reading the diff | none |
| **Medium** | short plan, continues unless stopped | `impl` / `impl-heavy` | all validators | correctness (+ security when sensitive) |
| **Large** | mandatory approval of the design | `/waypoint:design`, `/waypoint:plan`, then the Medium loop per task | all validators | correctness + security + perf, final whole-branch review |

Triage reads the task text, the files it is likely to touch and the sensitive zones (auth, data and migrations, public API, dependencies, CI), and picks the validators that apply.

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
| `forge-verify` | Sonnet | default | uses the work through a surface and reports evidence (`forge-verify-heavy`, Opus, on the `quality` profile) |
| `forge-planner` | Opus | xhigh | Large path: turns an approved design into a waypoint plan |
| `forge-scout` | Opus | medium | infinite mode: evidence-backed improvement proposals |

Implementers write their report to `report-<n>.txt` and also include it in their reply. The `economy` profile steps implementers down one tier and `quality` steps them up; reviewers never change.

## The Large path

1. `/forge:run` runs `/waypoint:design` and **waits for you to approve the design**.
2. `forge-planner` writes `plan.yaml` and `/waypoint:plan` publishes the live roadmap.
3. `/waypoint:work` claims each task, and its "do the work" step becomes the forge loop: `brief --plan`, `triage --plan`, an implementer, the validators and the three reviewers, for up to 4 rounds.
4. When the tasks are done, `review-correctness` reviews the whole branch against the design and the plan, with at most one fix and one re-review. The re-review gets fresh validators and a fresh diff, and a `redo` verdict is treated as a fix.

The run's base is kept in `.forge/work/<project>/run.json`, written once after the design is approved. While an implementer or reviewer runs, the session holds a `busyUntil` lease on its waypoint session, so parallel sessions do not recover its task.

## Swarm

<p align="center"><img src="../../docs/assets/swarm.en.svg" alt="A coordinator launches sessions on unblocked tracks, each in its own worktree, and merges them into main one at a time" width="100%"></p>

With `swarm.parallel` of 2 or more in `.forge/config.yaml` (default 5) or `--parallel N`, the Large path and infinite mode run as a **swarm**, and the session only coordinates:

- **Each tick** it lists the roadmap, and `forge swarm tick` decides which fronts (tracks) to launch with `waypoint launch --swarm` and which work to integrate. A front is launched only when its dependencies are integrated.
- **Each front** is a background session in `.claude/worktrees/<track>` on the branch `track/<track>`.
- **Integration** happens with your one-time authorization, one merge at a time, into the main checkout's branch. It merges up to the last done task of a front, runs the validators, and commits, or rolls back if there is a conflict or a validator fails.
- **Between ticks** it sleeps with `forge swarm sleep` in the background.
- **State** lives in `.forge/swarm.json`, mirrored to the roadmap's `meta/swarm`. The roadmap, lens and the band show it.

After a stall caused by a conflict, `forge swarm retry <track>` reactivates the swarm without another `/forge:run`.

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

**When it runs.** Only on Medium and Large tasks, and only when the diff touches a surface's `affects` globs (or the task text asks for verification). A surface without `affects` is always a candidate and the session decides. Trivial and Small tasks skip it unless you ask. A surface runs only if you have allowed it (see Configuration).

**The agent.** `forge-verify` (Sonnet; `forge-verify-heavy` on Opus with the `quality` profile) starts the surface, tries the task's main flow and writes `verify.json` plus screenshots under `.forge/work/<id>/`. It runs in parallel with the reviewers, and its failures count in the verdict like a reviewer's. It never edits project files, never commits, pushes or merges, and never installs project dependencies. `verify.limits` caps how many checks, screenshots and minutes it spends.

**Evidence on the roadmap.** With `evidence: upload` (the default) the screenshots are uploaded to the roadmap and appear in the task detail. Uploading makes the roadmap **organization-internal**, so it can no longer be shared publicly; forge tells you once. With `evidence: local` nothing is uploaded and the roadmap stays publicly shareable. Evidence stays under `.forge/work/` either way.

## Configuration

`.forge/` in the project holds `config.yaml`, `verify/` (the surfaces), the ledger, `local.yaml`, `status.json`, `work/<task-id>/` (briefs, diffs, reports, reviews, verification evidence), `proposals/`, `run.json`, `swarm.json` and `usage/`. Git ignores everything in it except `config.yaml` and `verify/*.md`.

```yaml
profile: balanced              # balanced | economy | quality
detect: true                   # default true
exclude: [build]               # detected validators you do not want, by name
validators:                    # manual
  - name: unit
    cmd: npm test
    kind: test                 # free text
    affects: ["src/**", "test/**"]
  - name: a11y
    cmd: npm run a11y
    kind: a11y
    when: medium               # optional: always | medium | final
verify:
  limits: { checks: 8, shots: 10, minutes: 10 }   # optional; these are the defaults
evidence: upload               # upload | local; default upload
validatorTimeoutSec: 600
swarm:
  parallel: 5                  # 1 turns the swarm off; max 10
```

> **Changed in 0.6.0:** a `validators` list in `.forge/config.yaml` no longer turns detection off; detected validators are used too, and yours win by name. Set `detect: false` for the previous behaviour.

**Validators.** With `detect: true` (the default), forge detects the project's tools and merges your `validators` list into them; a manual validator replaces a detected one with the same name, and `exclude` drops detected ones by name. With `detect: false` only the listed set runs, and `validators: []` means none.

- `kind` is free text (`test`, `lint`, `e2e`, `a11y`...). `when` says when a validator runs: `always`, `medium` (Medium and Large tasks and the final review) or `final` (only the final review of a Large run). A `kind` forge does not know defaults to `medium`.
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

**Permissions.** `.forge/local.yaml` (not in git) holds your allow or deny per surface, and the first time a surface would run, the session asks. The permission is tied to the file's content (a hash of the whole file): if anyone edits the surface, for example in a commit or a PR, it asks again and shows what changed. forge re-blesses its own `Learned` notes, so those never trigger the question, but lines added by anyone else do.

**Matching.**

- `affects` is a list of globs over repo-relative paths with `/` separators. `*` matches within one path segment and `**` matches across segments (`src/**`, `web/*.ts`); no other glob syntax is supported.
- A validator with `affects` runs on `validate --affected` only when one of the changed paths matches. Without `affects`, it always runs.
- `--all` (or no `--affected`) runs every validator. `build` validators are skipped with `--affected`.

## CLI reference

Run as `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs" <command>`.

<details>
<summary><b>Tasks and review</b></summary>

- `triage [--task id] (<text> | --text-file f)` - classify a task: path, files, sensitive zones and validators. `--text-file` reads the text from a file, so it never goes through a shell.
- `triage --plan p --task T` - triage a plan task from its zones and `done_when`.
- `brief --plan p --task T [--design d]` - print a task brief built from a waypoint plan task, including the `Commit title prefix` line that implementers use.
- `validate [--affected a,b | --all] [--task id]` - run the project validators.
- `verdict --task id --dir d [--validators f] [--sensitive] [--perf]` - weigh the reviewers' JSON files into a score. A reviewer is listed with `invalid: true` when its output was unusable (`dropped: 0`, counted as an abstention) or when some of its findings were dropped (`dropped` > 0; the review keeps its verdict and still scores, and the skill records the dropped findings as a ruling).
- `round --task id --path medium|large` - decide the next step of the review loop (`done`, `resume`, `fresh-stronger`, `redo`, `breaker`, `stalled`; `tierUp` from round 3).
- `log --kind k [--task id] [--data json | --data-file f]` - append to the ledger.
- `last --task id` - the path, last phase event, last verdict and last round of a task.
- `agents` - agent names for the active profile.
- `surfaces [learn --name N --notes-file F | proposed --name N]` - list the surfaces and detected drafts; append notes to a surface's `Learned` section; mark a draft as proposed.
- `tools [--surface N]` - check which of the tools a surface lists are on the PATH.
- `local get [surfaces.<name>] | set surfaces.<name> allowed|denied|none` - read or write surface permissions in `.forge/local.yaml`.
- `verify-plan --task id --path p --base sha [--asked]` - decide whether verification runs and which surfaces are candidates.
- `verify-cleanup --dir d` - stop the processes `forge-verify` left running (from `pids.json`).
- `waypoint-cli` - print the absolute path of waypoint's `waypoint.cjs` (found next to this plugin, highest version); exits with 2 when it is not found.

</details>

<details>
<summary><b>Proposals</b></summary>

- `proposals add --file f [--author a]` - create a local proposal (id `p` + timestamp + 4 characters); `--author` wins over an `author` in the file.
- `proposals list [--status s]`
- `proposals decide <id> approve|reject|discuss [--reason-file f] [--by who]` - decide the local copy, log it and print the `write` payload. With `--from <db doc json>` it only checks that document and prints the `write`.
- `proposals save --from <db doc json> [--id id]` - store a roadmap document as the local mirror, and log the decision if its status changed.
- `proposals pull --dir d` - refresh the local mirror from the roadmap's `proposals` documents.
- `proposals policy`, `proposals to-task` - auto-approval and turning approved proposals into plan tasks.

</details>

<details>
<summary><b>Infinite mode and swarm</b></summary>

- `infinite start --cycles N | --hours H`, `infinite status`, `cycle --progress yes|no`, `stop`
- `swarm start | status | tick | integrate <track> | mark <track> | retry <track> | sleep <seconds> [--mark] | stop`

</details>
