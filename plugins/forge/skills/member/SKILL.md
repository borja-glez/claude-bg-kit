---
name: member
description: Run one task of a forge execution as a run member, in the background session a coordinator launched for it (mode sessions) - join, claim, the task's steps, done and stop. Use when the session's initial prompt is `/forge:member --plan <plan> --task <T> — run member of <SID>: work only <T>, then stop`, or when SessionStart says to resume it with /forge:member.
---

# forge: run member

`FORGE` below means `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. `WP` = `FORGE waypoint-cli` (run it as `node "<WP>" <command>`). From the prompt: `<plan>`, `<T>` and `<COORD>` (the coordinator's id, the `<SID>` after `run member of`). `<SID>` is this session's own waypoint id (step 1). `<project>` = the plan's `project`; `DB` = `.waypoint/<project>/dbcache`; `NOW` = `node "<WP>" now`; `EID` = `node "<WP>" event-id <SID>` (a new one per event, note or message). Before spawning agents, resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path.

A coordinator in mode `sessions` (forge:run, `references/execution.md` step 4 `start` or `relaunch`) launched this session in the worktree `.claude/worktrees/task-<T>` on `task/<T>`. It does only that task, without triage or a gate, and then stops. This skill and `${CLAUDE_PLUGIN_ROOT}/skills/run/references/task-steps.md` hold all a member needs: do not load forge:run nor `/waypoint:work`. Only when a task step cites a section of forge:run (Medium step 6), read that section in `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md`; for verification (Medium step 3b and the `verify.json` part of step 6), read `${CLAUDE_PLUGIN_ROOT}/skills/run/references/verify.md` instead.

## Rules

- **Language.** Every message to the person, every note and every `revert` text is in the language the person writes in (the plan's language when you have no message of theirs), not that of this skill or a CLI output. Between tool calls write nothing, or one short line.
- **Unattended.** A run member never stops to ask. Any question becomes a question note on the roadmap (ArtifactData `set` `notes/<EID>` `{ts: NOW, type: "question", author: "session:<SID>", text, taskId: T}`) and you take the safe path:

  | Situation | Safe path |
  |---|---|
  | A verify surface not allowed, or changed | Not verified in that step: `verify-skip` logged, plus the question note. |
  | A conflict that repeats | Escalated; the task stays blocked or in conflict. |
  | A proposal outside the policy | Left pending for the user. |

- **Decisions.** Each decision you take in place of the person (a safe path above) is recorded with `FORGE decision add --data-file <f>`, never with `FORGE log`. Write the file with the Write tool in `.forge/work/<T>/`: `{"point": "safe-path", "what": "<one line>", "chosen": "<what you did instead>", "alternatives": ["<the others>"], "why": "<one line>", "by": "unattended", "safePath": "<the row above>", "revert": "<how to undo it, or why it cannot be undone>", "undo": {"type": "none", "reason": "<the same reason>"}, "task": "<T>"}` (`undo` may also be `{"type": "git-revert", "base": "<sha>", "head": "<sha>", "cwd": "<this worktree>"}` when there are commits to revert). Exit 2 means the file is wrong: fix what the message names and run it again. Also ArtifactData `set` `notes/<EID>` `{ts: NOW, type: "decision", author: "session:<SID>", text: "<what> → <chosen>: <why>", taskId: T, decision: {point, what, chosen, alternatives, why, revert, auto: true}}`.
- **Files.** Change the project's files with the Edit and Write tools, never with `sed -i`, `awk`, `perl -i` or by rewriting them through shell redirection (they can change line endings). Saving a command's output to forge's own work files (`FORGE validate ... > .forge/work/...`) is fine. Never put user text or JSON inside a shell string: write a file and pass its flag (`--data-file`, `--detail-file`, `--text-file`). Never delete, revert, move or overwrite a file this task did not create.
- **Agents.** Always name the agent you spawn (subagent type `forge:<agent>`, roles mapped by `FORGE agents`); never let work inherit your own model; give subagents the absolute path of `forge.cjs`.
- **Never** integrate, merge or push: the coordinator integrates `task/<T>` into the run branch, and a conflict there is its fix round (`swarm retry --adopt`), not yours.
- **Roadmap writes.** "Pinned" = `if_version` = the version last returned for that document (`TV` for `state/T`, `SV` for `sessions/<SID>`, `MV` for `meta/project`). A `version_mismatch` on `state/T` is waypoint's lost task (`/waypoint:work`, «Lost task»): `get` it; if its `owner` is no longer `<SID>`, another session recovered the task: never overwrite it, empty `.waypoint/<project>/pending-commits.jsonl`, tell the user, send the new owner a `reply` (`messages/<EID>` as in step 5, `taskId: T`, no `replyTo`) naming `task/<T>` and its last commit, then `sessions/<SID>` `{status: "idle"}` and stop; otherwise retry with the new version. On `sessions/<SID>`: `get`, take its version as `SV`, retry once. Any other failure: append the intended write as one JSON line to `.waypoint/<project>/queue.jsonl`, say so in one line and go on; replay it at the next step.
- **Leases.** Your lease lives in `sessions/<SID>` and in `state/T.exec` (`leaseUntil`). Renew both to `NOW + 10 min` at every step; before you dispatch a long agent, set both to `NOW + its expected budget` (at most 90 min). A lease that runs out is how the coordinator sees this session stopped and relaunches it.

## 1. Join

1. **Plan.** `node "<WP>" validate <plan>`. `URL` = its `artifacts.roadmap`; with none, tell the user that a member needs the roadmap and stop.
2. **Names.** Call `ListAgents`: its first line reads `This session is <name> [<id>] — …`; `AGENT` = the name before the bracket. `BRANCH` = `git rev-parse --abbrev-ref HEAD`; `WORKTREE` = `git rev-parse --show-toplevel`; `MAIN` = the path on the first `worktree` line of `git worktree list --porcelain` (the main checkout).
3. **Session.** If `.waypoint/<project>/session.json` exists with this `plan`, reuse its `sessionId` as `SID`, keep its `agentName` as `PREV_AGENT` and refresh `agentName` to `AGENT`. Otherwise `SID` = `node "<WP>" session-id <name>` with name `<T>` and write `.waypoint/<project>/session.json` (Write tool): `{"plan": "<plan>", "url": "<URL>", "sessionId": "<SID>", "track": null, "agentName": "<AGENT>"}`. A SID used with forge has only letters, digits, `_`, `.` and `-` (no `~ : @ +`), at most 120 characters.
4. **Register.** ArtifactData `get` `sessions/<SID>`. If it is `status: "active"`, its `heartbeatAt` is less than 15 minutes old and its `agentName` is neither `AGENT` nor `PREV_AGENT`, another live session uses this SID: take `<SID>-2` (then `-3`, … until one is missing or not held by such a session), store it in `session.json` and say so in one line. Then `set` (missing) or `update` pinned (present) `{name: "<T>", track: null, heartbeatAt: NOW, status: "active", agentName: AGENT, branch: BRANCH, worktree: WORKTREE}`; its version is `SV`.
5. **Join the execution.** `FORGE swarm join --session <SID> --role executor --task <T> --name wp-<project>-<T> --hook-session ${CLAUDE_SESSION_ID}` → `{runId, role, task, coordinator, branch, mode, project}`; `branch` is the run branch. `--hook-session` is Claude's own id for this session (filled in above), the one its hooks receive; it differs from `<SID>`, and the hooks find this member by it. If `join` returns a `warning` (the id was not filled in), go on and tell the user once that this session will not show its own live signal. If `join` refuses your id, tell the user and stop. A member only acts on its own task: `report` and `worktree --member` refuse any other.

## 2. Handover

If `<MAIN>/.forge/work/<T>/handover.md` exists (a relaunch wrote it), read it before anything else: it names the last stage, round and the commits already on `task/<T>`. Do not repeat a step whose output is already written.

## 3. Claim

**Claim.** ArtifactData `get` `state/T`, then one `batch`: `update state/T` `{status: "in_progress", owner: SID, claimedAt: NOW, startedAt: NOW, exec: {runId, mode: "sessions", by: SID, agent: null, stage: "brief", round: 0, since: NOW, leaseUntil: <NOW + 10 min>}}` pinned to the version just read (after a handover, the stage and round it names, and keep `startedAt`); `set` `events/<EID>` `{ts: NOW, type: "started", sessionId: SID, taskId: T}`; `update` `sessions/<SID>` `{role: "executor", runId, currentTask: T, heartbeatAt: NOW, leaseUntil: <NOW + 10 min>, status: "active"}` pinned to `SV`. Keep the returned versions as `TV` and `SV`. A `version_mismatch` on `state/T` means another live session holds the task: tell the user and stop.

## 4. Work

Read `${CLAUDE_PLUGIN_ROOT}/skills/run/references/task-steps.md` now and run its steps (brief, implement, validate, verify and review, verdict) in your own worktree (`--cwd <this worktree>`; `<base>` is the run branch tip, `git merge-base HEAD <branch>`), with your own implementer, reviewers and verify agents. Your work files (`.forge/work/<T>/`: briefs, reports, validators, review dirs) live in this task worktree, your working directory, not in the main checkout; only `handover.md` and `deferred.json` are written to `<MAIN>/.forge/work/<T>/`.

Where those steps say `FORGE swarm task <T> --stage <S> …`, publish each stage with `FORGE swarm report <T> --session <SID> --stage <S> [--agent <A>|--no-agent] [--round <n>]` instead (it writes `.forge/execution/<T>.json` in the main checkout, which the coordinator's tick mirrors), and publish it with the one `batch` those steps say. When you dispatch a long agent, add `--lease <NOW + its expected budget, at most 90 min>` to that `report` and put the same `leaseUntil` in `state/T.exec` and `sessions/<SID>`; otherwise renew both to `NOW + 10 min` at every step. `report` refuses a task whose public file another live session holds: then stop and tell the user. The steps' "step 5 renewal" is this lease rule; `proposals pull` reads `DB/proposals` after `node "<WP>" clean-cache <plan> proposals` and an ArtifactData `list` of `proposals` (`query: {limit: 1000}`, `out_dir: DB`).

**Implementer.** The first attempt goes to the implementer the steps name (the triage's `implementer.agent`: `impl-high` for a task the plan marks `delicate`). Every fix round goes to the implementer `FORGE review-close` prints (`implementer.agent`; `resume` keeps the same one, `impl-heavy` on the attempt it marks `last`): spawn that one and never compute the ladder by hand. Log every implementer you spawn, first attempt and fix rounds, with `FORGE log --kind agent --task <T>-<n> --data-file <f>` (`{"agent":"<name>","role":"<role>"}`): `FORGE review-close` reads the previous rung from it. Give each implementer the `validate` command `FORGE prep` printed for the brief (task-steps step 1); it runs it as given.

When an agent runs, wait for it (it wakes you when it returns); never end the turn with a reviewer missing and no agent running. Agents reply in two lines; read their files only when a step needs them.

## 5. Finish

**Finish.** When the verdict is `done`:
1. Commit any task change left on `task/<T>` (title `<T>: <title>`, as the brief's `Commit title prefix`).
2. `node "<WP>" commit-info` → `{sha, ts, title, add, del}`; ArtifactData `get` `meta/project` for `MV`.
3. One `batch`: `update state/T` `{status: "done", doneAt: NOW, commits: [<commit-info>], summary: "<one sentence in the person's language>"}` pinned to `TV`; `set` `events/<EID>` `{ts: NOW, type: "done", sessionId: SID, taskId: T, text: <title>, add, del, sha}`; `update sessions/<SID>` `{currentTask: {"__delete__": true}, heartbeatAt: NOW}` pinned to `SV`; `update meta/project` `{metrics: {lastCommit: {sha, ts}}}` pinned to `MV`. Then empty `.waypoint/<project>/pending-commits.jsonl` (write an empty file).
4. `FORGE swarm report <T> --session <SID> --stage verdict --status accepted --no-agent`.
5. Send `<COORD>` a `reply`: ArtifactData `set` `messages/<EID>` `{ts: NOW, from: SID, to: "<COORD>", type: "reply", taskId: T, text: "<T> done", status: "open"}` (when the last review-close printed `deferred` findings, you wrote them to `<MAIN>/.forge/work/<T>/deferred.json` as the steps say: the text is `"<T> done, <k> deferred in .forge/work/<T>/deferred.json"`), and SendMessage to the `agentName` of `sessions/<COORD>` with `[waypoint reply <T>] ` and the same text (if it fails, the document is enough). You have no closing report: the coordinator's lists those findings for the person.
6. `update sessions/<SID>` `{status: "idle"}` pinned, and stop.

A run member never integrates and never merges: the coordinator integrates `task/<T>` into the run branch.

**Blocked.** `breaker` or `stalled` with blocking findings: `FORGE swarm report <T> --session <SID> --stage <S> --status blocked`, a question note naming what the person can do, one `batch` with `update state/T` `{status: "blocked", blockedBy: ["external"]}` pinned to `TV`, `set` `events/<EID>` `{ts: NOW, type: "blocked", sessionId: SID, taskId: T, text: <why>}` and `update sessions/<SID>` `{currentTask: {"__delete__": true}, heartbeatAt: NOW}` pinned; empty `pending-commits.jsonl`; a `reply` to `<COORD>` as above with `text: "<T> blocked"`; `sessions/<SID>` `{status: "idle"}`; and stop.

## 6. Resume

When SessionStart says to resume this session with /forge:member, it already joined: run `join` again with the same flags (step 1.5), renew both leases and continue from the last stage you reported (`<MAIN>/.forge/execution/<T>.json`, and `.forge/work/<T>/` in this task worktree). A manual member (role `manual`) resumed this way is not a run member: invoke forge:run --join and follow its `### Manual member` (`references/manual-member.md`) instead.
