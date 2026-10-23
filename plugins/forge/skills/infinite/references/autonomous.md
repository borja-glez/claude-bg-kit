Read from forge:infinite (`SKILL.md`, step 3.5, Record, in an autonomous run). `FORGE`, `WP`, `NOW`, `SID`, `<CSID>`, `<plan>` and `DB` mean what that skill says.

An autonomous run (`run.autonomous`) works under the guard of `hook guard` on its sessions. A call it denies (its reason starts with `forge autonomy ·`) is not done in this run: never retry it in another form (another command, a script, another tool); note it and go on with other work. The guard judges a relative path against the session's cwd, so work from the worktree: use absolute paths inside it, or start a Bash call with `cd "<worktree>" &&`. Otherwise writes resolve outside it and are denied.

## Each cycle

- Before `FORGE cycle`, run `FORGE blocked note --session <SID>` and send its `publish` in one ArtifactData `batch` (each write as it is printed).
- What the run creates (a database, a container, a volume, a compose project, a SQLite file, a redis on a port other than 6379-6381) is registered before it is created, with `FORGE resource add --kind <k> --name <n> [--host h]`, under a name with the run's prefix: `fg_<runId with _>__` for databases, `fg-<runId>--` for Docker, with the double separator (`FORGE resource list` shows the `runId`).
- What the run installs goes inside the worktree: `node_modules`, `.venv`, and a `.forge-tools/` folder for `PLAYWRIGHT_BROWSERS_PATH` and the like.
- A path the guard cannot see (a variable, `xargs`) is never used to delete or write: name each file.
- Stop what the run started by its pid (`kill <pid>`, `Stop-Process -Id <pid>`), never by name: a kill by name or process group, a service stop or restart and the person's user-level settings (environment variables, scheduled jobs, npm or pip config) are denied.
- Migrations: run them with their target visible on the command (the denial's `Instead:` names the forms, such as `DATABASE_URL` for rails or dbmate, or an explicit `--url`), never through a package script, whose target the guard cannot see.
- Volumes: remove the run's volumes by name (`docker volume rm <name>`), since `compose down -v` is denied.
- Browsers: test pages in an isolated browser (Playwright, chrome-devtools), never the person's signed-in browser.

## Stop

- The run stops when the person asks in the conversation or runs `/forge:stop`; the session then runs `FORGE stop`, which the guard allows.
- The conversation stays guarded afterwards: the guard keeps its rules for the run's sessions while `.forge/run.json` holds the autonomous block, so stopping unlocks nothing. Work without the guard happens in a new conversation.
- `references/stop.md` starts with a last `FORGE blocked note --session <SID>`; its report lists what was blocked (`FORGE blocked list`).
