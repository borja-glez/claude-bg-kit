---
name: design
description: Use to create a design document for a very large task and improve it in rounds with a critic, then approve it to create the plan. Triggers: "/waypoint:design", "mejora el diseño", "otra ronda", "aplica las propuestas", "reescribe el diseño", "aprobar diseño", "importa el spec", "parte del spec".
allowed-tools: Bash(node *waypoint.cjs*) Bash(git *) Agent Artifact Read Write Edit
---

# waypoint: design document → critique rounds → approved design

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …` (the plugin's `bin/` is not on PATH on every platform).

Talk to the user in their language. Everything stored (front matter keys, JSON fields, ids) stays in English.

## Args and paths

The first token of the arguments is the subcommand: `new [--from <spec>]`, `round`, `apply <all|1,3>`, `rewrite`, `interview`, `approve [--auto]`, `resume`, `park`. With no arguments: `new` if `design.md` does not exist, otherwise `round`.

- `DESIGN` = `docs/waypoint/<project>/design.md` (ask which project if there are several).
- `LOCAL` = `.waypoint/<project>/`. Make sure `.waypoint/` is in the project's `.gitignore`.
- **Commits** always use pathspecs so nothing else that is staged or modified gets swept in: `git add <paths>` then `git commit -m "<message>" -- <paths>`, where `<paths>` = `DESIGN docs/waypoint/<project>/design/` (plus the `.gitignore` in the first commit of `new`). Follow the repository's commit rules (message style, attribution) for the message.
- `docs/waypoint/<project>/design/history/v<N>.md` and `design/changelog.json` belong to `design-snapshot`: never edit them by hand.
- **Binding.** Before the first step of `round`, `apply`, `rewrite` and `interview`, and in `new` once `DESIGN` exists (right after its step 3; `bind` reads the file): `waypoint bind DESIGN --via design --claude ${CLAUDE_SESSION_ID}`, so the start context and the band of the draft are this conversation's. Exit 3 or 4 (another conversation holds the project's seat, or left a task of its plan in progress there): run it again with `--second-seat` and say in one line which conversation keeps the main seat. With `status: parked` in `DESIGN`, set it back to `draft` with Edit before the subcommand's first step.

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

If the front matter has `status: approved`, the plan was derived from this design. Before the first edit of `DESIGN` in `apply`, `rewrite` (when accepting it), or `interview`, warn the user that the design is approved and the plan was derived from it, and ask whether to continue. If no: stop. If yes: set `status: draft` in the front matter, then edit. `round` does not edit `DESIGN`, so it does not ask. The plan is not touched here: after the changes the user re-approves with `approve`, and only then does the `waypoint:plan` skill re-derive or sync the plan by its own rules.

**Auto.** `round`, `apply` and `approve` accept `--auto` when forge's auto mode drives the loop (`/forge:run`, `## Autonomy`): never ask. Where a step would ask, take the safe default and say so in one line: `round` with an empty `changed` list ends the loop (nothing new to review); `apply` with a critique of another version applies nothing (run `round` again); an approved design is reopened (`status: draft`) without asking.

## new

0. If `DESIGN` already exists, stop: tell the user it exists (version and status) and offer `round` (improve it) or `rewrite` (replace it with a new version). Never overwrite it.
1. **From a spec** (`new --from <spec>`: a superpowers spec, or any Markdown spec with a `# ` title and `##` sections): `waypoint design-import <spec> --project <project> --locale <user language> --out DESIGN`. `<project>` is the one the user named, else a kebab slug of the spec's file name without its date prefix and its `-design` suffix (`2026-10-12-forge-route-design.md` → `forge-route`). Exit 2: tell the user its message and stop. Then fill `pillars` (2-6, in the spec's own words) in the front matter with Edit and change nothing else: the body stays as the spec wrote it, and `source` names the spec. In many projects `docs/superpowers/` is in `.gitignore`; that does not matter, `DESIGN` goes to git. Skip step 2.
   **Otherwise** ask for the user's draft (text, file or the current conversation) and collect it.
2. Write `DESIGN` with the front matter above (`status: draft`, no `artifact`) and a body with `##` sections.
3. Run `waypoint design-validate DESIGN` and fix every reported issue until it passes.
4. `waypoint design-snapshot DESIGN --note "<initial draft, in the user's language>" --round 0` (prints `{"version","path"}`). After an import the note is "<imported from <spec>, in the user's language>".
5. Commit with the message `Design v1` (pathspecs as above; include the `.gitignore` if you edited it for `.waypoint/`).
6. Publish (see **Publish**), give the URL and offer the first round, then **end the turn**. After an import, offer **another round (recommended)**, since the spec has not been through the critic, or **approve now**. A round runs only when the user asks for it, also when forge drives the session; the one exception is forge's auto mode, which calls `round --auto` itself.

## round

1. `R` = max(the `round` of the last changelog entry, the highest number N among the `LOCAL/critique-r<N>.json` files) + 1; `V` = the current version (the `version` of the last changelog entry).
2. If there is no earlier critique in `LOCAL` (R = 1), use `scope: full` and every section. Otherwise run `waypoint design-changed DESIGN --since <version of LOCAL/critique-r<R-1>.json>` (prints `{"since","changed","scope"}`) and take `scope` and `changed`. If `changed` is empty (nothing was edited since the last critique), tell the user and ask whether to run a full review (`scope: full`) or stop. If that critique file (or its version in history) is missing, use `scope: full` and every section.
3. Launch the critic with the Agent tool (`subagent_type: "waypoint:design-critic"`; if that type is not found, try `"design-critic"`). Pass it: the path of `DESIGN`, `R`, `V`, the scope, the slugs, the user's language, the output path `LOCAL/critique-r<R>.json` and, when R > 1, the proposals still open from earlier rounds: the `pending` list of `waypoint design-gate DESIGN` with each one's `problem` (from its `LOCAL/critique-r<N>.json`), so it neither repeats them as new nor treats them as solved.
4. `waypoint critique-check LOCAL/critique-r<R>.json --round <R> --version <V> --design DESIGN --locale <locale>` (it also rejects a critique whose round or version differ, or whose `section` is not a slug of `DESIGN` or `_intro`). If it fails, launch the critic again with the same inputs plus the reported problems; if the check still fails, show the errors and stop.
5. Show the numbered proposals as they are, plus one summary line (how many proposals, how many critical, and how many are still open from earlier rounds, per `design-gate`'s `pendingCounts`), and the options: `apply all`, `apply 1,3`, `apply r1:4,5 r2:all`, `round`, `rewrite`, `interview`, `approve`. End the turn.

## apply <spec>

`spec` is `all` or a comma list such as `1,3`, both for the latest critique, or items `r<R>:<list|all>` separated by spaces, for any rounds (`apply r1:4,5 r2:all`).

If no critique exists in `LOCAL`, tell the user to run `round` first. For each round of `spec`: if a rewrite already folded it in (a changelog entry of that round with `rewrite: true`, or in an older changelog a note `round R: rewrite`, or "full rewrite", with that round), warn before applying it again; and compare its critique's `version` with the current version `V`: if they differ, warn that the critique may be stale (the design changed after it was written) and ask whether to apply anyway. Apply the approved-design rule above before editing.

1. For each round `R` of `spec` (the latest critique file that exists for `all` or a bare list): `waypoint critique-select LOCAL/critique-r<R>.json <list|all>`; it prints the chosen proposals.
2. Apply each chosen proposal by editing `DESIGN` (Edit), faithful to its `change`. Apply only the selected proposals and change nothing else in `DESIGN`.
3. `waypoint design-validate DESIGN`; fix issues.
4. One snapshot for the whole `apply`: `waypoint design-snapshot DESIGN --note "<summary, in the person's language>" --round <R> --applied r<R1>:<numbers> r<R2>:<numbers>…`, with the numbers `critique-select` printed for each round; `R` is the latest round with a critique (prints the new `version`).
5. Commit with the message `Design v<N>: round <R>` (`N` = the printed version; pathspecs as above).
6. Publish.
7. Tell the user in two lines what changed and offer another round.

## rewrite

1. Write a complete improved version to `LOCAL/design.rewrite.md` (same front matter; fold in the open proposals of the latest critique).
2. Show the real diff: `git diff --no-index --word-diff DESIGN LOCAL/design.rewrite.md` (exit code 1 only means they differ), plus a summary of the main differences.
3. Ask whether to accept. If yes: apply the approved-design rule above, then copy it over `DESIGN` (with `status: draft` in its front matter), run `design-validate`, `design-snapshot` with `--note "<summary, in the person's language>" --round R --rewrite` (`R` = the latest critique file; `--rewrite` tells `design-gate` the rewrite folded in its proposals; without a critique, the note "full rewrite" in the user's language and no `--round`), commit `Design v<N>: rewrite` (pathspecs as above) and publish. If no: leave `LOCAL/design.rewrite.md`; it is overwritten next time.

## interview

Apply the approved-design rule above before the first edit. Ask questions one at a time about the weak points of the latest critique (or about the least concrete sections if there is no critique). After each answer, edit `DESIGN`. When the user says enough, or no points remain: run `design-validate`, `design-snapshot` with the note "interview" (in the user's language), commit `Design v<N>: interview` (pathspecs as above) and publish.

## approve

1. Run `waypoint design-gate DESIGN`. Its `pending` lists the proposals of every round that were neither applied (the changelog's `applied`, or in an older changelog a note `round R: applied …`), nor folded in by a rewrite, nor dismissed. When it is not empty, show the `critical` and `major` ones, one line each (`r<round>·<n> [severity] <section> — <problem>`, the problem from that round's critique file), and the `minor` ones as one count, then ask once: apply them first (one call `apply r<R>:<numbers> …` with the pending numbers of each round), or dismiss them and approve. Do not continue without an explicit answer. On dismiss: `waypoint critique-dismiss DESIGN --round <R> <numbers>` for each round, then go on. With `--auto`: do not ask; with the gate's `canAutoApprove: true` go on (the snapshot note of step 2 is "approved (auto)"); otherwise stop and say why (its `criticalPending`, or that no critique round was run yet).
2. Set `status: approved` in the front matter, run `design-validate`, run `design-snapshot` with the note "approved" (in the user's language), and commit `Design approved (v<N>)` (pathspecs as above).
3. Publish.
4. Run the `waypoint:plan` skill, telling it to start from the approved `design.md`. When forge drives the session (`/forge:run` chose Large), stop after step 3: `/forge:run` continues with `forge-planner`.

## resume

Takes up a draft an earlier conversation left (the band's [Resume]): it binds this conversation to it and shows where it stands. It never runs a round: the critic runs only when the user asks for `round`.

1. With `status: approved` in `DESIGN`, say in one line that the design is approved and the plan was derived from it, and stop. With `status: parked`, set it back to `draft` with Edit.
2. `waypoint bind DESIGN --via design --resume --claude ${CLAUDE_SESSION_ID}` (`--resume` takes the seat the earlier conversation left). Exit 3 or 4: run it again with `--second-seat` and say in one line which conversation keeps the main seat, as in **Binding** above.
3. `waypoint design-gate DESIGN` → its `version`, `pending` and `pendingCounts`.
4. Show the version, the design's URL (`artifact` in the front matter) when it has one, and the pending proposals: the `critical` and `major` ones one line each (`r<round>·<n> [severity] <section> — <problem>`, the problem from that round's critique file), the `minor` ones as one count, or that none is pending. Then the options: `apply r<R>:<numbers>`, `round`, `rewrite`, `interview`, `approve`, `park`. **End the turn.**

## park

Sets the design aside: a parked design is neither announced at session start nor drawn in the band until a subcommand takes it up again.

1. `waypoint design-park DESIGN` (it sets `status: parked`). Exit 2: only a draft is parked; tell the user the design is `approved` (an approved design is neither announced nor drawn anyway), or, when it says `cannot read`, that the design file is missing, and stop. `changed: false`: it was parked already; skip step 2.
2. Commit with the message `Design parked (v<N>)` (`N` = the `version` of the last changelog entry; pathspecs as above).
3. `waypoint release DESIGN --claude ${CLAUDE_SESSION_ID}` (it ends this conversation's binding). Exit 3: this conversation never bound a seat here and another live conversation holds the project's; there is nothing of this one's to release: go on.
4. Tell the user in one line that the design is parked and that `/waypoint:design round` takes it up again.

## Publish

1. `waypoint design-page DESIGN --out LOCAL/design-page.html`.
2. If the front matter has no `artifact`: publish with the Artifact tool (`file_path: LOCAL/design-page.html`, `icon: "document"`, `description` one sentence in the user's language, no `capabilities`). Write the returned URL into `artifact:` in the front matter and make a small commit (`Link design artifact`, pathspec `DESIGN` only); it does not create a new version.
3. If it already has one: publish again with `url` = `artifact` and the same file. If the Artifact tool refuses because this session has not read that artifact, read it with `action: "read"` and republish the generated `LOCAL/design-page.html` unchanged (the page is fully generated, so there is nothing to merge).
4. Always give the URL to the user.

## Rules

- Never edit `design/history/*.md` or `design/changelog.json` by hand; only `design-snapshot` touches them.
- Every edit to `DESIGN` that should count as a version ends with `design-validate` then `design-snapshot`.
