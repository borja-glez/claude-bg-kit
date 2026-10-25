Read from waypoint:design (`## amend` in `SKILL.md`). `waypoint`, `DESIGN`, `LOCAL`, `CRITIQUES`, `<CSID>`, the commit pathspecs, the approved-design rule, **Auto** and **Publish** mean what that skill says.

A small change to an approved design that keeps it approved: a correction, a detail the plan already assumes, a section the tasks do not depend on. Anything that changes what the plan builds is a `reopen`. On a draft there is nothing to amend: edit it and snapshot as usual.

1. Edit `DESIGN` as the user asked, keeping `status: approved`, and run `waypoint design-validate DESIGN`.
2. `waypoint design-snapshot DESIGN --kind amend --note-file LOCAL/snapshot-note.txt` (the note: <what changed, in the user's language>; exit 2: the design is not approved).
3. When `docs/waypoint/<project>/plan.yaml` exists: `waypoint design-impact DESIGN --plan docs/waypoint/<project>/plan.yaml` (add `--states .waypoint/<project>/dbcache/state` when that folder exists; `--since <N>` compares with another version than the plan's `design_version`) prints `{since, changed, removed, tasks, unref}`: the tasks whose `design_ref` is a section that changed or went away, with their state, and how many tasks have no `design_ref`. When `tasks` is empty and `unref` is every task, the plan is not linked to the design: say so (`/waypoint:plan` links it).
4. Commit `Design v<N>: amend` (pathspecs as above) and publish.
5. Tell the user what changed, list the tasks of step 3 one line each (`T012 · <section> · <state>`), and offer `/waypoint:plan`: it syncs the plan and raises its `design_version`.
