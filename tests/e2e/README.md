# End-to-end scenarios against the real `claude`

## What this is

The real `claude` binary runs against a local, scripted Messages API: no account, no cost and no model. The plugins under test (waypoint, forge) and a probe plugin load from the repo, and the scenarios assert on what the binary sends to the server and on what the hooks receive. The idea comes from gentle-ai.

## Run

- `npm run test:e2e` runs every `*.e2e.ts` scenario. It prints one line, `e2e: claude <version> (<path>)`, with the binary it found.
- The scenarios skip themselves when no `claude` is found. `BGKIT_E2E_CLAUDE=<path>` picks the binary, for example the version CI pins.
- They do not run in `npm test`, and they do not run in GitHub CI today.

## Isolation

- The config dir and HOME are temp directories; the repo the session works in is a temp git repo.
- The environment is clean: the parent session's, vitest's, forge's, waypoint's and the proxy's variables are removed (in any case), and `NODE_ENV` is not inherited.
- The API key is fictional, and nothing leaves `127.0.0.1`. The secrets some scenarios use are fake files.
- Claude Code reads the CLAUDE.md files of the working directory's ancestors, and on Windows the OS temp dir lies under the user profile, so `e2eEnv` sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (an undocumented switch of the binary). The e2e loads no CLAUDE.md, and the smoke checks that no memory-file block reaches the model. `--bare` and `--safe-mode` are not an option: both switch off plugin hooks.
- The skills and agents in `init` are the builtin ones and those of waypoint, forge and the probe; none comes from the real home's own skills or agents folders.

## Writing a scenario

- Put a marker `E2E-<NAME>` in the prompt, and name the steps `<scenario>#<n>` with `all(hasTools, userHas(...), turn(n))`.
- Each step replies with one block.
- A request with no scripted step gets `ok` and spends no step.
- The probe plugin records the input of every hook in the hook log; read it through `r.hooks`.
- Put `failureReport(r, server)` as the message of the scenario's first `expect`.

## When Claude Code changes

`OBSERVED_WITH` in `harness/claude-bin.ts` is the version the table below was recorded with; the runner warns when the binary differs. The values a scenario pins (tool names, hook keys, request paths) are the `PINNED` constants of each scenario. Re-point them by reading the server log and the probe's hook log of a run, never by copying the binary's output.

## Observations

| Scenario | Claude Code | What the real binary did | Pinned in |
| --- | --- | --- | --- |
| smoke | 2.1.310 | Main-request tools: `Agent` present, no `Task`, no `AskUserQuestion`; `Skill`, `ToolSearch` and `DeferredToolPlaceholder` present. The only request path is `POST /v1/messages`. The SessionStart `startup` input has five keys: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`; the fixture's `model` does not arrive (`FIXTURE_KEYS_NOT_SENT`). A one-turn session with no tool use fires only SessionStart, UserPromptSubmit, Stop and SessionEnd. `init`: `mcp_servers` is `[]` and `plugins` are waypoint, forge and the probe plus the builtins `cc-plugin-agents-md` and `cc-plugin-plugin-authoring` (path `builtin`). | `smoke.e2e.ts` |
