---
name: run
description: Do a software task with the forge method - triage by size, the right model per step, tool-first validation and weighted independent review; the Large path coordinates an execution of subagents or background sessions on a run branch (--parallel N, default 3), and independent requests in one message or independent Medium briefs run in parallel as an ephemeral execution. Use for any coding task the user asks to "forge", or /forge:run <task> [--parallel N]; `--from-spec <spec>` starts from a superpowers spec (the design when Large), `--superpowers-plan <plan>` runs a superpowers plan; `--auto` (or `autonomy: auto`) asks only at launch and records its decisions; /forge:run --execute <project> starts a prepared execution; /forge:run --handoff <project> [--plan-only] takes over an approved waypoint design or plan; /forge:run --join joins a running execution as a manual member.
---

# forge: run a task

`FORGE` below means `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Work files go in `.forge/work/<task-id>/` (task id: a short kebab-case slug of the task, or the waypoint task id when one is in progress). Keep internal names in English. `CSID` = `${CLAUDE_SESSION_ID}` (this session's Claude id; references pass it as `<CSID>`; the CLI also reads it from the environment).

**Language.** Every message to the person is in the language they write in, not that of this skill, a CLI output or an agent's reply, also right after a Stop-hook block, a wake or an agent's return (those texts are English for you, never for them). Between tool calls write nothing, or one short line in their language; never paraphrase a step of this skill («Now mirror the stage…»).

Ids: `<id>` is the task id (triage, phase logs); for Large, the plan task id. Each brief of a Medium or Large task has its own id `<id>-<n>`, for `review-prep` and `review-close` (rounds count per brief) and as the implementer's task id. Give subagents the absolute path of `forge.cjs` (resolve `${CLAUDE_PLUGIN_ROOT}`), never the variable. `<BASE>` is the `base` `FORGE prep` printed for the brief, written out literally in every command (each Bash call is a new shell).

Never put user text or JSON inside a shell string: write the task text to `.forge/work/<id>/task.txt` and log data to a JSON file in `.forge/work/<id>/`, and pass `--text-file` / `--data-file`.

Rules for every path:
- Irreversible or outward actions (delete, merge into main, publish) always need the user's approval; never push without being asked.
- Before you start, `FORGE begin --task <id> --locale <es|en>` (`--cwd <worktree>` for a task in a worktree; `--autonomy auto|ask` when the request says so): it takes the tree snapshot and prints `{foreign, snapshot, tdd, autonomy, workflow, untracked, commit, say}`; every brief you write yourself (Small, Medium, an ephemeral run's) carries its `commit.line` as it is, the line that says how its commits are titled in this repository's style. With `foreign` not empty (changes that are not this task's), ask the person `say` before you go on; never commit, stash or discard them on your own.
- Never delete, revert, move or overwrite a file this task did not create (only what its commits hold and its files under `.forge/work/<id>/`). Before closing a task (its report, a commit of surface notes, anything that tidies the tree), run `FORGE tree check --task <id> --base <BASE>` (same `--cwd` as its snapshot): every path in `appeared` or `changed` is the person's, also an uncommitted edit to a file the task committed, whenever it appeared and whatever it holds (`snapshot: null` or a `warning`: treat every untracked and modified path so); never guess an agent made it (agents do not write project files). Ask commit/stash/leave as above, and leave it by default.
- Always name the agent you spawn (subagent type `forge:<agent>`); never let work inherit your own model. Roles (`impl`, `review-security`, ...) map to agents through `FORGE agents` (it applies the profile in `.forge/config.yaml`).
- The implementer **tier ladder**, in roles: `mech` -> `impl-light` -> `impl` -> `impl-high` -> `impl-heavy`. The first attempt takes the implementer triage prints (`impl-high` for a sensitive Medium or plan task, or one the plan marks `delicate`); every fix round takes the implementer `FORGE review-close` prints (`implementer.agent`: the same on `resume`, one rung up on `fresh-stronger` or a redo with `tierUp`, `impl-heavy` on the attempt marked `last`). Spawn it as printed and never compute the ladder by hand; at the top it stays `impl-heavy`, and you tell the user at the end.
- `forge-fable` is used only when the user explicitly asks for Fable.
- Change the project's files with the Edit and Write tools, never with `sed -i`, `awk`, `perl -i` or shell redirection: they rewrite whole files and can change line endings (CRLF on Windows) into a whole-file diff. Saving a command's output to forge's own work files (`FORGE validate ... > .forge/work/...`) is fine. This holds on every OS and path, also when you implement yourself.
- Hand over briefs, diffs and reports as files. No narration, no "shall I continue?".
- A `warning` in what `FORGE prep` prints (no validators: nothing checks the change) goes to the person in one line, once per task.
- Record each phase with `FORGE log --kind phase --task <id> --data-file <file>` (file: `{"phase":"<name>","brief":<n>,"base":"<BASE sha>"}`) only for the phases the CLI does not log (`design`, `plan`, `done`; `prep`, `review-prep` and `review-close` log the rest), and each agent you spawn with `--kind agent` (file: `{"agent":"<name>","role":"<role>"}`).

## Decisions

A decision you take in place of the user because nobody is there to ask (unattended: `### Unattended` in `references/execution.md`) or because autonomy is `auto` is recorded with `FORGE decision add --data-file <f>`, never with `FORGE log`; attended rulings stay `FORGE log --kind ruling`. Every report that closes work ends with a section «Decisiones automáticas» from `FORGE decision list --auto` (left out when empty). A `Deviation from the triage` line forge prints (an implementer that was not the one it named, in a `say` or on `FORGE validate`'s stderr) goes to the person in one line, and the report that closes the work lists them again, one line each: the `deviations` of `FORGE last --task <id>` (of `FORGE swarm status` for an execution), and its `named` (implementers `FORGE agents --task` named), left out when empty. Before you record a decision, or write a report that closes work, read `references/decisions.md` now and follow it (format, `undo`, roadmap note, decisions file).

## Autonomy

forge asks at its gates unless autonomy is `auto`: `begin` prints `autonomy: auto`, `/forge:run --auto`, or the request says so ("en automático", "sin preguntarme", "modo auto"). When autonomy is `auto`, read `references/autonomy.md` now and follow it (what auto asks at launch and decides alone, the safe paths, the design loop, what it never does).

## 1. Triage

`--execute <project>`: no triage, go to `## Execution`.

`--handoff <project> [--plan-only]` (waypoint's handoff, `/waypoint:plan`'s `references/handoff.md`: the person chose forge for the approved design `docs/waypoint/<project>/design.md`, or for its ready plan): no triage. The task is Large, with `<id>` = `<project>`. Run `FORGE begin --task <project> --locale <es|en>` as `Rules for every path` says. Write `.forge/work/<project>/run.json` with `{ "base": "<git rev-parse HEAD>" }` only if it does not exist yet, as `references/large.md` step 1 does once the design is approved (the final review and lens read it). Log the phase `plan`, then read `references/large.md` now and follow it:
- from step 2 (**Plan.**) when `docs/waypoint/<project>/plan.yaml` does not exist;
- from step 3 (**Tasks.**) when it does: the plan is waypoint's. First do what step 2 does around the planner: write its stats file (`FORGE stats --json > .forge/work/<project>/stats.json`, which step 3's «Replanificar» needs) and run `FORGE config get evidence`; when it prints `upload`, run `/waypoint:plan assets`. Step 3's questions are asked here, «where» among them.
- With `--plan-only` (the person chose to leave it planned): stop after step 2, once the plan is written, confirmed and synced. Print what `/waypoint:plan` handed over (its sharing notice and its report) as step 2 says, but instead of «forge runs the tasks next» say that nothing started and that `/waypoint:plan <project>` asks again how to go on.

1. **Run it.** Write the task text to `.forge/work/<id>/task.txt` and run `FORGE triage --task <id> --text-file .forge/work/<id>/task.txt --locale <es|en>` (the person's language: `es` for Spanish, else `en`). It returns `path`, `files`, `sensitive`, `greenfield`, `validators`, `reasons`, `new` (validators seen for the first time), `implementer`, `announce`, `gate`, `untracked` (a `.forge/.gitignore` git does not track whose rules are not exactly forge's: item 4) and `trust` (with it, read `references/trust.md` now). Pass `--batch` when the task is one request of several in the message (`references/ephemeral.md`).
2. **Raise when needed.** Add your own judgement of ambiguity and risk: you may raise the path, never lower it below the CLI's. The CLI only counts files and words, so read the code the task touches and **raise to at least Medium** when the task:
   - changes behaviour callers rely on: new errors or rejected inputs, a changed signature, different return values;
   - bundles several independent changes;
   - adds new behaviour with its tests, rather than a mechanical or one-spot fix.
   To raise, `FORGE log --kind triage --task <id> --data-file <file>` (file: `{"path":"<new path>","why":"<the reason in the user's language, e.g. cambia el contrato de addItem>"}`) and run step 1's command again: it keeps the highest path logged and its `announce` names your reason. This is the **ratchet**: the path only goes up, also later in the task (e.g. small -> medium on finding a sensitive zone; logged the same way), and you follow the raised path from then on.
3. **Announce.** Print `announce` exactly as printed, as the first lines of your reply, before any brief, edit or spawn, also late in a long session (it names path, reason, implementer and new validators, and says the user can correct it); ask nothing. When you do a Small yourself (`## Small` step 1), add «lo hago yo, el cambio ya está en contexto».
4. **forge's own files.** forge keeps its files out of git through the repository's `.git/info/exclude` and never commits on the person's branch for them. With `untracked` (a `.forge/.gitignore` git does not track whose rules are not exactly forge's: forge moves its own to `.git/info/exclude` by itself), never commit it: tell the person once, in one line, that they can commit it or delete it.

**TDD.** When `begin`'s `tdd.line` is not null, every implementer brief you write by hand (any path) ends with that line as printed (it starts `TDD: required`; `FORGE brief` adds it itself), and `review-correctness` for such a brief also gets the implementer's report path. When `tdd.mode` is `superpowers` and `tdd.line` is null, say in the triage line that superpowers is not installed (or has no `test-driven-development` skill) and the task goes on without TDD. With `tdd.mode` `verified`, read `references/tdd.md` now.

**From a spec.** With `--from-spec <f>`, read `### From a spec` in `references/large.md` now, before step 1.

If the user, at any point, explains how to check something of the project ("para probar X usa Y"), follow the `forge:verify` skill: write or update `.forge/verify/<name>.md` without asking.

## Trivial

One file, obvious change. No gate, no phase log.
1. Implement it yourself.
2. `FORGE validate --affected <file> --task <id>`; fix until it passes (stop after 3 tries and report). A passing validate closes the task for lens and the roadmap.
3. Report in two lines: what changed, validation result.

## Small

<= 3 files, no ambiguity, no sensitive zone. No gate, no reviewers.
0. `FORGE prep --task <id>-1 --path small --no-baseline`: it records BASE (its `base`, `<BASE>` below), logs the phase `implement` without running validators and prints `validate`, the implementer's command.
1. A Small task is **always delegated**: write `.forge/work/<id>/brief-1.md` (what to change, the files, the exact values) and spawn the triage's `implementer.agent` as printed (role `mech` for mechanical work — renames, data, code already written —, else `impl-light`) with the brief, the report path `.forge/work/<id>/report-1.txt`, the absolute FORGE path and prep's `validate` command, logged with `--kind agent`. A project file it returns as text after its two lines (under a line `--- <path> ---`, a name the harness refused it): write it to `<path>` with the Write tool, commit it and tell the person in one line, before step 2. The only exception: the whole change is already in your context (read in this turn) and is 10 lines or fewer; then do it yourself and say so in the triage line (Triage step 3).
2. `FORGE validate --all --path small --task <id>`.
3. Read the real `git diff <BASE>` yourself and fix what you find.
4. **Verification, only when the task asks for it** (check it in a browser, an emulator, a device): read `## Small` in `references/verify.md` now and follow it (`<WORK>` = `.forge/work/<id>`).
5. Log the phase `done` (`{"phase":"done","brief":1,"base":"<BASE>"}`), then report in two lines.

## Medium

Read `references/medium.md` now, and again every time you get here: your memory of it does not survive compaction. The Medium path (several files or some design; moderate risk): its gate (step 0) prints the short plan right after `announce` and is never skipped; then the briefs, a review round per brief and the report (step 7).

### Superpowers plan

Read `references/superpowers-plan.md` now and follow it with `/forge:run --superpowers-plan <f>` (a `superpowers:writing-plans` plan, run on the Medium path).

## Large

Read `references/large.md` now and follow it (subsystem, architecture, much ambiguity or risk, or a new project with several pieces (a backend and a frontend…)): design with its mandatory approval, plan, execution, final review.

## Execution

Read `references/execution.md` now and follow it when this session coordinates the execution of a plan's tasks (`references/large.md` step 3, mode `subagents` or `sessions`, N at once, on `forge/run-<project>`). A task's steps are in `references/task-steps.md`. `--execute <project>` (after `/clear`, from `references/large.md` step 3): `references/execution.md` step 1.

**Run members.** A session launched for one task of the execution (mode `sessions`) runs it with forge:member, never with this skill.

### Manual member

Read `references/manual-member.md` now and follow it with `/forge:run --join` (also what `/waypoint:work` §0 item 5 sends here): a session the user drives joins a running execution and works plan tasks.

### Unattended

Read `### Unattended` in `references/execution.md` now and follow its safe paths when an execution is unattended: under `/forge:infinite`, with an active `/goal`, or in a run member; it never stops to ask after the start.

### Ephemeral execution

Read `references/ephemeral.md` now and follow it for several independent requests in one message, or the briefs of a Medium task that can run in parallel (Medium step 2): no waypoint plan, integrated into the current branch one task at a time.

## Resuming

Read `references/resuming.md` now and follow it to resume a task or an execution (`/forge:run --resume`, a SessionStart saying "Resume it with /forge:run → Resume" or naming it, `claude --resume`, «sigue con la ejecución», a takeover).
