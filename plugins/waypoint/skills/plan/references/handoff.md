# Handoff: how the work goes on

Read from waypoint:plan: §1 sends you here before it writes a new plan from an approved design, §5 once a plan is ready. `waypoint` and `<project>` mean what that skill says. One question, the same every time, says how the work goes on: with forge, with superpowers, here task by task, in background sessions, or planned and started later. waypoint offers forge and superpowers only when this session has them, and never needs them.

**When.** Only in a conversation the person drives, at most once per run of this skill: when §1 asked it, §5 of that same run does what the answer said instead of asking again. A later `/waypoint:plan` asks again, while no task of the plan has started.
- Never when forge drives the session (`/forge:run` brought you here: forge asks its own questions), from `/waypoint:work`'s automatic resync, or in a `/forge:infinite` cycle.
- In auto, or in a background session (`claude --bg`, a run member), nobody can answer: run step 1, print its `say` lines and one line per option with its `label` and its `command` (when not null), and go on as the skill says, without asking.

1. Run `waypoint handoff <project> --locale <the person's language code> --skills <list>`.
   - `<list>`: which of `forge:run` and `superpowers:writing-plans` are among the skills this session can invoke, comma separated, or `none` when neither is. Always pass it: a plugin installed after this session started is not loaded, and the CLI offers only what the list names.
   - Add `--states .waypoint/<project>/dbcache/state` when that folder exists.
   - It prints `{stage, detected, recommended, options, ask, say}`. On exit 2, tell the person its message and stop.
2. Print the `say` lines as they are, in one message: what this session has, the plan's size when there is one, and why the recommendation. With `ask: null` that is all: in §1 write the plan as usual, in §5 the report ends there.
3. Ask with AskUserQuestion, passing `ask` as it is: question, header, and the options in their order (the first one is the recommended one). When the person writes in a language other than Spanish or English, translate its texts keeping their order and meaning. The answer is the option whose label they chose, with or without its «(Recomendado)» mark. An answer in their own words is read as one of the options, or as what they asked for instead.
4. Do what the answer chose. Its `id`:
   - `forge`: invoke the `forge:run` skill with the arguments `--handoff <project>`. forge takes over: without a plan its planner writes it, then forge asks how to run it (the mode, how many tasks at once, the final merge and where). This skill ends here; in §1, do not write the plan.
   - `work`: in §1, write the plan as usual (§1 to §5) and, at the end of §5, invoke the `waypoint:work` skill. In §5, invoke it now.
   - `launch`: as `work`, invoking `waypoint:launch` instead. It asks which track and starts one session; say in one line that another track is launched the same way.
   - `superpowers` (offered only in §1): do not write a waypoint plan.
     - Invoke `superpowers:writing-plans` with `docs/waypoint/<project>/design.md` as the spec, telling it the design is already approved.
     - When `detected.forge.on` is true, also tell it that the person chose forge for the execution: once the plan is written, it does not offer its own ways to run it, and you invoke the `forge:run` skill with `--superpowers-plan <the plan's path>`.
     - Without forge, writing-plans offers its own ways to run the plan.
     - Say in one line that these tasks will not show on waypoint's roadmap.
   - `later`: nothing starts.
     - In §1 with `detected.forge.on` true: invoke the `forge:run` skill with `--handoff <project> --plan-only`; forge's planner writes the plan and the roadmap and stops. This skill ends here.
     - In §1 without forge: write the plan as usual.
     - Either way, the last line to the person says that `/waypoint:plan <project>` brings this question back when they want to start.

§5 never invokes `forge:run` for an answer of §1: `forge`, and `later` with forge, end this skill at §1. When forge then runs `/waypoint:plan` itself, forge drives the session and nothing here is asked.
