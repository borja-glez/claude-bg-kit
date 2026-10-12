---
name: status
description: Use to report the state of a waypoint roadmap — percent done, task in progress, blocked tasks, next task, pace and ETA. Triggers: "/waypoint:status", "how is the roadmap going", "roadmap status".
allowed-tools: Bash(node *waypoint.cjs*) ArtifactData Read
---

# waypoint: status

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …` (the plugin's `bin/` is not on PATH on every platform).

1. Plan: `docs/waypoint/<project>/plan.yaml` (ask if several). `URL` = `artifacts.roadmap`.
2. For each of the collections `meta`, `plan` and `state`: `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" clean-cache <plan> <collection>` (`<project>` = the plan's `project`), then ArtifactData `list` that collection with `query: {limit: 1000}` and `out_dir: .waypoint/<project>/dbcache`. The database is the runtime plan.
3. `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" status <plan> --db .waypoint/<project>/dbcache --states .waypoint/<project>/dbcache/state`. If it fails with "db plan cache missing", the roadmap was never synced: say so and suggest `/waypoint:plan`.
4. Answer in the user's language with those numbers and the roadmap URL. Do not paste raw JSON.
