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

1. `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" page <plan> --out .waypoint/<project>/roadmap.html`
2. If `artifacts.roadmap` is empty: publish with the Artifact tool — `file_path: .waypoint/<project>/roadmap.html`, `icon: "map"`, `description` one sentence in the user's language, and exactly these capabilities:
   ```json
   {"db": {"rules": [{"path": "", "read": "view", "write": "admin"}, {"path": "notes", "read": "view", "write": "interact"}, {"path": "proposals", "read": "view", "write": "interact"}]}, "user": {"scopes": ["profile"]}, "downloads": true}
   ```
   Contributors can then write notes and decide proposals only; everything else needs Editor. `downloads` lets a viewer save the timeline as SVG or PNG (they confirm each save). You write through ArtifactData as the owner, which the rules never limit. Write the returned URL into `artifacts.roadmap` in plan.yaml.
3. If it already exists and the plugin was updated or the user asks (after updating the plugin, run this step so the page gets the new views): publish again with `url: <artifacts.roadmap>` and the same file, omitting `capabilities` to keep them. Exception: a roadmap first published by waypoint 0.9.4 or earlier (or when you cannot tell) lacks `downloads` (the timeline export), and one from 0.7.x or earlier also the proposals rule (and, from 0.5.0 or earlier, the notes rule and the profile scope) — republish it once passing the capabilities from step 2 explicitly; after that, omit them again.

## 4. Sync the database

Run sync only from the main checkout (`MAIN_REPO` = the path on the first `worktree` line of `git worktree list --porcelain`); sessions in track worktrees never sync. Running these steps with cwd = `MAIN_REPO` (as the work skill's delegation does) counts as being in it. Otherwise do not sync: tell the user the plan must be synced from the main checkout.

1. For each of the collections `meta`, `plan` and `state`: first `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" clean-cache <plan> <collection>` so stale files never leak, then ArtifactData `list` (`url` = roadmap, `query: {limit: 1000}`, `out_dir: .waypoint/<project>/dbcache`). Each result lists every document with its version.
2. Write `.waypoint/<project>/known.json` mapping collection → doc id → version exactly as listed, e.g. `{"meta":{"project":3},"plan":{"F1":2},"state":{"T001":5}}` (empty collections → `{}`).
3. `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" sync <plan> --known .waypoint/<project>/known.json --states .waypoint/<project>/dbcache/state --out .waypoint/<project>/sync --session <your session id or main>` prints `{"batches":[[...],[...]]}`.
4. For each batch, in order: ArtifactData `batch` with `writes` = that array, unchanged.
   - `version_mismatch` → someone wrote meanwhile: redo steps 1–4.
5. Commit `plan.yaml` (message: `Update waypoint plan`), following the repository's commit rules.

## 5. Report

One short message: roadmap URL, number of tasks/phases/tracks, and how to start working (`/waypoint:work [track]`).
