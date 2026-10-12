---
name: design
description: Use to create a design document for a very large task and improve it in rounds with a critic, then approve it to create the plan. Triggers: "/waypoint:design", "mejora el diseño", "otra ronda", "aplica las propuestas", "reescribe el diseño", "aprobar diseño".
allowed-tools: Bash(node *waypoint.cjs*) Bash(git *) Agent Artifact Read Write Edit
---

# waypoint: design document → critique rounds → approved design

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …` (the plugin's `bin/` is not on PATH on every platform).

Talk to the user in their language. Everything stored (front matter keys, JSON fields, ids) stays in English.

## Args and paths

The first token of the arguments is the subcommand: `new`, `round`, `apply <all|1,3>`, `rewrite`, `interview`, `approve`. With no arguments: `new` if `design.md` does not exist, otherwise `round`.

- `DESIGN` = `docs/waypoint/<project>/design.md` (ask which project if there are several).
- `LOCAL` = `.waypoint/<project>/`. Make sure `.waypoint/` is in the project's `.gitignore`.
- **Commits** always use pathspecs so nothing else that is staged or modified gets swept in: `git add <paths>` then `git commit -m "<message>" -- <paths>`, where `<paths>` = `DESIGN docs/waypoint/<project>/design/` (plus the `.gitignore` in the first commit of `new`). Follow the repository's commit rules (message style, attribution) for the message.
- `docs/waypoint/<project>/design/history/v<N>.md` and `design/changelog.json` belong to `design-snapshot`: never edit them by hand.

`DESIGN` starts with this front matter:

```yaml
---
title: <string>
project: <kebab-id>              # [A-Za-z0-9_.-]
locale: <user language, e.g. es> # default en
summary: <string>
pillars: [{title: <string>, text: <string>}]   # 2-6 recommended
start_prompt: <string>           # default "/waypoint:work <track>"
status: draft                    # draft | approved
artifact: <url>                  # added by Publish
---
```

The body is Markdown with `##` sections.

## Approved designs

If the front matter has `status: approved`, the plan was derived from this design. Before the first edit of `DESIGN` in `apply`, `rewrite` (when accepting it), or `interview`, warn the user that the design is approved and the plan was derived from it, and ask whether to continue. If no: stop. If yes: set `status: draft` in the front matter, then edit. `round` does not edit `DESIGN`, so it does not ask. The plan is not touched here: after the changes the user re-approves with `approve`, and only then does the `waypoint:plan` skill re-derive or sync the plan by its own rules.

## new

0. If `DESIGN` already exists, stop: tell the user it exists (version and status) and offer `round` (improve it) or `rewrite` (replace it with a new version). Never overwrite it.
1. Ask for the user's draft (text, file or the current conversation) and collect it.
2. Write `DESIGN` with the front matter above (`status: draft`, no `artifact`) and a body with `##` sections.
3. Run `waypoint design-validate DESIGN` and fix every reported issue until it passes.
4. `waypoint design-snapshot DESIGN --note "<initial draft, in the user's language>" --round 0` (prints `{"version","path"}`).
5. Commit with the message `Design v1` (pathspecs as above; include the `.gitignore` if you edited it for `.waypoint/`).
6. Publish (see **Publish**) and offer the first round.

## round

1. `R` = max(the `round` of the last changelog entry, the highest number N among the `LOCAL/critique-r<N>.json` files) + 1; `V` = the current version (the `version` of the last changelog entry).
2. If there is no earlier critique in `LOCAL` (R = 1), use `scope: full` and every section. Otherwise run `waypoint design-changed DESIGN --since <version of LOCAL/critique-r<R-1>.json>` (prints `{"since","changed","scope"}`) and take `scope` and `changed`. If `changed` is empty (nothing was edited since the last critique), tell the user and ask whether to run a full review (`scope: full`) or stop. If that critique file (or its version in history) is missing, use `scope: full` and every section.
3. Launch the critic with the Agent tool (`subagent_type: "waypoint:design-critic"`; if that type is not found, try `"design-critic"`). Pass it: the path of `DESIGN`, `R`, `V`, the scope, the slugs, the user's language and the output path `LOCAL/critique-r<R>.json`.
4. `waypoint critique-check LOCAL/critique-r<R>.json --round <R> --version <V> --design DESIGN --locale <locale>` (it also rejects a critique whose round or version differ, or whose `section` is not a slug of `DESIGN` or `_intro`). If it fails, launch the critic again with the same inputs plus the reported problems; if the check still fails, show the errors and stop.
5. Show the numbered proposals as they are, plus one summary line (how many proposals, how many critical), and the options: `apply all`, `apply 1,3`, `round`, `rewrite`, `interview`, `approve`. End the turn.

## apply <spec>

`spec` is `all` or a comma list such as `1,3`.

If no critique exists in `LOCAL`, tell the user to run `round` first. If the latest critique was already folded in by a rewrite (a changelog note "full rewrite" with that round), warn before applying it again. Also compare the critique's `version` with the current version `V`; if they differ, warn that the critique may be stale (the design changed after it was written) and ask whether to apply anyway. Apply the approved-design rule above before editing.

1. `waypoint critique-select LOCAL/critique-r<R>.json <spec>` (`R` = the latest critique file that exists); it prints the chosen proposals.
2. Apply each chosen proposal by editing `DESIGN` (Edit), faithful to its `change`. Apply only the selected proposals and change nothing else in `DESIGN`.
3. `waypoint design-validate DESIGN`; fix issues.
4. `waypoint design-snapshot DESIGN --note "round R: applied 1,3 — <summary, in the user's language>" --round R` (list the applied proposal numbers) (prints the new `version`).
5. Commit with the message `Design v<N>: round <R>` (`N` = the printed version; pathspecs as above).
6. Publish.
7. Tell the user in two lines what changed and offer another round.

## rewrite

1. Write a complete improved version to `LOCAL/design.rewrite.md` (same front matter; fold in the open proposals of the latest critique).
2. Show the real diff: `git diff --no-index --word-diff DESIGN LOCAL/design.rewrite.md` (exit code 1 only means they differ), plus a summary of the main differences.
3. Ask whether to accept. If yes: apply the approved-design rule above, then copy it over `DESIGN` (with `status: draft` in its front matter), run `design-validate`, `design-snapshot` with the note "full rewrite" (in the user's language) and `--round <R of the latest critique file>` (omit `--round` if there is no critique), commit `Design v<N>: rewrite` (pathspecs as above) and publish. If no: leave `LOCAL/design.rewrite.md`; it is overwritten next time.

## interview

Apply the approved-design rule above before the first edit. Ask questions one at a time about the weak points of the latest critique (or about the least concrete sections if there is no critique). After each answer, edit `DESIGN`. When the user says enough, or no points remain: run `design-validate`, `design-snapshot` with the note "interview" (in the user's language), commit `Design v<N>: interview` (pathspecs as above) and publish.

## approve

1. List the `critical` proposals of the latest critique. Treat one as applied only if a changelog note for that round names its number, or you applied it in this conversation. If any remain (or you are unsure), show them and ask for explicit confirmation; do not continue without a yes.
2. Set `status: approved` in the front matter, run `design-validate`, run `design-snapshot` with the note "approved" (in the user's language), and commit `Design approved (v<N>)` (pathspecs as above).
3. Publish.
4. Run the `waypoint:plan` skill, telling it to start from the approved `design.md`. When forge drives the session (`/forge:run` chose Large), stop after step 3: `/forge:run` continues with `forge-planner`.

## Publish

1. `waypoint design-page DESIGN --out LOCAL/design-page.html`.
2. If the front matter has no `artifact`: publish with the Artifact tool (`file_path: LOCAL/design-page.html`, `icon: "document"`, `description` one sentence in the user's language, no `capabilities`). Write the returned URL into `artifact:` in the front matter and make a small commit (`Link design artifact`, pathspec `DESIGN` only); it does not create a new version.
3. If it already has one: publish again with `url` = `artifact` and the same file. If the Artifact tool refuses because this session has not read that artifact, read it with `action: "read"` and republish the generated `LOCAL/design-page.html` unchanged (the page is fully generated, so there is nothing to merge).
4. Always give the URL to the user.

## Rules

- Never edit `design/history/*.md` or `design/changelog.json` by hand; only `design-snapshot` touches them.
- Every edit to `DESIGN` that should count as a version ends with `design-validate` then `design-snapshot`.
