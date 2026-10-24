Read from forge:infinite (`references/autonomous.md`, a product run, every cycle). `FORGE`, `WP`, `NOW`, `SID`, `<CSID>`, `<plan>` and `DB` mean what that skill says, and `<n>` what `references/autonomous.md` says; `EID` = `node "<WP>" event-id <SID>`, as for every note.

A `product` run builds a product from its vision, the project's `docs/waypoint/<n>/design.md`: what it is, who it is for, its pillars, the quality criteria of a professional product of that kind, and what it is not. On top of the cycle of `references/autonomous.md`, it researches the market at its start and whenever a phase closes, puts each new task in the phase it belongs to, and reviews the whole roadmap when a phase closes. Only this file is read every cycle; the start and the phase close have their own.

## At the start

`references/autonomous.md` step 5 reads `references/product-start.md` and does it: the market research before the plan, and its note sent once the roadmap is published.

## Each cycle

The cycle of `references/autonomous.md`, with these changes:
- **The market note.** §3.4's `forge-scout` and the cycle's `forge-critic` also get the file `FORGE market last` prints, when it is not null.
- **Approved to tasks (§3.2).** A product run puts each new task in the phase it belongs to, with a `done_when` a check can see, what it waits for and an estimate; never in the improvements phase `PX`:
  1. `FORGE proposals to-task <id> --plan <plan> --db DB`, without placement flags, takes the placement of the critic's `keep` that approved it.
  2. Exit 2 about its placement (the message names `--phase`: no `keep` placed it, as for an idea the person insisted on or one the owner approved on the page, or the critic's placement no longer holds): place it yourself, by the critic's rules: a phase of `<plan>` that is not done (an empty one is fine), never `PX`; a `done_when` that says what a check sees, more than the title, written with the Write tool to `.forge/work/infinite/done-when-<id>.txt`; the tasks it waits for; an estimate such as `45m` or `2h`. Then run it once more with them: `FORGE proposals to-task <id> --plan <plan> --phase <F> --done-when-file .forge/work/infinite/done-when-<id>.txt --estimate <e> --depends-on <ids> --db DB` (`--depends-on T004,T007` only when it waits for tasks).
  3. Its placement refused again (the message says the placement does not hold): ArtifactData `set` a debt note `notes/<EID>` `{ts: NOW, type: "debt", author: "session:<SID>", text, proposalId: "<id>"}`, its text naming the proposal and what the CLI printed. It waits for the person (`run.saturation` lists it in `waiting.unplaced`): while that note is in `DB/notes`, §3.2 skips it.
  4. Exit 2 because it has no mark of the roadmap's owner: skip it, as §3.2 says. Exit 2 that says `list state first`: list `state` into `DB` (`node "<WP>" clean-cache <plan> state`, then ArtifactData `list` it with `query: {limit: 1000}` and `out_dir: DB`) and run it again.

  A refused placement never sends the proposal to `PX`, nor back to the critic.
- **A fresh state.** Right after §3.3, before the phase check below and before §3.4's scout and critic, list `state` into `DB` again (`node "<WP>" clean-cache <plan> state`, then ArtifactData `list` it with `query: {limit: 1000}` and `out_dir: DB`): §3.3's `/waypoint:work` listed it before its task was done, so without it the task just finished reads as not done, its phase never closes, and the critic places new work into that phase.
- **A phase that closes.** Then, every cycle, whether a task finished or not (so a close cut short goes on), run `FORGE infinite phase --plan <plan> --db DB` from the worktree: it reads the proposals, the marks and the ledger of the directory it runs in. It prints `{closed, phases, held}`. With `closed` not null, do `## When a phase closes` for that phase now, before §3.4.
- **The rounds.** An exploration round is the scout and the critic (`references/autonomous.md`). The market runs at the start and at every phase close, so the rounds that end a run read the market of its last phase close.

## When a phase closes

When `FORGE infinite phase` gives `closed`, read `references/phase-close.md` now, and again every time, and do it for that phase: the market, the review of the whole roadmap, its re-plan, its findings and any vision change.
