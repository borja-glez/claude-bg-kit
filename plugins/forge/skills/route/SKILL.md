---
name: route
description: Use FIRST — before superpowers:brainstorming, writing-plans or any other process skill — when the user asks for coding work that is more than a trivial edit (a feature, a fix, a refactor, a new project). It triages the request and decides, or asks once, whether forge, superpowers or a mix of both does it; it steps aside for trivial and small work. Not when the user already named the method or typed a slash command. Never in a subagent.
---

# forge: route a coding request

`FORGE` = `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Talk to the user in their language. Never put the request's text inside a shell string: write it with the Write tool.

**In a subagent** (your task came from another agent, not from the user): do not use this skill; do the work you were given.

1. **Method already named.** When the request names the method («con forge», «sin forge», «con superpowers», "with superpowers", «superpowers diseña y forge construye», «superpowers planifica y forge ejecuta»…), follow it: `<option>` is that one (`forge`, `none`, `superpowers`, `superpowers-design` or `superpowers-plan`), `<by>` is `user`; go to step 4 (with `<id>` as step 2 makes it).
2. **Probe.** `<id>`: a short kebab-case slug of the request. Write the request to `.forge/work/<id>/task.txt` and run `FORGE route --task <id> --text-file .forge/work/<id>/task.txt --locale <es|en>` (the person's language). Add `--workflow <w>` or `--autonomy <a>` only when the request says so, `--run-plan` when it asks to carry out a plan that already exists, `--build-spec` when it asks to build from a spec that already exists (a recent spec it does not ask for is only listed in `specs`: it may be about another task), and `--path <path>` when the raising rules of `forge:run` (`## 1. Triage`, step 2) raise the path it would print. It triages the text without writing anything (no ledger, and no `.forge/` left behind: `cleaned: true` when the task file was all it held) and prints `{workflow, autonomy, sources, superpowers, specs, plans, options, recommended, probe, stepAside, ask}`. With `stepAside: true` (Trivial or Small, and `workflow` is not `forge`), step aside without a word and go on as you would without forge; Trivial or Small with `workflow: forge`: invoke `forge:run` with this task.
3. **Decide.**
   - `workflow` set (not `ask`): apply it and say so in one line («forge: <option> (<its source>)»); `off` is the option `none`. When it needs superpowers and `superpowers.installed` is false, say so and ask as below.
   - `autonomy: auto`: take `recommended`, say so in one line with its `why`; `<by>` is `auto`.
   - Otherwise ask once with AskUserQuestion, with the two questions of `ask` as printed: `ask.question` with `ask.options` (their labels, the recommended one first; say its `why` in the person's language) and `ask.remember.question` with its two options. `<by>` is `user`; a yes to the second one adds `--remember` to step 4.
4. **Hand over.** `FORGE route set --task <id> --chosen <option> --by <by> --session ${CLAUDE_SESSION_ID}` writes `.forge/route/<session>.json` (this session's route; another session's is never touched) and records the `route` decision; only this session is reminded of the route. With `--remember` (the person said yes to remembering it) it also keeps the option as the project's `workflow` in `.forge/local.yaml` (`off` for `none`); with `none` and no `--remember` it writes nothing. When the chosen option is the recommended one and `recommended` names a `spec` or a `plan`, add `--spec <it>` or `--plan <it>`. Then:
   - `forge`: invoke `forge:run` with the task and `<id>` (it writes the task file again and records its own triage); in auto, as `/forge:run --auto`.
   - `superpowers`: invoke the superpowers process skill that fits (usually `superpowers:brainstorming`). When its work is done, offer `/forge:review` once.
   - `superpowers-design` with a spec: invoke `forge:run --from-spec <spec>` with `<id>`. Without one: invoke `superpowers:brainstorming`, telling it that **the user chose** that, once the spec is written and approved, `writing-plans` is not invoked and `forge:run --from-spec <spec>` takes over instead (`using-superpowers` puts the user's instructions above its skills).
   - `superpowers-plan` with a plan: invoke `forge:run --superpowers-plan <plan>` with `<id>`. Without one: invoke `superpowers:brainstorming` and then `writing-plans`, telling them that **the user chose** forge for the execution: once the plan is written, run `FORGE route stage --stage planning --session ${CLAUDE_SESSION_ID} --plan <its path>` and hand off with `forge:run --superpowers-plan <its path>` instead of `subagent-driven-development` or `executing-plans`.
   - `none`: go on without forge.

   When the user drops the route or changes their mind before the hand-off, run `FORGE route stage --stage done --session ${CLAUDE_SESSION_ID}` so the prompt hook stops reminding it.
