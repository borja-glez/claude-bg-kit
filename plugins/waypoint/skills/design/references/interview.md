Read from waypoint:design (`## interview` in `SKILL.md`). `waypoint`, `DESIGN`, `LOCAL`, `CRITIQUES`, `<CSID>`, the commit pathspecs, the approved-design rule, **Auto** and **Publish** mean what that skill says.

Apply the approved-design rule above before the first edit. Ask questions one at a time about the weak points of the latest critique and the proposals still pending (`waypoint design-gate DESIGN`'s `pending`), or about the least concrete sections if there is no critique. After each answer, edit `DESIGN`. When the user says enough, or no points remain:
1. Show the pending proposals the interview touched, one line each (`r<round>·<n> [severity] <section> — <problem>`), and ask once which of them the answers resolved.
2. Run `design-validate`, then `waypoint design-snapshot DESIGN --note-file LOCAL/snapshot-note.txt --kind interview` (the note: <interview, in the user's language>), adding `--resolved r<R>:<numbers> …` with the ones the user named (none named: no `--resolved`). `design-gate` stops counting them as pending, and the next critic does not raise them again.
3. Commit `Design v<N>: interview` (pathspecs as above) and publish.
