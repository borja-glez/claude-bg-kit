# Roadmap writes that forge and waypoint print

Every forge skill that touches the roadmap follows this page, and it is the only place the pin rule is stated. Forge and waypoint build each write and print it (`publish`, `write`, `batch`, `metrics`, `approval`, `runs`, `cleanup`); the skill only sends it.

**Collections.** The writes touch `state`, `sessions`, `meta`, `plan`, `approvals`, `notes` and `runs`. Before sending a printed write, list the collection it targets into `DB` (`node "<WP>" clean-cache <plan> <collection>`, then ArtifactData `list` with `query: {limit: 1000}` and `out_dir: DB`) so that you know the version of the document. `waypoint done|block --db` read `DB/meta/project.json` and `DB/plan/`: list `meta` and `plan` too, or they exit 1 («db plan cache missing»).

**Pin rule.** ArtifactData refuses a write to an existing document without `if_version`, accepts a document at most once per batch, and returns the new versions of every `set`, `update` and `batch`.
- Pin every write to an existing document to the NEWEST version you hold for it: the version returned by your own last write to it, else the listed one.
- Send a write unpinned only to create a document.
- On `version_mismatch`, re-read that one document and resend the same printed write pinned to its current version. Never edit the printed data.
- Never address one document twice in one batch. A second write to the same document (the `summary` update of `state/T` on integrate, the `publish` after a `block` batch) goes in its own call after the batch, pinned to the version the batch returned.
- The same rule covers `meta/run`, `meta/infinite`, `meta/metrics` and `runs/<runId>`: a document you wrote earlier is pinned to the version that write returned.

**Approvals.** `FORGE proposals decide` prints the proposal's `write` and an `approval` (`approvals/<id>`). A `--reopen` of a decision, and a decision that replaces an earlier mark, print an `approvalDelete` plus a `set`: send the delete first, pinned to the mark's version, then the `set` as a create. Only the roadmap's owner can write `approvals/`; a refusal for permission means nothing was saved.

**Any other failure.** Say it in one line and go on.
