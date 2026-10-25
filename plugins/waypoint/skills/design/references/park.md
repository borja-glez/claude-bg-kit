Read from waypoint:design (`## park` in `SKILL.md`). `waypoint`, `DESIGN`, `LOCAL`, `CRITIQUES`, `<CSID>`, the commit pathspecs, the approved-design rule, **Auto** and **Publish** mean what that skill says.

Sets the design aside: a parked design is neither announced at session start nor drawn in the band until a subcommand takes it up again.

1. `waypoint design-park DESIGN` (it sets `status: parked`). Exit 2: only a draft is parked; tell the user the design is `approved` (an approved design is neither announced nor drawn anyway), or, when it says `cannot read`, that the design file is missing, and stop. `changed: false`: it was parked already; skip step 2.
2. Commit with the message `Design parked (v<N>)` (`N` = the `version` of the last changelog entry; pathspecs as above).
3. `waypoint release DESIGN --claude <CSID>` (it ends this conversation's binding). Exit 3: this conversation never bound a seat here and another live conversation holds the project's; there is nothing of this one's to release: go on.
4. Tell the user in one line that the design is parked and that `/waypoint:design round` takes it up again.
