---
name: verify
description: Use to create, show or edit forge verify surfaces (how this project is checked by using it — a web in the browser, an app in an emulator, a simulated device, anything) and to verify one surface by hand. Triggers: "/forge:verify", "para probar X usa Y", "así se prueba", "verifica en el emulador", "how do I test this".
---

# forge: verify surfaces

`FORGE` means `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`. Speak in the user's language.

A surface is `.forge/verify/<name>.md` (in git): an optional YAML header (`affects`: globs of the files whose changes make it worth checking; `tools`: free names of tools it uses) and a free-text body saying how to start and check it, plus a `## Aprendido` / `## Learned` section of dated notes.

- **List:** `FORGE surfaces` (surfaces and detected drafts). Show name, title, affects and tools.
- **Permissions** are tied to the surface's content (the whole file): after you write or edit a surface at the user's request, run `FORGE local set surfaces.<name> allowed` again so the allowance covers the new text. An edit that did not come from the user here (a commit, a PR) makes `verify-plan` report `permission: changed`, and the user is asked again.
- **The user explains how to check something** ("para probar el Bluetooth usa el emulador con fake-scale.js"): write or update `.forge/verify/<name>.md` with the Write/Edit tools — the body in the user's words (summarised if long), a header with the `affects` and `tools` you can infer (or none), and the Learned section in the user's language. Do not ask for confirmation: the user asked. Then `FORGE local set surfaces.<name> allowed` (they described it on this machine) and say in one line which file you wrote.
- **Edit:** change what the user asks with Edit, then `FORGE local set surfaces.<name> allowed` again; never touch the Learned notes unless asked. To add Learned notes use `FORGE surfaces learn --name <name> --notes-file <f> --heading Aprendido` (or `Learned`), never Edit: it keeps the permission valid.
- **Verify by hand** (`/forge:verify <name>`): spawn `forge:forge-verify` (or the agent `FORGE agents` maps `verify` to) with that surface, depth `smoke`, no brief (the check is "it starts and its main screen or output looks right"), review and evidence dirs `.forge/work/manual-<date>/reviews-1-1/` and `.forge/work/manual-<date>/evidence/1-1/`, and the limits from `.forge/config.yaml`. Report the result, show the screenshot paths, and append its `learned` notes with `FORGE surfaces learn` (see the run skill).
