---
name: launch
description: Use to start another Claude Code session on a waypoint track in its own git worktree, in the background. Triggers: "/waypoint:launch <track>", "lanza una sesión en el frente X", "lanza una sesión en la pista X", "launch a session for track X".
allowed-tools: Bash(node *waypoint.cjs*) Bash(git status *) Bash(git worktree list *) Bash(git add *) Bash(git commit *) ArtifactData ListAgents Read
---

# waypoint: launch a session on a track

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …`.

1. Plan: `docs/waypoint/<project>/plan.yaml` (ask which if several). The track must exist in it; if the user didn't name one, list the tracks and ask.
2. Make sure the plan is committed (`git status --porcelain docs/waypoint`); a worktree only sees committed files. If not, commit it first with the repository's commit rules.
3. Check the track is free: `waypoint session-id <track>` → `SIDT`; `waypoint clean-cache <plan> sessions`, then ArtifactData `list` collection `sessions` (`query: {limit: 1000}`, `out_dir: .waypoint/<project>/dbcache`). The track is busy when `sessions/SIDT` is `active` and its lease has not run out more than 5 minutes ago (its lease ends at the later of its `leaseUntil` and its `heartbeatAt` plus 10 minutes: the same rule as recover), or `ListAgents` (when that tool is available) shows a session named `wp-<project>-<track>`. If busy, tell the user and do not launch.
4. Ask the user whether that session may merge `track/<track>` into `main` when it closes a phase (default: no, it will report instead).
5. `waypoint launch <plan> <track> --exec` (add `--merge` if the user authorized merging in step 4) → `{"launched": true, "worktree", "branch", "name", "prompt", "log"}`. waypoint creates the worktree and starts the background session there itself, named `name` with the prompt `prompt`, so this session's own directory never changes. A track of a plan that a forge execution is running joins that execution as a manual member by itself (`/waypoint:work` §0.5). Authorization to merge only counts inside that initial prompt. If it exits with code 1, tell the user its message.
6. Check with `ListAgents` that a session named `name` shows up (give it up to a minute; without that tool, read `log` once after a minute and tell the user to check `claude agents`). If it does not, read `log`:
   - "Workspace not trusted": a new worktree is a new folder and Claude Code only starts background sessions in trusted folders. Never try to work around it. Tell the user to run, in a separate terminal, `cd "<worktree>"` then `claude`, accept the trust prompt and `/exit`; then retry step 5.
   - Anything else: show the user its last lines.
7. Tell the user in their language: the session name, its worktree and branch, that it appears in `claude agents`, that the session will ask for tool permissions there ("Needs input") which they must approve, and that it will show up in the roadmap's Sessions view once it registers.