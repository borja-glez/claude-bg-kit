---
name: design
description: Use to create a design document for a very large task and improve it in rounds with a critic, then approve it to create the plan. Triggers: "/waypoint:design", "mejora el diseño", "otra ronda", "aplica las propuestas", "reescribe el diseño", "aprobar diseño", "importa el spec", "parte del spec".
allowed-tools: Bash(node *waypoint.cjs*) Bash(git add *) Bash(git commit *) Bash(git status *) Bash(git diff *) Bash(git log *) Agent Artifact Read Write Edit
---

# waypoint: design document → critique rounds → approved design

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …` (the plugin's `bin/` is not on PATH on every platform).

Talk to the user in their language. Everything stored (front matter keys, JSON fields, ids) stays in English.

## Rules

- Never edit `design/history/*.md` or `design/changelog.json` by hand; only `design-snapshot` touches them.
- Every edit to `DESIGN` that should count as a version ends with `design-validate` then `design-snapshot`.
- Critiques and `dismissed.json` belong to the CLI (the critic writes a critique, `critique-check` checks it, `critique-dismiss` writes `dismissed.json`): never edit them by hand. They live in `CRITIQUES` and are committed with the design.
- A round runs only when the user asks for it, also when forge drives the session; the one exception is forge's auto mode, which calls `round --auto` itself. `resume` never runs one.
- A `critical` or `major` proposal is never dismissed without a reason (the person's own words, or the critic's for that proposal), and `approve --auto` goes on only with the gate's `canAutoApprove: true`.

## Args and paths

The first token of the arguments is the subcommand: `new [--from <spec>]`, `round [--verify]`, `apply <all|1,3>`, `rewrite`, `interview`, `approve [--auto]`, `resume`, `amend`, `reopen`, `park`. With no arguments: `new` if `design.md` does not exist, otherwise `round`.

- `DESIGN` = `docs/waypoint/<project>/design.md` (ask which project if there are several).
- `LOCAL` = `.waypoint/<project>/`. Make sure `.waypoint/` is in the project's `.gitignore`.
- `CSID` = `${CLAUDE_SESSION_ID}` (this conversation's Claude id; the references write `<CSID>`).
- `CRITIQUES` = `docs/waypoint/<project>/design/critiques/`: the critiques (`r<N>.json`) and `dismissed.json`, committed with the design. Rounds from before waypoint 0.27.0 may still be in `LOCAL/critique-r<N>.json`: the CLI reads both places (`CRITIQUES` first), so never move them by hand. In `LOCAL` this skill keeps only scratch files (`design.rewrite.md`, `dismiss-reason.txt`, `design-page.html`).
- **Commits** always use pathspecs so nothing else that is staged or modified gets swept in: `git add <paths>` then `git commit -m "<message>" -- <paths>`, where `<paths>` = `DESIGN docs/waypoint/<project>/design/` (plus the `.gitignore` in the first commit of `new`). Follow the repository's commit rules (message style, attribution) for the message.
- `docs/waypoint/<project>/design/history/v<N>.md` and `design/changelog.json` belong to `design-snapshot`: never edit them by hand.
- **Snapshot notes** go in a file: write the note with the Write tool to `LOCAL/snapshot-note.txt` (overwrite it each time) and pass `--note-file LOCAL/snapshot-note.txt` to `design-snapshot`, never the note itself on the command line (quotes or `$` in a note break the shell). Each `design-snapshot` below says what its note is.
- **Binding.** Before the first step of `round`, `apply`, `rewrite`, `interview`, `amend` and `reopen`, and in `new` once `DESIGN` exists (right after its step 3; `bind` reads the file): `waypoint bind DESIGN --via design --claude ${CLAUDE_SESSION_ID}`, so the start context and the band of the draft are this conversation's. Exit 3 or 4 (another conversation holds the project's seat, or left a task of its plan in progress there): run it again with `--second-seat` and say in one line which conversation keeps the main seat. With `status: parked` in `DESIGN`, set it back to `draft` with Edit before the subcommand's first step.

`DESIGN` starts with this front matter:

```yaml
---
title: <string>
project: <kebab-id>              # [A-Za-z0-9_.-]
locale: <user language, e.g. es> # default en
summary: <string>
pillars: [{title: <string>, text: <string>}]   # 2-6 recommended
start_prompt: <string>           # default "/waypoint:work <track>"
status: draft                    # draft | approved | parked
artifact: <url>                  # added by Publish
source: <path>                   # added by design-import: the spec this design was imported from
---
```

The body is Markdown with `##` sections.

## Approved designs

If the front matter has `status: approved`, the plan was derived from this design. Before the first edit of `DESIGN` in `apply`, `rewrite` (when accepting it) or `interview`, ask once, in the user's language: «¿Enmienda (un cambio pequeño: el diseño sigue aprobado) o reabrir (vuelve a borrador y pasa otra vez por el crítico)?». If neither: stop.
- **Amend:** make the subcommand's edits keeping `status: approved`; then, instead of its own snapshot, commit and publish, follow `## amend` from its step 2 (the subcommand's `--round`, `--applied`, `--rewrite` and `--resolved` items go on that `--kind amend` snapshot too).
- **Reopen:** run `## reopen` steps 1-3, then the subcommand as usual.

`round` does not edit `DESIGN`, so it does not ask. The plan is not touched here: after an amendment, `/waypoint:plan` syncs it and raises its `design_version`; after a reopen the user re-approves with `approve`, and only then does the `waypoint:plan` skill re-derive or sync the plan by its own rules.

**Auto.** `round`, `apply`, `approve` and `reopen` accept `--auto` when forge's auto mode drives the loop (`/forge:run`, `## Autonomy`): never ask. Where a step would ask, take the safe default and say so in one line: `round` with nothing to review ends the loop (nothing new to review); `apply` with a critique of another version applies nothing (run `round` again); an approved design is reopened (`## reopen`), never amended, without asking.

## new

Read `references/new.md` now, and again every time you get here: your memory of it does not survive compaction.

## round

`round --verify` checks the changes applied since the last critique: the critic reads only the sections that changed, with the budget of a verification (at most 3 proposals, critical only).

0. `waypoint design-gate DESIGN`: when `handEdit` is true, `DESIGN` was edited by hand after its last snapshot, and only a snapshot records that edit (a critique makes none). Record it first: on a draft, run `design-validate`, then `waypoint design-snapshot DESIGN --kind round --note-file LOCAL/snapshot-note.txt` (the note: <«edición a mano», in the user's language>) and commit `Design v<N>: hand edit` (pathspecs as above). On an approved design, apply the approved-design rule above: its amend or reopen snapshot records it. Then go on, so the critic reads the edit.
1. `waypoint critique-next DESIGN` (add `--verify` for `round --verify`) prints `{round, version, budget, scope, since, changed, removed, review, out}`: `R` = `round`, `V` = `version`, the critic's `budget` (`max` proposals and the allowed `severities`), the `scope`, the sections to review (`review`) and `out`, the path of the new critique (`CRITIQUES/r<R>.json`). Exit 2 with `--verify`: there is no critique yet, so run a plain `round`. When `changed` and `removed` are both empty (`scope: changed` with an empty `review`), nothing was edited since the last critique: tell the user and ask whether to stop or to run a full review (`waypoint critique-next DESIGN --full`); with `--auto` or `--verify`, stop (nothing new to review). A change that only removed sections comes with `scope: full` (`review` is `_intro` and every section) and the removed ones in `removed`: run the round.
2. `waypoint design-gate DESIGN`: from it the critic gets the proposals still open from earlier rounds (`pending`, each with its `problem`), the ones the person set aside (`dismissed`, with their `reason`), the ones an interview resolved (`resolved`) and its own earlier proposals that were applied (`applied`, with their `change`).
3. Launch the critic with the Agent tool (`subagent_type: "waypoint:design-critic"`; if that type is not found, try `"design-critic"`). Pass it: the path of `DESIGN`, `R`, `V`, the `budget`, the `scope` and `review`, the user's language, the output path `out`, `removed` when it is not empty («these sections were removed; check nothing still depends on them») and, when R > 1, the proposals still open from earlier rounds (`pending`), `dismissed`, `resolved` and `applied`, so it neither repeats them as new nor treats them as solved.
4. `waypoint critique-check <out> --round <R> --version <V> --design DESIGN --locale <locale>`, adding `--verify` for `round --verify` and `--changed <review, comma-separated>` when the scope is `changed`. It rejects a critique over its budget, with a severity the round does not allow, whose `verdict` does not match its proposals, whose round or version differ, or whose `section` is not a slug of `DESIGN` or `_intro`; a proposal outside `review` is only a warning on stderr (show it). If it fails, launch the critic again with the same inputs plus the reported problems, and check its new critique the same way adding `--reject-on-fail`: if that check fails too, the CLI sets the critique aside as `CRITIQUES/r<R>.rejected.json`, so it never counts as a round; show the errors and stop.
5. Commit the critique: `git add CRITIQUES` then `git commit -m "Design critique r<R> (v<V>)" -- CRITIQUES` (it joins the design's history without making a new version; a `dismissed.json` written since the last commit goes with it).
6. Show the numbered proposals as they are, plus one summary line (the `verdict`, how many proposals, how many critical, and how many are still open from earlier rounds, per step 2's `pendingCounts`), and the options: `apply all`, `apply 1,3`, `apply r1:4,5 r2:all`, `round`, `rewrite`, `interview`, `approve`. With `verdict: ready` and nothing pending, recommend `approve`. End the turn.

## apply <spec>

`spec` is `all` or a comma list such as `1,3`, both for the latest critique, or items `r<R>:<list|all>` separated by spaces, for any rounds (`apply r1:4,5 r2:all`).

If `waypoint design-gate DESIGN` shows no critique yet (`latestRound` is null), tell the user to run `round` first. For each round of `spec`: if a rewrite already folded it in (a changelog entry of that round with `rewrite: true`, or in an older changelog a note `round R: rewrite`, or "full rewrite", with that round), warn before applying it again; and compare its critique's `version` with the current version `V`: if they differ, warn that the critique may be stale (the design changed after it was written) and ask whether to apply anyway (a version that only a `reopen` or an `amend` snapshot added, with the body unchanged, does not make the critique stale). Apply the approved-design rule above before editing.

1. For each round `R` of `spec` (`design-gate`'s `latestRound` for `all` or a bare list): `waypoint critique-select <its critique> <list|all>`, where its critique is `CRITIQUES/r<R>.json`, or `LOCAL/critique-r<R>.json` when only that one exists (a round from before waypoint 0.27.0); it prints the chosen proposals.
2. Apply each chosen proposal by editing `DESIGN` (Edit), faithful to its `change`. Apply only the selected proposals and change nothing else in `DESIGN`.
3. `waypoint design-validate DESIGN`; fix issues.
4. One snapshot for the whole `apply`: `waypoint design-snapshot DESIGN --note-file LOCAL/snapshot-note.txt --round <R> --kind apply --applied r<R1>:<numbers> r<R2>:<numbers>…` (the note: <summary, in the person's language>), with the numbers `critique-select` printed for each round; `R` is the latest round with a critique (prints the new `version`).
5. Commit with the message `Design v<N>: round <R>` (`N` = the printed version; pathspecs as above).
6. Publish.
7. Tell the user in two lines what changed and offer `round --verify`: the critic checks the applied change before `approve`.

## rewrite

Read `references/rewrite.md` now, and again every time you get here: your memory of it does not survive compaction.

## interview

Read `references/interview.md` now, and again every time you get here: your memory of it does not survive compaction.

## approve

Read `references/approve.md` now, and again every time you get here: your memory of it does not survive compaction.

## resume

Read `references/resume.md` now, and again every time you get here: your memory of it does not survive compaction. It takes up a draft an earlier conversation left and shows where it stands; it never runs a round.

## amend

Read `references/amend.md` now, and again every time you get here: your memory of it does not survive compaction. A small change to an approved design that keeps it approved; anything that changes what the plan builds is a `reopen`.

## reopen

Read `references/reopen.md` now, and again every time you get here: your memory of it does not survive compaction. It sends an approved design back to draft and through the critic.

## park

Read `references/park.md` now, and again every time you get here: your memory of it does not survive compaction. It sets a draft aside: neither announced at session start nor drawn in the band.

## Publish

Read `references/publish.md` now, and again every time you get here: your memory of it does not survive compaction. It builds the page, publishes it with the Artifact tool (no `capabilities`) and gives the user the URL.
