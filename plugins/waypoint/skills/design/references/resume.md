Read from waypoint:design (`## resume` in `SKILL.md`). `waypoint`, `DESIGN`, `LOCAL`, `CRITIQUES`, `<CSID>`, the commit pathspecs, the approved-design rule, **Auto** and **Publish** mean what that skill says.

Takes up a draft an earlier conversation left (the band's [Resume]): it binds this conversation to it and shows where it stands. It never runs a round: the critic runs only when the user asks for `round`.

1. With `status: approved` in `DESIGN`, say in one line that the design is approved and the plan was derived from it, offer `amend` or `reopen`, and stop. With `status: parked`, set it back to `draft` with Edit.
2. `waypoint bind DESIGN --via design --resume --claude <CSID>` (`--resume` takes the seat the earlier conversation left). Exit 3 or 4: run it again with `--second-seat` and say in one line which conversation keeps the main seat, as in **Binding** above.
3. `waypoint design-gate DESIGN` → its `version`, `pending` and `pendingCounts`.
4. Show the version, the design's URL (`artifact` in the front matter) when it has one, and the pending proposals: the `critical` and `major` ones one line each (`r<round>·<n> [severity] <section> — <problem>`), the `minor` ones as one count, or that none is pending; when `needsVerify` is true, say a change was made that no critic has read, and that `round --verify` reads it (with `handEdit` true the change is a hand edit, which `round` snapshots first). Then the options: `apply r<R>:<numbers>`, `round`, `round --verify`, `rewrite`, `interview`, `approve`, `park`. **End the turn.**
