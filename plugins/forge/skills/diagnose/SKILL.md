---
name: diagnose
description: Explain from forge's own records what happened in a forge task or execution - a step skipped or out of order, repeated work, a failed command, a stall, the time or the tokens it took - with every claim cited to a file line or an event time. Use for /forge:diagnose <task> or /forge:diagnose --execution <runId>, or when the person asks why a forge task or run went wrong, stalled, repeated itself or cost so much.
---

# forge: diagnose a task or an execution

`FORGE` = `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Talk to the person in their language. Besides its own output file under `.forge/work/diagnose/`, this skill writes nothing: it never changes forge's records, the code or a transcript, and never sends its output anywhere, because it holds the person's commands and paths.

1. **Run it.** For a task: `mkdir -p .forge/work/diagnose`, then `FORGE diagnose --task <id> [--project <p>] > .forge/work/diagnose/<id>.json` (`--project` when two plans have a task with that id). For an execution: `FORGE diagnose --execution <runId> > .forge/work/diagnose/<runId>.json` (`FORGE swarm status` prints the current one as `state.runId`; an older one is the `runId` of its ledger events). It finds the transcripts of the sessions its events name under `CLAUDE_CONFIG_DIR` (else `~/.claude`); `--transcript <file>` names one instead. Exit 2: forge has no record of that task or run, or a flag is wrong; say what it printed and ask for the id.
2. **Read the file in parts** with the Read tool: it can be long. `findings` and `waiting` come first, then `tasks`, `usage`, `coverage`, `sources` and the `timeline`.
3. **What each part says.**
   - `findings`: `missing-step` (a step the path requires did not run, while a later one did), `out-of-order` (a step started before the step it needs had ended), `degraded` (a step that ran on top of one that only failed, or was itself degraded: it does not count), `failed` (a forge command that exited non-zero, or a job whose `--out` file holds `{error, code}`), `repeat` (a once-per-task command, or the same agent, run again with nothing in between), `compact-drift` (the same, or a step out of order, right after a compaction).
   - `waiting`: calls with no result for 10 minutes or more. Data, not an alarm: a permission prompt, a long command and a hung shell look the same.
   - `tasks`: the state of each step, per brief: `ok`, `failed`, `degraded`, `out-of-order`, `missing`, `skipped`, `pending` (nothing after it ran yet) or `unverified`.
   - `usage`: tokens per transcript, counted once per `message.id` (`usageLines` against `messages` shows the repeats); the coordinator's only within `window`, each subagent's whole.
   - `coverage`: what could not be read or judged (no transcript, a subagent without its file, an order whose end is unknown). A step it names is unverified, never fine.
4. **Answer** with what happened, in time order, and what it cost the person. Every claim cites an `at` (`file:line`) or a `ts` of the output; drop any claim you cannot cite. To look at a cited transcript line, measure the file first (`wc -c`) and read only that line's small fields; never print a whole record or a whole transcript.
5. **Patterns.** A step that is `missing` or `out-of-order` in two or more briefs or tasks is a candidate for the CLI to enforce: list it as such. Change nothing in forge or in the project here; propose a change only if the person asks.
