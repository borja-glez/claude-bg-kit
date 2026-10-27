---
name: plan
description: Use to create or update a waypoint plan (docs/waypoint/<project>/plan.yaml) and publish/sync its live roadmap artifact. Triggers: "/waypoint:plan", "create the roadmap", "sync the roadmap", after a design is approved, or when plan.yaml was edited.
allowed-tools: Bash(node *waypoint.cjs*) Bash(git worktree list *) Bash(git add *) Bash(git commit *) Bash(git status *) ArtifactData Artifact Read Write Edit
---

# waypoint: plan → live roadmap

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …` (the plugin's `bin/` is not on PATH on every platform).

Talk to the user in their language. Everything stored (YAML keys, ids, database fields, enum values) stays in English.

## 1. The plan file

Location: `docs/waypoint/<project>/plan.yaml`. **Before a new plan from an approved design:** when it doesn't exist and `docs/waypoint/<project>/design.md` has `status: approved`, read `references/handoff.md` now and follow it first: the person chooses how the work goes on, and only some answers have this skill write the plan. If it doesn't exist, write it from the approved design or the conversation:

```yaml
project: <kebab-id>            # [A-Za-z0-9_.-]
locale: <user language, e.g. es>
version: "0.1"
design_version: 3              # from an approved design: its version (see «The link to the design» below)
artifacts: { design: <url> }   # from a design: its artifact; publishing adds roadmap
versions: [{ id: "0.1", phases: [F1, F2] }]
tracks:   [{ id: backend, name: <visible name>, color: blue }]   # colors: blue mauve teal pink sky flamingo
phases:   [{ id: F1, name: <visible name>, plan_status: committed }]  # or provisional
tasks:
  - id: T001
    title: <visible title>
    track: backend
    phase: F1
    includes: <what it covers>
    done_when: <verifiable condition>
    verification: <command, optional>
    depends_on: []
    zones: ["src/area/**"]      # globs this task will touch
    estimate_min: 30
    design_ref: arquitectura     # from a design: the slug of the section the task comes from
retired: [T009]                  # only after `waypoint replan`: the ids it retired; keep it as it is
history: [{ at: <iso>, why: <why>, changes: [<change>] }]   # only after `waypoint replan`; keep it as it is
```

If plan.yaml does not exist yet and `docs/waypoint/<project>/design.md` exists with `status: approved`, derive the plan from it:
- one track per independent area the design names;
- phases following its scope and phasing sections;
- tasks small enough for one sitting, each with a `done_when` taken from the design's done criteria;
- `zones` from the architecture.
- each task's `design_ref`: the slug of the design section it comes from (its `##` or `###` heading in lower case, accents dropped, every other run of characters a single `-`, with `-2` for a repeated heading; `_intro` for the text before the first heading).

Show the user the track and phase outline in one short list before writing plan.yaml, and ask once for confirmation.

Likewise, if plan.yaml does not exist yet and the design's `start_prompt` contains `<track>`, replace it in `design.md` with the id of the plan's first track and commit it alone, `git commit -m "Design: first track in the start prompt" -- docs/waypoint/<project>/design.md` (no new design version; its title in the repository's style, as the commit of `plan.yaml` below says). Then re-run `design-page` and re-publish to the design's `artifact` URL.

**The link to the design.** Whether you wrote plan.yaml or it was already there (forge's `forge-planner` writes it on the Large path), when `docs/waypoint/<project>/design.md` has `status: approved`: set `artifacts.design` to the design's `artifact` (when it has one) and `design_version` to its version (the `v<N>` that `waypoint design-validate` prints for it), and give every task that comes from a section its `design_ref`. Do it again on every later sync from an approved design: an amendment adds versions, and `waypoint design-impact` lists the tasks it touched. While the design is a draft again (reopened), leave `design_version` as it is until it is approved.

Rules: tasks small enough for one sitting (≤ ~60 min); every `done_when` must be checkable; ids stable once published (never renumber). When you rewrite a plan that has `retired:` or `history:`, keep both as they are, and number a new task past the highest id of its tasks and of `retired:`.

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" validate <plan> --design docs/waypoint/<project>/design.md` (without `--design` when there is no design) and fix every reported issue, and every warning about `design_ref`, `design_version` or `artifacts.design`, before continuing. When its last line is `{"bg": {"jobTmp": "<folder>"}}`, this is a background session in the main checkout: follow «A background session in the main checkout» (after §4) for every listing and every file.

## 2. Local dir

Everything local lives in `.waypoint/<project>/` (`<project>` = the plan's `project`). Make sure `.waypoint/` is in the project's `.gitignore`. The CLI writes every file there itself (`capabilities.json`, `known.json`, the listings of a background session): you only list, publish and send.

## 3. Publish the roadmap page

1. `.waypoint/<project>/capabilities.json` holds the capabilities this publish passes; the command below writes it itself (`--write-capabilities`), exactly these:
   ```json
   {"db": {"rules": [{"path": "", "read": "view", "write": "admin"}, {"path": "notes", "read": "view", "write": "interact"}, {"path": "proposals", "read": "view", "write": "interact"}, {"path": "approvals", "read": "view", "write": "owner"}]}, "user": {"scopes": ["profile"]}, "downloads": true, "assets": {}}
   ```
   without `"assets": {}` unless this skill's arguments include `assets` (forge passes it when its verification screenshots go to the roadmap); a roadmap already published with `assets` keeps them (the command reads that from `--page`), unless the arguments include `no-assets` (the person's way back to a shareable roadmap; it never counts as `assets`). When `artifacts.roadmap` is set, list `meta` first (`node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" clean-cache <plan> meta`, then ArtifactData `list` with `query: {limit: 1000}` and `out_dir: .waypoint/<project>/dbcache`). Then run `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" page <plan> --out .waypoint/<project>/roadmap.html --publish-info --capabilities .waypoint/<project>/capabilities.json --write-capabilities` (add `--assets` when the arguments include `assets`, or `--no-assets` when they include `no-assets`; add `--page .waypoint/<project>/dbcache/meta/page.json` when `artifacts.roadmap` is set, and `--states .waypoint/<project>/dbcache/state` when that folder exists: the page shows those states until the database answers, and offline) → `{out, capabilities, internal, say, pageVersion, rules, capabilitiesChanged, ask, capabilitiesWritten, write}` (`capabilitiesChanged` and `ask` only with `--page`). Its `capabilities` are what this checkout publishes, now also the file's. `rules` is what the file grants (only a file with the owner's rule on `approvals` gets the full value). When `say` is not null, print it as it is, in the message that gives the roadmap's URL: it tells the person the page will be internal to their organization. Right after publishing or republishing with that file (steps 2 and 3), ArtifactData `set` its `write` (`meta/page`: the version, the rules and whether `assets` was published; `sync --db` compares the first two, forge reads `rules` before it trusts an approval, and the next republish compares `assets`), following the pin rule of `references/roadmap-writes.md` (pin it to the listed version when `meta/page` exists, send it unpinned when it does not). Never send it after a publish that did not pass that file.
2. If `artifacts.roadmap` is empty: publish with the Artifact tool — `file_path: .waypoint/<project>/roadmap.html`, `icon: "map"`, `description` one sentence in the user's language, and `capabilities` the content of `.waypoint/<project>/capabilities.json`, as it is. `assets` stores forge's verification screenshots, and an artifact that declares it is organization-internal, so it can no longer be shared publicly. That is what step 1's `say` tells the person. Contributors can then write notes and proposals only, and their decisions on a proposal do not count for forge: only the owner's mark in `approvals/` does, which only the owner can write (editors comment, they do not approve); everything else needs Editor. `downloads` lets a viewer save the timeline as SVG or PNG (they confirm each save). You write through ArtifactData as the owner, which the rules never limit. Record the returned URL with `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" set-roadmap <plan> <url>`: it sets `artifacts.roadmap` in plan.yaml and changes no other byte of it.
3. If it already exists and the plugin was updated (§4's `sync` says so with `republish: true`: then do this step without asking) or the user asks (after updating the plugin, run this step so the page gets the new views; `assets` or `no-assets` in this skill's arguments asks for it too): publish again with `url: <artifacts.roadmap>`, the same file and `capabilities` the content of `.waypoint/<project>/capabilities.json`, every time: a republish without them keeps the old ones, which may lack the owner's rule, and `meta/page` would then claim rules the roadmap does not have. Act on the last run of step 1, the one after any rewrite of `capabilities.json`: when that run printed `capabilitiesChanged: true`, do not publish yet: this republish changes who can see and share the roadmap. That holds even when `republish: true` brought you here or a `/forge:infinite` cycle did. Ask the person once with AskUserQuestion, with its `ask` line as it is, and two options: «Republish with the new sharing» or «Keep the roadmap as it is». Publish only after the first. On the second, or when nobody can answer (an unattended cycle, or auto), publish nothing and do not send `meta/page`; tell the person that the published roadmap keeps its sharing as it is, and that the republish goes ahead when they run `/waypoint:plan assets` (forge's screenshots, with the roadmap internal to their organization) or `/waypoint:plan no-assets` (to make it shareable again) and answer yes. Until then the page keeps its old version, and while `meta/page.rules` is below the printed `rules`, approvals are not owner-only. After a republish, a listed `meta/page` that was missing or had `rules` below the `rules` step 1 printed means the roadmap was published before the owner's approvals rule: say in one line that from now on only its owner's approvals turn into forge tasks.

## 4. Sync the database

Run sync only from the main checkout (`MAIN_REPO` = the path on the first `worktree` line of `git worktree list --porcelain`); sessions in track worktrees never sync. Running these steps on the plan of `MAIN_REPO` (`MAIN_REPO/docs/waypoint/<project>/plan.yaml`) from your own worktree, as the work skill's delegation does, counts as being in it: the listings and the files go into your worktree's `.waypoint/<project>/`, never into `MAIN_REPO`'s. The worktree of a forge autonomous run (`.claude/worktrees/<profile>-<name>`, on `forge/<profile>-<name>`) counts as the main checkout of its project: that project's plan lives only on that branch. Otherwise do not sync: tell the user the plan must be synced from the main checkout.

1. `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" clean-cache <plan> meta plan state`, so stale files never leak, then ArtifactData `list` each of `meta`, `plan` and `state` (`url` = roadmap, `query: {limit: 1000}`, `out_dir: .waypoint/<project>/dbcache`), the three calls in one message. Each result lists every document with its version.
2. `V` = those versions as one line of JSON, collection → doc id → version exactly as listed, e.g. `{"meta":{"project":3},"plan":{"F1":2},"state":{"T001":5}}` (empty collections → `{}`).
3. `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" sync <plan> --versions '<V>' --db .waypoint/<project>/dbcache --out .waypoint/<project>/sync --session <your session id or main>` (it keeps `V` in `.waypoint/<project>/known.json` itself) prints `{batches, say, removed, missing, unknownVersion, republish}`. It never writes over a document whose version `V` lacks (`unknownVersion`). Exit 2 (a listing that may be cut at 1000 documents, or a document it has to write whose version `V` lacks): redo steps 1-3 once with fresh listings; if it exits 2 again, tell the user its message and stop. Tell the user in one line each, when not empty, `removed` (tasks the plan no longer has: they become `orphaned`, keeping what they were, and come back as they were if the plan has them again) and `missing` (tasks the roadmap had no document for: this sync creates them). When you came here from `/waypoint:work`'s automatic resync and `removed` is not empty, ask once with AskUserQuestion, before step 4, whether to retire those tasks from the roadmap; on no, stop and tell the user to put them back in `plan.yaml`. With `republish` true (the published page is older than this waypoint), do §3 steps 1 and 3 after step 4.
4. For each batch, in order: ArtifactData `batch` with `writes` = that array, as printed: `sync` already pinned each write to the version `V` gives it, or left it unpinned to create the document, as the pin rule of `references/roadmap-writes.md` says; do not edit them.
   - `version_mismatch` → someone wrote meanwhile, so the versions of `V` are stale: redo steps 1–4 (the fresh listing is that rule's re-read, for every document of the sync at once).
5. Commit `plan.yaml` alone: `git add docs/waypoint/<project>/plan.yaml` and `git commit -m "Update waypoint plan" -- docs/waypoint/<project>/plan.yaml` (in the repository's style: with `"style":"conventional"` from `waypoint commit-style`, each title of this skill is `docs(waypoint): ` and the title with its first letter in lower case, as `docs(waypoint): update waypoint plan`).

**A background session in the main checkout.** When `validate` ends with `{"bg": {"jobTmp": "<folder>"}}`, Claude Code refuses this session every Write, Edit and `out_dir` inside the checkout (bgIsolation), and an `out_dir` outside it needs an approval nobody can give. Do not enter a worktree for this and do not write these files with the shell. List each collection of §3 step 1 and §4 step 1 without `out_dir`, Write each result as it is to `<jobTmp>/waypoint-<collection>.txt`, and run `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" db-import <plan> <collection>=<jobTmp>/waypoint-<collection>.txt …` (one pair per collection; it checks each file holds that collection's whole listing): it writes those listings into `.waypoint/<project>/dbcache/` and their versions into `.waypoint/<project>/known.json`; then step 3 takes `--known .waypoint/<project>/known.json` instead of `--versions`. If that Write is refused too, or a plan.yaml has to be written or edited by hand (§1, the link to the design), ask the user to run `/waypoint:plan` in an interactive session, and stop: never write these files any other way.

## 5. Report

One short message: the `say` that `sync` printed in §4 (roadmap URL and the number of tasks, phases and tracks), as it is. When forge drives the session, `/forge:run` gives this report itself and says that forge runs the tasks. Otherwise, how the work goes on: when §1 of this same run asked it, do what the answer said (`references/handoff.md` step 4); if not, read `references/handoff.md` now and follow it.
