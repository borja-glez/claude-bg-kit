---
name: run
description: Do a software task with the forge method - triage by size, the right model per step, tool-first validation and weighted independent review; the Large path coordinates an execution of subagents or background sessions on a run branch (--parallel N, default 3), and independent requests in one message or independent Medium briefs run in parallel as an ephemeral execution. Use for any coding task the user asks to "forge", or /forge:run <task> [--parallel N]; `--from-spec <spec>` starts Large from a superpowers spec, `--superpowers-plan <plan>` runs a superpowers plan; `--auto` (or `autonomy: auto`) asks only at launch and records its decisions; /forge:run --join joins a running execution as a manual member.
---

# forge: run a task

`FORGE` below means `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Work files go in `.forge/work/<task-id>/` (task id: a short kebab-case slug of the task, or the waypoint task id when one is in progress). Keep internal names in English. `CSID` = `${CLAUDE_SESSION_ID}` (this session's Claude id; references pass it as `<CSID>`; the CLI also reads it from the environment).

**Language.** Every message to the person is in the language they write in, not that of this skill, a CLI output or an agent's reply, also right after a Stop-hook block, a wake or an agent's return (those texts are English for you, never for them). Between tool calls write nothing, or one short line in their language; never paraphrase a step of this skill («Now mirror the stage…»).

Ids: `<id>` is the task id (triage, phase logs); for Large, the plan task id. Each brief of a Medium or Large task has its own id `<id>-<n>`, for `review-prep` and `review-close` (rounds count per brief) and as the implementer's task id. Give subagents the absolute path of `forge.cjs` (resolve `${CLAUDE_PLUGIN_ROOT}`), never the variable. `<BASE>` is the `base` `FORGE prep` printed for the brief, written out literally in every command (each Bash call is a new shell).

Never put user text or JSON inside a shell string: write the task text to `.forge/work/<id>/task.txt` and log data to a JSON file in `.forge/work/<id>/`, and pass `--text-file` / `--data-file`.

Rules for every path:
- Irreversible or outward actions (delete, merge into main, publish) always need the user's approval; never push without being asked.
- Before you start, run `git status --porcelain`. If the tree has changes that are not part of this task (the user's own work, an earlier task left uncommitted), ask the user whether to commit, stash or leave them before you go on; never commit, stash or discard them on your own. forge's work files (those `.forge/.gitignore` ignores) do not count; `.forge/config.yaml` and `.forge/verify/*.md` are the person's. Then `FORGE tree snapshot --task <id>` (`--cwd <worktree>` for a task in a worktree).
- Never delete, revert, move or overwrite a file this task did not create (only what its commits hold and its files under `.forge/work/<id>/`). Before closing a task (its report, a commit of surface notes, anything that tidies the tree), run `FORGE tree check --task <id> --base <BASE>` (same `--cwd` as its snapshot): every path in `appeared` or `changed` is the person's, also an uncommitted edit to a file the task committed, whenever it appeared and whatever it holds (`snapshot: null` or a `warning`: treat every untracked and modified path so); never guess an agent made it (agents do not write project files). Ask commit/stash/leave as above, and leave it by default.
- Always name the agent you spawn (subagent type `forge:<agent>`); never let work inherit your own model. Roles (`impl`, `review-security`, ...) map to agents through `FORGE agents` (it applies the profile in `.forge/config.yaml`).
- The implementer **tier ladder**, in roles: `mech` -> `impl-light` -> `impl` -> `impl-high` -> `impl-heavy`. The first attempt takes the implementer triage prints (`impl-high` for a sensitive Medium or plan task), or `impl-high` for a plan task the design marks delicate; every fix round takes the implementer `FORGE review-close` prints (`implementer.agent`: the same on `resume`, one rung up on `fresh-stronger` or a redo with `tierUp`, `impl-heavy` on the attempt marked `last`). Spawn it as printed and never compute the ladder by hand; at the top it stays `impl-heavy`, and you tell the user at the end.
- `forge-fable` is used only when the user explicitly asks for Fable.
- Change the project's files with the Edit and Write tools, never with `sed -i`, `awk`, `perl -i` or shell redirection: they rewrite whole files and can change line endings (CRLF on Windows) into a whole-file diff. Saving a command's output to forge's own work files (`FORGE validate ... > .forge/work/...`) is fine. This holds on every OS and path, also when you implement yourself.
- Hand over briefs, diffs and reports as files. No narration, no "shall I continue?".
- Record each phase with `FORGE log --kind phase --task <id> --data-file <file>` (file: `{"phase":"<name>","brief":<n>,"base":"<BASE sha>"}`) only for the phases the CLI does not log (`design`, `plan`, `done`; `prep`, `review-prep` and `review-close` log the rest), and each agent you spawn with `--kind agent` (file: `{"agent":"<name>","role":"<role>"}`).
- Only the person grants a verify surface's permission: `FORGE local set surfaces.<name> allowed` only right after their «Sí, siempre» to the question of `references/verify.md` (Medium step 3b), or after they dictated or asked for that surface's text here (`forge:verify`). Never re-allow a surface that a task, an implementer or a fix round changed: the next `verify-plan` reports it `changed` and the person decides.
- When `/forge:run` starts from `--from-spec` or `--superpowers-plan`, run `FORGE route stage --stage handed-off` (it moves a pending `forge:route` route on, else changes nothing), and `FORGE route stage --stage done` with the report that closes the work.

## Decisions

A decision you take in place of the user because nobody is there to ask (unattended: `### Unattended` in `references/execution.md`) or because autonomy is `auto` is recorded with `FORGE decision add --data-file <f>`, never with `FORGE log`; attended rulings stay `FORGE log --kind ruling`. Every report that closes work ends with a section «Decisiones automáticas» from `FORGE decision list --auto` (left out when empty). Before you record a decision, or write a report that closes work, read `references/decisions.md` now and follow it (format, `undo`, roadmap note, decisions file).

## Autonomy

forge asks at its gates unless autonomy is `auto`: `FORGE prefs` resolves `autonomy: auto`, `/forge:run --auto`, or the request says so ("en automático", "sin preguntarme", "modo auto"). In auto it asks only at launch, takes the safe paths of `### Unattended` (`references/execution.md`) and records every decision it takes alone; it never merges into the default branch without the launch answer, pushes, deletes branches or files, or touches changes that are not the task's. When autonomy is `auto`, read `references/autonomy.md` now and follow it (what auto decides alone, the launch questions, the design loop).

## 1. Triage

1. **Run it.** Write the task text to `.forge/work/<id>/task.txt` and run `FORGE triage --task <id> --text-file .forge/work/<id>/task.txt --locale <es|en>` (the person's language: `es` for Spanish, else `en`). It returns `path`, `files`, `sensitive`, `greenfield`, `validators`, `reasons`, `new` (validators seen for the first time, commands in `catalog`), `implementer` (who implements: `role`, `agent`, `self`, `why`), `announce`, `gate` and, while `.forge/.gitignore` is not in git, `untracked`. Pass `--batch` when the task is one request of several in the message (`references/ephemeral.md`).
2. **Raise when needed.** Add your own judgement of ambiguity and risk: you may raise the path, never lower it below the CLI's. The CLI only counts files and words, so read the code the task touches and **raise to at least Medium** when the task:
   - changes behaviour callers rely on: new errors or rejected inputs, a changed signature, different return values;
   - bundles several independent changes;
   - adds new behaviour with its tests, rather than a mechanical or one-spot fix.
   To raise, `FORGE log --kind triage --task <id> --data-file <file>` (file: `{"path":"<new path>","why":"<the reason in the user's language, e.g. cambia el contrato de addItem>"}`) and run step 1's command again: it keeps the highest path logged and its `announce` names your reason. This is the **ratchet**: the path only goes up, also later in the task (e.g. small -> medium on finding a sensitive zone; logged the same way), and you follow the raised path from then on.
3. **Announce.** Print `announce` exactly as printed, as the first lines of your reply, before any brief, edit or spawn, also late in a long session (it names path, reason, implementer and new validators, and says the user can correct it); ask nothing. When you do a Small yourself (`## Small` step 1), add «lo hago yo, el cambio ya está en contexto».
4. **forge's own files.** With `untracked`, commit `.forge/.gitignore` alone right away: `git add .forge/.gitignore` and `git commit -m "forge: track .forge/.gitignore" -- .forge/.gitignore` (forge's file, not the user's).

A run member (forge:member) prints none of this; the coordinator announces new validators when it integrates.

**TDD.** Run `FORGE tdd` once per task. When its `line` is not null, every implementer brief you write by hand (any path) ends with that line as printed (it starts `TDD: required`; `FORGE brief` adds it itself), and `review-correctness` for such a brief also gets the implementer's report path. When `tdd` is `superpowers` and `line` is null, say in the triage line that superpowers is not installed (or has no `test-driven-development` skill) and the task goes on without TDD.

**From a spec.** With `--from-spec <f>`, with or without task text, write the spec's title and the first paragraph of its purpose section to `.forge/work/<id>/task.txt` (`<id>` from the spec's file name, as `waypoint:design new --from` derives the project). The path is Large whatever `FORGE triage` prints: log the raise as the ratchet says (`{"path":"large"}`).

If the user, at any point, explains how to check something of the project ("para probar X usa Y"), follow the `forge:verify` skill: write or update `.forge/verify/<name>.md` without asking.

## Trivial

One file, obvious change. No gate, no phase log.
1. Implement it yourself.
2. `FORGE validate --affected <file> --task <id>`; fix until it passes (stop after 3 tries and report). A passing validate closes the task for lens and the roadmap.
3. Report in two lines: what changed, validation result.

## Small

<= 3 files, no ambiguity, no sensitive zone. No gate, no reviewers.
0. `FORGE prep --task <id>-1 --path small --no-baseline`: it records BASE (its `base`, `<BASE>` below), logs the phase `implement` without running validators and prints `validate`, the implementer's command.
1. A Small task is **always delegated**: write `.forge/work/<id>/brief-1.md` (what to change, the files, the exact values) and spawn the triage's `implementer.agent` as printed (role `mech` for mechanical work — renames, data, code already written —, else `impl-light`) with the brief, the report path `.forge/work/<id>/report-1.txt`, the absolute FORGE path and prep's `validate` command, logged with `--kind agent`. The only exception: the whole change is already in your context (read in this turn) and is 10 lines or fewer; then do it yourself and say so in the triage line (Triage step 3).
2. `FORGE validate --all --path small --task <id>`.
3. Read the real `git diff <BASE>` yourself and fix what you find.
4. **Verification, only when the task asks for it** (check it in a browser, an emulator, a device): `FORGE verify-plan --task <id> --path small --base <BASE> --asked --locale <es|en>` and handle its surfaces as `## Before the review` in `references/verify.md` says. To verify, spawn `verify` with the brief, `git diff <BASE>`, the chosen surfaces, the depth, the `missing` and `unknown` tools, review dir `.forge/work/<id>/reviews-1-1/` and evidence dir `.forge/work/<id>/evidence/1-1/`, logged with `--kind agent`. When it returns: `FORGE verify-result --task <id> --dir .forge/work/<id>/reviews-1-1` (so lens does not show the task running), then its learned notes and `verify-cleanup` as `## After the verdict` in `references/verify.md` says. A failed check goes back to the implementer like a problem in the diff.
5. Log the phase `done` (`{"phase":"done","brief":1,"base":"<BASE>"}`), then report in two lines.

## Medium

Several files or some design; moderate risk.
0. **Gate.** When the triage's `gate` is `plan`, print the short plan (at most 10 lines, one per brief: `N. <brief> — <files> — <validators>`) right after `announce` and before any brief or spawn, then **continue** unless the user stops you. Never skip it, also late in a long session.
1. If `validators` is empty, the first task creates minimal tests for what you will touch.
2. For each task, write `.forge/work/<id>/brief-<n>.md` (requirements, exact values, files) and, before any change, `FORGE prep --task <id>-<n> --path medium` (once per brief; on the Large path `--path large`): it reads BASE (HEAD; the `base` it prints is `<BASE>` below), records what already fails on BASE into `.forge/work/<id>/baseline-<n>.json` and logs the phase `implement`, and prints `validate` (the implementer's command) and `cached`; a failure BASE already had does not count. Spawn the triage's `implementer.agent` as printed (`impl`, or `impl-high` on a sensitive zone), or `impl-high` for delicate or important work (logged with its role, `--kind agent`; delicate: first run Triage step 1 again with `--delicate`, so correctness reviews at xhigh), with the brief, a report path `.forge/work/<id>/report-<n>.txt`, the task id `<id>-<n>`, the absolute `FORGE` command and prep's `validate` command, which it runs as given (also in its fix rounds). If it could not write the report, save it from its reply (after `--- report ---`) to that path. Add prep's `threatModel` to the brief as the line `Threat model: <that path>`. **Briefs in parallel.** When the short plan has two or more briefs and at least two neither depend on each other nor share a file, read `references/ephemeral.md` now and run them as an ephemeral execution (its **Medium briefs.**: one loose task `<id>-<n>` per brief) instead of one after the other; then go on with step 7.
3. Do not validate or write the diff yourself: run `FORGE review-prep --task <id>-<n> --path medium --base <BASE> --baseline .forge/work/<id>/baseline-<n>.json --dir .forge/work/<id> --locale <es|en>` (on the Large path `--path large`) and print its `say` as it is. It validates into `.forge/work/<id>/validators-<n>.json`, writes `.forge/work/<id>/diff-<n>.patch` and, from round 2, the fix diff `fix-<n>-<round>.patch` and each reviewer's previous findings; it picks the reviewers from the triage's `review` and prints `round`, `validators`, `spawn` (one entry per agent: `agent`, `model`, `effort`, `mode` `full` or `delta`, `inputs`, `twin: true` for a shadow twin) and `carried` (reviewers whose previous result is copied, not spawned). With `validatorsRound` (red validators BASE did not have, at most twice), nobody reviews, nothing counts against the cap: resume the same implementer with its `findings` file, then run review-prep again; steps 3b to 6 run only when `spawn` is not empty. `express: true`: read `references/convergence.md` now.
3b. **Tool verification.** `FORGE verify-plan --task <id>-<n> --path medium --base <BASE> --locale <es|en>` (`--asked` when the task asks for a check in a browser, emulator or device). When it prints any `drafts`, a surface with `permission` `changed` or `ask`, or `eligible: true`, read `references/verify.md` now and follow `## Before the review`; else go on.
4. Spawn exactly review-prep's `spawn` entries, never a `carried` one: each as its `agent`, with its `mode` (`full` or `delta`) and its `inputs` (`brief`, `diff`, `validators`, `out` the review dir `.forge/work/<id>/reviews-<n>-<round>/`; with `mode: delta` also `fix`, the fix diff, and `findings`, its own previous findings; `report`, for correctness under `TDD: required`, the implementer's report; `threatModel`, for security), passing the Agent tool's `model` when the entry's is not null and the Agent tool's `effort` always. A `twin: true` entry (round 1 while the shadow test is open) is spawned the same way with its own `out`, the review dir's `shadow/` folder; it never counts in the verdict. Spawn them in parallel; never pass one reviewer's output to another.5. Each time a reviewer finishes, not only the last, check its file in its `out` (`correctness.json`, `security.json`, `perf.json`, `verify.json` when `forge-verify` was spawned): one without its file is respawned at once with the same entry; never end the turn while a spawned reviewer has neither its file nor a running agent (nothing would wake you). Go to step 6 once every entry that is not a twin has returned (twins: `references/convergence.md`).
6. `FORGE review-close --task <id>-<n> --dir .forge/work/<id> --path medium` (on the Large path `--path large`): it runs the verdict with the triage's flags (`--sensitive`, `--perf`), decides the round, logs the minor and `deferred` findings as a ruling and prints `{action, score, next, last, implementer, findings, deferred, invalid, incomplete}`. Exit 3 with `missing` (files of spawned reviewers not there): respawn each with its `spawn` entry and close again when they return. If `invalid` (`invalid: true`) or `incomplete` (a draft, `complete: false`) names a reviewer, respawn it once with the same entry and dir (it picks up its draft) and close again before trusting it (closing a round again counts once). Unusable JSON abstained; when only some findings were dropped, the review keeps its verdict and still scores. Still invalid or incomplete after the respawn: keep the result; when findings were dropped, record them from its raw JSON as a ruling (`FORGE log --kind ruling --task <id>-<n> --data-file <file>`, file: `{"dropped":[...]}`). Then follow `next`; a fix round's implementer is always review-close's `implementer.agent`, never one worked out from the ladder. **Findings to send** is the file in `findings` (`findings-<n>-<round>.json`): the critical and important findings except `deferred` ones, plus the `failures` of every validator with `ok: false` and no `preexisting` in `validators-<n>.json`. `deferred` lists what does not block, with its `residual`; step 7 reports it. For `ask`, `handover` and a NEEDS_CONTEXT fix round, read `references/convergence.md` now.
   - `done`: next task.
   - `resume`: send the findings to the same implementer (resume it), then repeat from step 3.
   - `fresh-stronger`: a fresh implementer, the one printed, with the brief, the `handover`, the report and the findings to send; repeat from step 3.
   - `redo`: run git with `revert.args` as printed to undo the attempt (`null`: nothing to undo), then a fresh implementer, the one printed, starts again from the brief another way with the `handover`; repeat from step 3.
   - `breaker` or `stalled`: stop the loop. If what is open blocks the work, tell the user and ask; otherwise record the open findings as a ruling (`FORGE log --kind ruling --data-file <file>`) and continue, telling the user at the end.
   - `tierUp: true` (from round 3) and `fresh-stronger` are one single step up, not two, and `last: true` sends the attempt to `impl-heavy`: the printed `implementer` already applies both.
   After the verdict, when `verify.json` exists, read `references/verify.md` now and follow `## After the verdict`.
   A `verify` fail is a finding like any other: its failed checks are in the verdict's critical/important lists and go in **Findings to send**.
7. Log the phase `done` (same file shape, last brief number), so the roadmap and lens show the run finished. Then report: tasks, commits, verdict scores, rulings, the `deferred` findings review-close printed (one line per finding with its file and line, for the person to decide) and the automatic decisions (`## Decisions`).

### Superpowers plan

Read `references/superpowers-plan.md` now and follow it with `/forge:run --superpowers-plan <f>` (a `superpowers:writing-plans` plan, run on the Medium path).

## Large

Read `references/large.md` now and follow it (subsystem, architecture, much ambiguity or risk, or a greenfield project): design with its mandatory approval, plan, execution, final review.

## Execution

Read `references/execution.md` now and follow it when this session coordinates the execution of a plan's tasks (`references/large.md` step 3, mode `subagents` or `sessions`, N at once, on `forge/run-<project>`): the start, the tick loop, integration, publishing, the end, requests during an execution and Unattended. A task's steps are in `references/task-steps.md`.

**Run members.** A session launched for one task of the execution (mode `sessions`) runs it with forge:member. A session whose initial prompt is the older `/forge:run --plan <plan> --task <T> — run member of <SID>: work only <T>, then stop` invokes and follows `forge:member` instead of this skill, as does a SessionStart saying "Resume it with /forge:run → Run member".

### Manual member

Read `references/manual-member.md` now and follow it with `/forge:run --join` (also what `/waypoint:work` §0 item 6 sends here): a session the user drives joins a running execution and works plan tasks.

### Unattended

Read `### Unattended` in `references/execution.md` now and follow its safe paths when an execution is unattended: under `/forge:infinite`, with an active `/goal`, or in a run member; it never stops to ask after the start.

### Ephemeral execution

Read `references/ephemeral.md` now and follow it for several independent requests in one message, or the briefs of a Medium task that can run in parallel (Medium step 2): no waypoint plan, integrated into the current branch one task at a time.

## Resuming

Read `references/resuming.md` now and follow it to resume a task or an execution (`FORGE last`, `FORGE swarm status`; the SessionStart context says "Resume it with /forge:run → Resume", or `claude --resume`; also «sigue con la ejecución», a takeover).
