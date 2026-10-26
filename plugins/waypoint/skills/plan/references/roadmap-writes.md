# Roadmap writes that the waypoint CLI prints

The waypoint skills that send CLI writes follow this page, and it is the only place the pin rule is stated. The CLI builds each write and prints it (`waypoint done` prints `batch` and `metrics`, `page --publish-info --capabilities F` prints `write` for `meta/page`, `sync --db` prints `batches`); the skill only sends it.

**Collections.** The writes touch `meta`, `plan`, `state`, `sessions` and `events`. Before sending a printed write, list the collection it targets into `.waypoint/<project>/dbcache` (waypoint's `clean-cache <plan> <collection>`, run as the skill that sent you here runs the CLI, then ArtifactData `list` with `query: {limit: 1000}` and `out_dir: .waypoint/<project>/dbcache`) so that you know the version of the document.

**Pin rule.** ArtifactData refuses a write to an existing document without `if_version`, accepts a document at most once per batch, and returns the new versions of every `set`, `update` and `batch`.
- Pin every write to an existing document to the NEWEST version you hold for it: the version returned by your own last write to it, else the listed one.
- Send a write unpinned only to create a document.
- On `version_mismatch`, re-read that one document and resend the same printed write pinned to its current version. Never edit the printed data.
- Never address one document twice in one batch. A second write to the same document goes in its own call after the batch, pinned to the version the batch returned.

This covers `meta/metrics` from `waypoint done`, `meta/page` from `page --publish-info`, and the writes of `sync --db` (which arrive pinned to the listed versions you gave it, kept in `known.json`).

**Any other failure.** Say it in one line and go on.
