---
name: stop
description: Stop forge's infinite run or execution. Use for "/forge:stop" or when the user asks to stop the infinite loop or the running execution.
---

# forge: stop the infinite run or the execution

`FORGE` = `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Talk to the user in their language.

1. First run `FORGE swarm status` and `FORGE infinite status` and remember whether a swarm and an infinite run were active, and the execution's `runId`. Then run `FORGE stop`. It marks the run inactive itself (reason `stopped`, logged in the ledger) and leaves `.forge/stop`, so even a run whose session is gone is closed and a new `/forge:infinite` can start. It also ends an active execution (reason stopped); agents already running finish their current step and nothing new starts. Creating the file `.forge/stop` by hand only ends the run at the bound session's next stop.
2. Close the run yourself, now: if an infinite run was active, do step 4 of the `/forge:infinite` skill (ArtifactData `update` `meta/infinite` `{active: false}` pinned per waypoint's rules, then the report: cycles, tasks, proposals, reason, branch, nothing merged). Do not start another cycle. If an execution was active (as remembered from step 1): when an infinite run was also active, step 4 item 0 of that skill publishes `meta/run` and reports it, so do not do it again; when no infinite run was active, publish `meta/run` yourself (forge:run `references/execution.md` step 5) and give its step 7 report (no `references/large.md` step 4).
2b. If the execution runs in mode `sessions` or has members: the members are the files in `.forge/members/` of the main checkout whose `runId` is the `runId` remembered in step 1 (skip every other file: it belongs to another execution). Once `FORGE stop` ran, a member can no longer `FORGE swarm report`. Send each of them, by SendMessage to its member file's `name`, the text «[forge run] stop after your current step; the execution is stopped, so do not report it». A member whose `name` is null cannot be messaged: do not guess one; list those to the user (their session id, role and task) so they can stop them by hand. Never kill a session: each one finishes its current step and stops; its work stays on its `task/<T>` branch.
3. Tell the user the roadmap pill is off. If a cycle was running in another session of this checkout, it ends at its next stop.
