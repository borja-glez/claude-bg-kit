Read from waypoint:work (`## 4. Commit and complete`), when the task's `done_when` holds. `WP`, `<plan>`, `DB`, `SEAT`, `SID`, `T`, `TV`, `SV` and `multi` mean what that skill says.

1. Commit the task's changes with message `<T>: <title>` (follow the repository's commit rules).
2. Write the summary (one sentence in the user's language) to `<SEAT>/summary.txt` with the Write tool.
3. `node "<WP>" done <plan> --db DB --session <SID> --task <T> --state-version <TV> --session-version <SV> --summary-file <SEAT>/summary.txt` (add `--tests <total>` when you know the suite size; `--rev <sha>` when the task's last commit is not `HEAD`, and always on a second seat, where `SEAT` is under `seats/` and another conversation commits on the same `HEAD`: the task's own last commit) → `{now, eid, leaseUntil, batch, metrics}`.
4. Apply `batch` with one ArtifactData `batch` (the task done with its commit and summary, the `done` event and your session without a current task), then send `metrics` in a call of its own, with its data as it is (an `update` of `meta/metrics`, pinned by the pin rule: a clash on the metrics never undoes the delivery, and it keeps `tests` when you give none). List `meta` into `DB` first if you have not, so you know the version of `meta/metrics`. Then empty `<SEAT>/pending-commits.jsonl` (write an empty file); the plugin's Stop hook reminds you while it has lines.
5. With `multi`, the replies to whoever waits on `T`: item 5 of the §4 part of `references/multisession.md`.
6. **Phase close.** With `multi`: item 6 of the §4 part of `references/multisession.md`.
7. One line to the user: task done, and the global % from `node "<WP>" status <plan> --db DB --states DB/state`.
