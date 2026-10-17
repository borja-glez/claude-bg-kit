<div align="center">

# claude-bg-kit

**Claude Code plugins for tasks too big for one prompt.**
Design them, plan them, build them with independent review, run them in parallel and watch every step live.

**English** · [Español](README.es.md) · [Changelog](CHANGELOG.md)

![waypoint 0.23.1](https://img.shields.io/badge/waypoint-0.23.1-cba6f7?style=flat-square)
![forge 0.20.0](https://img.shields.io/badge/forge-0.20.0-fab387?style=flat-square)
![lens 0.11.9](https://img.shields.io/badge/lens-0.11.9-b4befe?style=flat-square)
![Claude Code plugin marketplace](https://img.shields.io/badge/Claude%20Code-marketplace%20bg--kit-89b4fa?style=flat-square)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-a6e3a1?style=flat-square)

</div>

---

## Contents

- [What's inside](#whats-inside)
- [Mix and match](#mix-and-match)
- [How it all fits together](#how-it-all-fits-together)
- [Install](#install)
- [Quick start](#quick-start)
- [A tour of the pieces](#a-tour-of-the-pieces)
- [Requirements](#requirements)
- [Repository layout](#repository-layout)
- [Develop](#develop)

## What's inside

`bg-kit` is a Claude Code plugin marketplace with three plugins. Each one is useful on its own, and they work best together.

| | Plugin | What it gives you | Read more |
| --- | --- | --- | --- |
| 🧭 | **waypoint** | Design docs refined in critic rounds, a `plan.yaml` of tracks, phases and tasks, a **live roadmap** published as a claude.ai artifact, and parallel sessions coordinated across git worktrees. | [plugins/waypoint](plugins/waypoint/README.md) |
| 🔨 | **forge** | An adaptive way of working: **triage by size**, the right model for each role, your own validators first, **independent weighted review**, an **execution** of parallel tasks (subagents or sessions) and an unattended **infinite mode**. | [plugins/forge](plugins/forge/README.md) |
| 🔍 | **lens** | A **live progress panel** inside Claude Code: **model and effort in use**, roadmap, forge stages and executions, superpowers runs, todos, subagents, Claude Code tasks, and **token and dollar usage** compared with working without forge. | [plugins/lens](plugins/lens/README.md) |

## Mix and match

The plugins are decoupled: install only the ones you want. The only hard dependency is forge → waypoint, because forge plans and coordinates through waypoint's roadmap.

| You install | What you get |
| --- | --- |
| **waypoint** | Design rounds, `plan.yaml`, the live roadmap, the band and parallel sessions, without forge's triage or review. |
| **waypoint + lens** | The above plus the live panel and usage, still without forge. |
| **waypoint + forge** | The full build loop and the parallel execution; lens is not needed. |
| **lens** | The panel on its own: todos, subagents, model, effort and usage of any session. |
| **any of them + [superpowers](https://github.com/obra/superpowers)** | They coexist with superpowers' skills; lens also shows superpowers plans and subagent-driven runs. |

lens detects waypoint, forge and superpowers from their files in the project, so it never requires any of them.

## How it all fits together

<p align="center">
  <img src="docs/assets/flow.en.svg" alt="The full flow: design with critic rounds, plan and live roadmap, the forge build loop, a parallel execution integrated into a run branch and merged at the end, and infinite mode, with lens and the roadmap observing every stage" width="100%">
</p>

A large task goes through four stages. You make three decisions along the way: you approve the design, you decide on proposals, and you authorize merges.

1. **Design (waypoint).** `/waypoint:design` writes a design document. The `design-critic` agent reviews it in rounds and returns numbered proposals. You apply them, ask for another round, have Claude interview you, or rewrite. You approve it when it is right.
2. **Plan (waypoint + forge).** `forge-planner` turns the approved design into `plan.yaml`: **tracks** (independent lines of work, called *frentes* in Spanish), phases and small, verifiable tasks with the files each one touches. `/waypoint:plan` publishes it as a **live roadmap** on claude.ai. Everyone with the link sees progress, writes notes and decides proposals there.
3. **Build (forge).** `/forge:run` triages each task by size and picks a path. The heavier paths go through an implementer chosen by difficulty, then the project's own validators (tests, lint, types, build), then up to three independent reviewers (correctness, security, perf). Their weighted verdict accepts the work or sends it back for a fix round, with a stronger implementer from round 3 and the strongest one (`impl-heavy`, Opus at extra-high effort) only for the last attempt and the fix of the final review. From round 2 the reviewers look at the fix, not the whole task again.
4. **Execution (forge).** When the plan has unblocked tasks, a coordinator runs them up to `swarm.parallel` at once (3 by default). Each task gets its own git worktree and either a subagent (*subagents* mode, the default) or a background session of its own (*sessions* mode, launched with `/forge:member` at the effort set in `swarm.member`, medium by default), and one planner decides what runs next; one task at a time is just N = 1. Any other session can join the execution as a manual member and take a pending task. Finished work is integrated **one merge at a time** into the run branch `forge/run-<project>`, running the validators after each merge and comparing them with what already failed there. Your checkout is not touched until the final merge, which asks for your permission.

**Infinite mode** (`/forge:infinite`) keeps cycling within a budget of cycles or hours. A scout proposes improvements with evidence. Low-risk, verifiable ones are approved automatically and the rest wait for you. Approved proposals become new tasks.

**lens** observes the whole flow without spending tokens: it reads the same local files and Claude Code events. The roadmap shows the same state to anyone with the link.

## Install

Add the marketplace straight from GitHub, then install the plugins you want:

```bash
claude plugin marketplace add borja-glez/claude-bg-kit

claude plugin install waypoint@bg-kit
claude plugin install forge@bg-kit     # pulls in waypoint ^0.23.1 as a dependency
claude plugin install lens@bg-kit
```

Inside a session, `/plugin marketplace add borja-glez/claude-bg-kit` does the same. To get new versions later, run `claude plugin marketplace update bg-kit`.

<details>
<summary><b>From a local clone</b> (to work on the plugins themselves)</summary>

```bash
git clone https://github.com/borja-glez/claude-bg-kit.git
claude plugin marketplace add ./claude-bg-kit
```

</details>

Restart Claude Code after installing or updating a plugin.

<details>
<summary><b>Recommended permissions</b> (optional, so routine calls do not prompt)</summary>

Add to `permissions.allow` in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(node *waypoint.cjs*)",
      "Bash(node *forge.cjs*)",
      "ArtifactData",
      "Bash(git *)"
    ]
  }
}
```

If Claude Code lists `ArtifactData` under another name (for example `mcp__…__ArtifactData`), use that name. Each entry lets Claude run that tool without asking; leave out any you prefer to approve by hand.

</details>

## Quick start

**A large feature, start to finish:**

```text
/forge:run Add webhook retries with exponential backoff and a dead-letter queue
```

forge triages it as Large, so it starts `/waypoint:design`. Iterate on the design with the band's buttons, approve it, and forge plans, publishes the roadmap and works the tasks. With two or more unblocked tracks it runs them as a parallel execution.

**Just the roadmap, without forge:**

```text
/waypoint:design new        # write and refine the design
/waypoint:design approve
/waypoint:plan              # plan.yaml + live roadmap
/waypoint:work              # take tasks one by one
/waypoint:launch api        # a background session on the "api" track
```

**A small change:**

```text
/forge:run Rename getUser to fetchUser in the auth module
```

Triaged Trivial or Small: done in the main session or by a light implementer, checked by the validators, with no review overhead.

**Unattended improvement:**

```text
/forge:infinite --cycles 10
```

**See what's going on:** `/lens`, or the **Panel** button in the band.

## A tour of the pieces

### The live roadmap (waypoint)

<p align="center"><img src="docs/assets/roadmap.en.svg" alt="Mock of the waypoint roadmap with tracks, task boxes, a timeline and live sessions" width="100%"></p>

A claude.ai artifact that updates while Claude works. It has five views: Tracking (by phase or by track), Versions, Sessions, Notes and Proposals. It also has filters, a zoomable timeline, a dependency layer, a minimap, export and a phone layout. People with access write notes and approve proposals there; Claude reads them as information, never as orders.

### The band (waypoint)

<p align="center"><img src="docs/assets/band.en.svg" alt="Mock of the band above the prompt in design, work and run modes" width="100%"></p>

The band is a line above the prompt that changes with what you are doing. In design mode it shows proposals and critical points; in work mode, your track, the task in progress and the overall percentage; in run mode, the running tasks, their stage and how many are integrated. Each button runs the matching command.

### forge paths and agents

<p align="center"><img src="docs/assets/paths.en.svg" alt="forge triage routes a task to the Trivial, Small, Medium or Large path; the implementer ladder and the three reviewers" width="100%"></p>

Small things stay cheap and big things get the full treatment: a Small task is always delegated, to `mech` or `impl-light`. Every agent pins its own model and effort, so none inherits your session's. Implementers climb a five-rung ladder, from Haiku for mechanical work through `impl-high` (Opus at high effort, where sensitive work starts) to `impl-heavy` (Opus at extra-high effort), kept for the last attempt and the fix of the final review. Reviewers run on Opus, only after the validators pass, at an effort set by the task's risk: high by default, extra-high on sensitive or delicate work and in the final review, medium for perf. A fix round reviews only the fix; an important finding in code the fix did not touch no longer opens a round by itself and is handed to you as `deferred`. A shadow trial (`FORGE shadow`) runs extra-high twins of the high reviewers on real work, so you can check that high finds what extra-high finds.

### Parallel execution (forge)

<p align="center"><img src="docs/assets/swarm.en.svg" alt="A coordinator session on the run branch forge/run-<project> launches an implementer subagent per ready task, each in its own task worktree; tasks are integrated into the run branch one at a time and merged into your branch at the end" width="100%"></p>

Independent loose requests in one message also run in parallel, as an ephemeral execution that integrates each task into your current branch; with a roadmap they show up there as loose tasks.

### The panel (lens)

<p align="center"><img src="docs/assets/lens.en.svg" alt="The lens panel with the model and effort, roadmap, forge stages, subagents and the Usage card" width="100%"></p>

## Requirements

- **Claude Code** with plugin support. The band and the panel are drawn in the terminal and in the Code tab of the desktop app; in the VS Code panel and with `-p`, use the slash commands.
- **A claude.ai login**, for the roadmap and design artifacts.
- **Node.js ≥ 20** and **git**.
- Optional: the [superpowers](https://github.com/obra/superpowers) plugin, whose plans and subagent-driven runs lens also shows.

## Repository layout

```text
.claude-plugin/marketplace.json   the bg-kit marketplace
plugins/
  waypoint/   skills, design-critic agent, hooks, roadmap and design page templates, built CLI
  forge/      skills, implementer, reviewer, planner and scout agents, hooks, built CLI
  lens/       the panel mod (hooks/register.js) and its engine tests
src/          TypeScript sources: lib/ (shared), page/ (roadmap), mod/ (waypoint band), lens/, forge/
tests/        vitest suites
docs/
  assets/     the README art (generated by art.mjs)
build.mjs     bundles every plugin
```

## Develop

```bash
npm install
npm test                 # vitest
npm run typecheck        # the CLIs and shared sources
npm run typecheck:mod    # the mods (src/mod, src/lens)
npm run build            # rebuilds every plugin's dist/, hooks/ and assets/; commit the output
npm run art              # regenerates the README SVGs in docs/assets
node scripts/usage-report.mjs <project>/.forge/usage   # cost per agent and per session, from lens's usage files

claude plugin validate plugins/<name>
claude plugin test plugins/<name>
```

Bump the plugin's version in its `plugin.json` on every change: Claude Code caches installed plugins by version.
