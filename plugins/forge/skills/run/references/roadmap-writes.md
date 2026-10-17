# Roadmap writes that forge and waypoint print

Every forge skill that touches the roadmap follows this page. Forge and waypoint build each write and print it (`publish`, `write`, `batch`, `metrics`, `approval`, `runs`, `cleanup`); the skill only sends it.

**Collections.** The writes touch `state`, `sessions`, `meta`, `plan`, `approvals`, `notes` and `runs`. Before sending a printed write, list the collection it targets into `DB` (`node "<WP>" clean-cache <plan> <collection>`, then ArtifactData `list` with `query: {limit: 1000}` and `out_dir: DB`) so that you know the version of the document. `waypoint done|block --db` read `DB/meta/project.json` and `DB/plan/`: list `meta` and `plan` too, or they exit 1 («db plan cache missing»).

**Pin rule.**
- A printed write to a document that exists is sent with `if_version` = the version `DB` lists for that document (a document you wrote in this batch or in this session: the version the store returned).
- It is sent without `if_version` only to create the document (`set` of a new one, or the first `meta/metrics`).
- A second write to a document that an earlier write of the same batch already changed (the summary right after the task's `publish`) is sent without `if_version`, as the skill says: the version it would need does not exist yet.
- Never edit the data of a printed write, not even to fix a typo; if it looks wrong, rerun the command that printed it. The only additions a skill makes are `if_version` and the extra write the skill names (the summary, the event).

**Approvals.** `FORGE proposals decide` prints the proposal's `write` and an `approval` (`approvals/<id>`). A `--reopen` of a decision, and a decision that replaces an earlier mark, print a `delete approvals/<id>` followed by a `set`: send the delete first, pinned to the mark's listed version, and then the `set` as a create (no `if_version`). Only the roadmap's owner can write `approvals/`; a refusal for permission means nothing was saved.

**A refused write.** `version_mismatch`: `get` the document and rerun the command that printed the write, then send the new one. Any other failure: say it in one line and go on.
