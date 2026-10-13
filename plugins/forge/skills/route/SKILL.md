---
name: route
description: Use FIRST — before superpowers:brainstorming, writing-plans or any other process skill — when the user asks for coding work that is more than a trivial edit (a feature, a fix, a refactor, a new project). It triages the request and decides, or asks once, whether forge, superpowers or a mix of both does it; it steps aside for trivial and small work. Not when the user already named the method or typed a slash command. Never in a subagent.
---

# forge: route a coding request

`FORGE` = `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Talk to the user in their language. Never put the request's text inside a shell string: write it with the Write tool.

**In a subagent** (your task came from another agent, not from the user): do not use this skill; do the work you were given.

1. **Method already named.** When the request names the method («con forge», «sin forge», «con superpowers», "with superpowers", «superpowers diseña y forge construye», «superpowers planifica y forge ejecuta»…), follow it: `<option>` is that one (`forge`, `none`, `superpowers`, `superpowers-design` or `superpowers-plan`), `<by>` is `user`; go to step 5 (with `<id>` as step 2 makes it).
2. **Triage.** `<id>`: a short kebab-case slug of the request. Write the request to `.forge/work/<id>/task.txt` and run `FORGE triage --task <id> --text-file .forge/work/<id>/task.txt` (add `--autonomy auto` when the request asks for auto mode), with the raising rules of `forge:run` (`## 1. Triage`). **Trivial or Small:** step aside without a word and go on as you would without forge, unless `FORGE prefs` resolves `workflow: forge`: then invoke `forge:run` with this task.
3. **Options.** `FORGE route --task <id> --path <path>` prints `{workflow, autonomy, sources, superpowers, specs, plans, options, recommended}`. Add `--workflow <w>` or `--autonomy <a>` only when the request says so, `--run-plan` when it asks to carry out a plan that already exists, and `--build-spec` when it asks to build from a spec that already exists (a recent spec it does not ask for is only listed in `specs`: it may be about another task).
4. **Decide.**
   - `workflow` set (not `ask`): apply it and say so in one line («forge: <option> (<its source>)»); `off` is the option `none`. When it needs superpowers and `superpowers.installed` is false, say so and ask as below.
   - `autonomy: auto`: take `recommended`, say so in one line with its `why`; `<by>` is `auto`.
   - Otherwise ask once with AskUserQuestion, in the user's language: the recommended option first, labelled «(Recomendado)», with its `why`. With superpowers: «forge», «superpowers», «superpowers diseña, forge construye», «superpowers planifica, forge ejecuta» (`forge`, `superpowers`, `superpowers-design`, `superpowers-plan`); without it: «forge» and «sin forge» (`forge`, `none`). Below it, one line: «para no volver a preguntar, dímelo y lo guardo». When the user asks for that (in the answer or later), run `FORGE local set workflow <w>` yourself: `<w>` is the option, and `off` for `none`. `<by>` is `user`.
5. **Hand over.** `FORGE route set --task <id> --chosen <option> --by <by> --session ${CLAUDE_SESSION_ID}` writes `.forge/route.json` and records the `route` decision; only this session is reminded of the route. When the chosen option is the recommended one and `recommended` names a `spec` or a `plan`, add `--spec <it>` or `--plan <it>`. Then:
   - `forge`: invoke `forge:run` with the task and `<id>` (its triage keeps the path already logged); in auto, as `/forge:run --auto`.
   - `superpowers`: invoke the superpowers process skill that fits (usually `superpowers:brainstorming`). When its work is done, offer `/forge:review` once.
   - `superpowers-design` with a spec: invoke `forge:run --from-spec <spec>` with `<id>`. Without one: invoke `superpowers:brainstorming`, telling it that **the user chose** that, once the spec is written and approved, `writing-plans` is not invoked and `forge:run --from-spec <spec>` takes over instead (`using-superpowers` puts the user's instructions above its skills).
   - `superpowers-plan` with a plan: invoke `forge:run --superpowers-plan <plan>` with `<id>`. Without one: invoke `superpowers:brainstorming` and then `writing-plans`, telling them that **the user chose** forge for the execution: once the plan is written, run `FORGE route stage --stage planning --plan <its path>` and hand off with `forge:run --superpowers-plan <its path>` instead of `subagent-driven-development` or `executing-plans`.
   - `none`: go on without forge.

   When the user drops the route or changes their mind before the hand-off, run `FORGE route stage --stage done` so the prompt hook stops reminding it.
