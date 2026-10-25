Read from waypoint:design (`## Publish` in `SKILL.md`). `waypoint`, `DESIGN`, `LOCAL`, `CRITIQUES`, `<CSID>`, the commit pathspecs, the approved-design rule, **Auto** and **Publish** mean what that skill says.

1. `waypoint design-page DESIGN --out LOCAL/design-page.html`.
2. If the front matter has no `artifact`: publish with the Artifact tool (`file_path: LOCAL/design-page.html`, `icon: "document"`, `description` one sentence in the user's language, no `capabilities`). Write the returned URL into `artifact:` in the front matter and make a small commit (`Link design artifact`, pathspec `DESIGN` only); it does not create a new version.
3. If it already has one: publish again with `url` = `artifact` and the same file. If the Artifact tool refuses because this session has not read that artifact, read it with `action: "read"` and republish the generated `LOCAL/design-page.html` unchanged (the page is fully generated, so there is nothing to merge).
4. Always give the URL to the user.
