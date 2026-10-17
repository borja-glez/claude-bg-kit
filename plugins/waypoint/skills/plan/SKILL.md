---
name: plan
description: Use to create or update a waypoint plan (docs/waypoint/<project>/plan.yaml) and publish/sync its live roadmap artifact. Triggers: "/waypoint:plan", "create the roadmap", "sync the roadmap", after a design is approved, or when plan.yaml was edited.
allowed-tools: Bash(node *waypoint.cjs*) Bash(git *) ArtifactData Artifact Read Write Edit
---

# waypoint: plan → live roadmap

`waypoint` below means the plugin CLI: run it as `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <command> …` (the plugin's `bin/` is not on PATH on every platform).

Talk to the user in their language. Everything stored (YAML keys, ids, database fields, enum values) stays in English.

## 1. The plan file

Location: `docs/waypoint/<project>/plan.yaml`. If it doesn't exist, write it from the approved design or the conversation:

```yaml
project: <kebab-id>            # [A-Za-z0-9_.-]
locale: <user language, e.g. es>
version: "0.1"
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
```

If plan.yaml does not exist yet and `docs/waypoint/<project>/design.md` exists with `status: approved`, derive the plan from it:
- one track per independent area the design names;
- phases following its scope and phasing sections;
- tasks small enough for one sitting, each with a `done_when` taken from the design's done criteria;
- `zones` from the architecture.

Show the user the track and phase outline in one short list before writing plan.yaml, and ask once for confirmation.

Likewise, if plan.yaml does not exist yet and the design's `start_prompt` contains `<track>`, replace it in `design.md` with the id of the plan's first track and make a small commit of `design.md` (no new design version). Then re-run `design-page` and re-publish to the design's `artifact` URL.

Rules: tasks small enough for one sitting (≤ ~60 min); every `done_when` must be checkable; ids stable once published (never renumber).

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" validate <plan>` and fix every reported issue before continuing.

## 2. Local dir

Everything local lives in `.waypoint/<project>/` (`<project>` = the plan's `project`). Make sure `.waypoint/` is in the project's `.gitignore`.

## 3. Publish the roadmap page

1. Write `.waypoint/<project>/capabilities.json` with the Write tool: the capabilities this publish passes, exactly these:
   ```json
   {"db": {"rules": [{"path": "", "read": "view", "write": "admin"}, {"path": "notes", "read": "view", "write": "interact"}, {"path": "proposals", "read": "view", "write": "interact"}, {"path": "approvals", "read": "view", "write": "owner"}]}, "user": {"scopes": ["profile"]}, "downloads": true, "assets": {}}
   ```
   without `"assets": {}` when `.forge/config.yaml` has `evidence: local` (or forge is not used here). Then run `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" page <plan> --out .waypoint/<project>/roadmap.html --publish-info --capabilities .waypoint/<project>/capabilities.json` (add `--states .waypoint/<project>/dbcache/state` when that folder exists: the page shows those states until the database answers, and offline) → `{out, capabilities, internal, say, pageVersion, rules, write}`. Its `capabilities` are what this checkout publishes: when they differ from the file, write them to the file and run the command again. `rules` is what the file grants (only a file with the owner's rule on `approvals` gets the full value). When `say` is not null, print it as it is, in the message that gives the roadmap's URL: it tells the person the page will be internal to their organization. Right after publishing or republishing with that file (steps 2 and 3), ArtifactData `set` its `write` (`meta/page`: the version and the rules of the published page; `sync --db` compares both, and forge reads `rules` before it trusts an approval), following the pin rule of `references/roadmap-writes.md` (list `meta` first: pin it to the listed version when `meta/page` exists, send it unpinned when it does not). Never send it after a publish that did not pass that file.
2. If `artifacts.roadmap` is empty: publish with the Artifact tool — `file_path: .waypoint/<project>/roadmap.html`, `icon: "map"`, `description` one sentence in the user's language, and `capabilities` the content of `.waypoint/<project>/capabilities.json`, as it is. `assets` stores forge's verification screenshots, and an artifact that declares it is organization-internal, so it can no longer be shared publicly. That is what step 1's `say` tells the person. Contributors can then write notes and proposals only, and their decisions on a proposal do not count for forge: only the owner's mark in `approvals/` does, which only the owner can write (editors comment, they do not approve); everything else needs Editor. `downloads` lets a viewer save the timeline as SVG or PNG (they confirm each save). You write through ArtifactData as the owner, which the rules never limit. Write the returned URL into `artifacts.roadmap` in plan.yaml.
3. If it already exists and the plugin was updated (§4's `sync` says so with `republish: true`: then do this step without asking) or the user asks (after updating the plugin, run this step so the page gets the new views): publish again with `url: <artifacts.roadmap>`, the same file and `capabilities` the content of `.waypoint/<project>/capabilities.json`, every time: a republish without them keeps the old ones, which may lack the owner's rule, and `meta/page` would then claim rules the roadmap does not have. The `meta` listing step 1's `write` needs tells you what changes: a `meta/page` that is missing or has `rules` below the `rules` step 1 printed means the roadmap was published before the owner's approvals rule, so say in one line that from now on only its owner's approvals turn into forge tasks. When the file has `assets` and the roadmap was published without it (by waypoint 0.10.x or earlier, or with `evidence: local`), tell the user about the sharing change.

## 4. Sync the database

Run sync only from the main checkout (`MAIN_REPO` = the path on the first `worktree` line of `git worktree list --porcelain`); sessions in track worktrees never sync. Running these steps with cwd = `MAIN_REPO` (as the work skill's delegation does) counts as being in it. Otherwise do not sync: tell the user the plan must be synced from the main checkout.

1. For each of the collections `meta`, `plan` and `state`: first `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" clean-cache <plan> <collection>` so stale files never leak, then ArtifactData `list` (`url` = roadmap, `query: {limit: 1000}`, `out_dir: .waypoint/<project>/dbcache`). Each result lists every document with its version.
2. Write `.waypoint/<project>/known.json` mapping collection → doc id → version exactly as listed, e.g. `{"meta":{"project":3},"plan":{"F1":2},"state":{"T001":5}}` (empty collections → `{}`).
3. `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" sync <plan> --known .waypoint/<project>/known.json --db .waypoint/<project>/dbcache --out .waypoint/<project>/sync --session <your session id or main>` prints `{batches, say, removed, missing, unknownVersion, republish}`. It never writes over a document whose version `known.json` lacks (`unknownVersion`). Exit 2 (a listing that may be cut at 1000 documents, or a document it has to write whose version `known.json` lacks): redo steps 1-3 once with fresh listings; if it exits 2 again, tell the user its message and stop. Tell the user in one line each, when not empty, `removed` (tasks the plan no longer has: they become `orphaned`, keeping what they were, and come back as they were if the plan has them again) and `missing` (tasks the roadmap had no document for: this sync creates them). When you came here from `/waypoint:work`'s automatic resync and `removed` is not empty, ask once with AskUserQuestion, before step 4, whether to retire those tasks from the roadmap; on no, stop and tell the user to put them back in `plan.yaml`. With `republish` true (the published page is older than this waypoint), do §3 steps 1 and 3 after step 4.
4. For each batch, in order: ArtifactData `batch` with `writes` = that array, unchanged (the pin rule of `references/roadmap-writes.md` covers these writes; never pin or unpin one yourself).
   - `version_mismatch` → someone wrote meanwhile: redo steps 1–4.
5. Commit `plan.yaml` (message: `Update waypoint plan`), following the repository's commit rules.

## 5. Report

One short message: the `say` that `sync` printed in §4 (roadmap URL and the number of tasks, phases and tracks), as it is, then how to start working (`/waypoint:work [track]`). When forge drives the session, `/forge:run` gives this report itself and says that forge runs the tasks.
