Read from waypoint:design (`## reopen` in `SKILL.md`). `waypoint`, `DESIGN`, `LOCAL`, `CRITIQUES`, `<CSID>`, the commit pathspecs, the approved-design rule, **Auto** and **Publish** mean what that skill says.

Sends an approved design back to draft and through the critic, for a change that alters what the plan builds.

0. If `status` is already `draft`, say that there is nothing to reopen and stop. The CLI also refuses (exit 2) a draft that was never approved.
1. Set `status: draft` in the front matter with Edit (when the reopening comes with a change, such as a new section, make it now too) and run `waypoint design-validate DESIGN`.
2. `waypoint design-snapshot DESIGN --kind reopen --note-file LOCAL/snapshot-note.txt` (the note: <reopened: why, in the user's language>; exit 2: the design is not a draft yet).
3. Commit `Design v<N>: reopened` (pathspecs as above) and publish.
4. Go on with the usual loop: `round` (the first round after a reopen gets the full budget again, on what changed), `apply`, `round --verify` and `approve`. Once approved again, `/waypoint:plan` syncs the plan and its `design_version`.
