---
name: stop
description: Stop forge's infinite run or swarm. Use for "/forge:stop" or when the user asks to stop the infinite loop or the swarm.
---

# forge: stop the infinite run or the swarm

`FORGE` = `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Talk to the user in their language.

1. First run `FORGE swarm status` and `FORGE infinite status` and remember whether a swarm and an infinite run were active. Then run `FORGE stop`. It marks the run inactive itself (reason `stopped`, logged in the ledger) and leaves `.forge/stop`, so even a run whose session is gone is closed and a new `/forge:infinite` can start. It also ends an active swarm (reason stopped); front sessions finish their current task and stop on their own. Creating the file `.forge/stop` by hand only ends the run at the bound session's next stop.
2. Close the run yourself, now: if an infinite run was active, do step 4 of the `/forge:infinite` skill (ArtifactData `update` `meta/infinite` `{active: false}` pinned per waypoint's rules, then the report: cycles, tasks, proposals, reason, branch, nothing merged). Do not start another cycle. If a swarm was active (as remembered from step 1): when an infinite run was also active, step 4 item 0 of that skill publishes `meta/swarm` and reports it, so do not do it again; when no infinite run was active, publish `meta/swarm` yourself (`/forge:run` Swarm step 5) and give the Swarm step 7 report (no "Large step 4").
3. Tell the user the roadmap pill is off. If a cycle was running in another session of this checkout, it ends at its next stop.
