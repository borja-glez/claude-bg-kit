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
| stop | 2.1.310 | A Stop hook that blocks makes the session ask the model again. The `reason` reaches the next request as the last `user` message, twice: a `<system-reminder>` text block that starts `Stop hook blocking error from command: "<hook command>": ` and carries the reason, then a text block `Stop hook feedback:` followed by the reason. The second Stop input has `stop_hook_active: true` (the first has none), and when that second Stop does not block, the session ends with a `success` result. A run bound to another session never blocks and the probe sees one Stop. | `stop.e2e.ts` |
| answer | 2.1.310 | Host mode (`--permission-prompt-tool stdio`) offers `AskUserQuestion` directly in the main-request tools (not deferred), and its `can_use_tool` request reaches the host. Answering `allow` with `updatedInput` equal to the input plus `answers: { <question>: <label> }` makes PostToolUse fire with the keys `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`. `tool_response` has `questions: array` (the asked questions, with `header`, `options`, `multiSelect`) and `answers: object` (question to chosen label); no `annotations` when the host sends none. `tool_use_id` arrives. The model reads a `tool_result` that is not an error: `Your questions have been answered: "<question>"="<label>". You can now continue with these answers in mind.` Forge's `hook answer` records `answer: yes` and `answeredBy` the session on the pending merge record. This closes the pending item on the real shape of `tool_response`: what `hookAnswerInput` builds is a subset of it. | `answer.e2e.ts` |

## Nested subagents (for A10)

Recorded with Claude Code 2.1.310 by `subagents.e2e.ts`, with the default `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (`e2eEnv` drops the variable).

- The agent tool is `Agent`, and a level-one subagent is offered it: it started a level-two subagent.
- The agent tool starts agents in the background (`Async agent launched successfully` is the `tool_result` the caller gets), so the main session goes on while they run. The scenario holds the main session's last `Read` until level one is done, to get a fixed order.
- SubagentStart fires at both levels, in the main session's `session_id`, with `agent_type: general-purpose` and a distinct `agent_id` each. There is no field that says which agent started which, or at what depth.
- PreToolUse carries `agent_type` and `agent_id` inside each subagent, at both levels (`general-purpose`), and carries neither in the main session. In order: level one, level two, main.
- Forge's live signal of the coordinator (`.forge/live/<session>.json`) lists one agent while level one runs and two while level two runs, by the `agent_id`s SubagentStart carried (level one's is still there while level two runs): the signal sees the second level.
- What is not measured: the subagent state the engine gives the mod (lens) does not exist in `-p`.

## permissions.deny in subagents (for A4)

`permissions.deny: ['Read(**/e2e-denied.txt)']` passed with `--settings` (and `--permission-prompts none`) denies the main session's `Read` of the file (the control) and denies the subagent's `Read` of it too: both `tool_result`s are errors with `File is in a directory that is denied by your permission settings.`, and the content never reaches the model. The rule reaches subagents. A4's guard B does not depend on this answer (spec, "Riesgos"): it relies on PreToolUse carrying `agent_type`, which the nested scenario pins.

## Compaction (for A2)

Recorded with Claude Code 2.1.310 by `compact.e2e.ts`. The session invokes `forge:run` with the `Skill` tool (the smoke row says the main request offers it), reads `references/large.md` of that skill, then runs `/compact` and sends one more prompt. The summary request is told apart from the title and other side requests by `compacting()` in `harness/compact.ts`: the marker is in the conversation and the last `user` message asks to summarize. `/compact` yields its own `success` result (with an empty `result`), so the driver goes on to the next turn.

- `PreCompact` input keys: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `trigger` (`manual`), `custom_instructions`.
- `SessionStart` with `source: compact` has the keys `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `source`, `model`: every key of `tests/fixtures/hooks/session-start-compact.json` arrives (unlike `startup`, `model` is sent here). The scenario therefore checks the fixture's keys with no exception and has no reverse check; `FIXTURE_KEYS_NOT_SENT` applies to `session-start-startup` only.
- The first request after `/compact` carries the scripted summary as its first `user` message (`This session is being continued from a previous conversation...`). Then, in a later `user` message of that request:
  - the skill is attached again in a `<system-reminder>` that starts `The following skills were invoked EARLIER in this session (before the conversation was compacted)`: its head (`# forge: run a task`) and its tail (the last line of `SKILL.md`), 17,786 bytes of skill in all, so at this size nothing is cut at either end (the 5,000 tokens per skill of the A2 spec are above that size, so this run does not show where the cut falls);
  - the reference read before is attached again, whole, as a `Called the Read tool with the following input` / `Result of calling the Read tool` pair of `<system-reminder>` blocks. The `references/` of a skill are not attached by being the skill's: only a file that was read comes back.
- Task 8 runs the scenario again once A2 has trimmed `forge:run`; the pins are in `PINNED_COMPACT`.
