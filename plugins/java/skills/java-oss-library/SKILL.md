---
name: java-oss-library
description: Use when maintaining spring-boot-cqrs, spring-boot-specification-repository or a Java library built the same way - a new module or starter, build-logic, coverage gates, a Maven Central release, japicmp baselines, an issue labelled agent-ready or needs-design, or a stacked pull request after a squash merge.
---

# Maintaining the Java libraries

- Read the repository's `AGENTS.md` before anything else and follow it: it is the contract of every session, local or cloud ("Working on an issue"). This skill adds only what `AGENTS.md` lacks and never contradicts it.
- Versions never come from memory: read them from `gradle/libs.versions.toml`.

## Build

- Change how the build behaves in the `build-logic` conventions (`cqrs-*`, `specification-*`), never in a module's own build file. No version lives outside the catalog.
- A new library module goes into `settings.gradle.kts`, into every list of the root `build.gradle.kts` that names a sibling module (`quality`, `coverage`, `spotlessCheckAll`, `spotlessApplyAll` and any other that does), and into the BOM `constraints`. A module missing from a list is skipped by CI without a warning.
- Leave a new module out of `apiCompatibility` until its first release. That check resolves the module's artifact at `apiBaseline` from Maven Central, and the artifact does not exist yet: listing the module breaks `quality`. Do not patch the convention to skip it, and do not touch `apiBaseline`. The first release of the module is what puts it in the list.
- Two starters, Boot 3 (Jackson 2) and Boot 4 (Jackson 3): an auto-configuration change goes into both, and `verifyBoot3Compatibility verifyBoot4Compatibility` proves it.
- Every library module keeps 100 % JaCoCo coverage, lines and branches, with its tests in the same change.
- Spotless runs Google Java Format with the import order `java, javax, jakarta, org, com, io`: run `spotlessApplyAll` before every commit.

## Issues and milestones

- The labels `agent-ready` and `needs-design` and the `### Decision` section work as `AGENTS.md` says. With `needs-design` and no `### Decision`, report the open questions and write no code and no implementation plan: "only one design point" and "the issue already settles it" are the maintainer's call, not yours.
- Milestones: a patch milestone carries only compatible changes, a minor one new API, a major one what breaks. `backlog` is what gets done only when someone asks.

## Commits and branches

- Conventional Commits, as `AGENTS.md` says.
- `docs/superpowers/` (plans, specs) never reaches `main`. Add files by their path, never with `git add -A` or `git add .`, and a branch that carries it drops it before its pull request.
- Merge train: after the parent is squash-merged, run `git rebase --onto origin/main <last sha of the old parent> <branch>`, then `git push --force-with-lease` of that branch only, never of `main`.

## Releases

Before a release or any change to publishing, read `references/release.md` now, and again every time you get here: your memory of it does not survive compaction.

## Red flags

Each thought below was seen breaking a rule. The rule wins.

| Thought | Rule |
|---|---|
| "Without this change CI would fail: the baseline artifact does not exist yet. So I list the new module in the compatibility check and make the check skip modules that have no release." (and it admits the new skip logic never ran) | `Build`: leave the module out of `apiCompatibility` until its first release. Do not bend the convention or `apiBaseline` to make CI pass. |
| "The issue is labelled `needs-design` and has no decision, so `AGENTS.md` says to stop. If you let me touch the repo, this is how I would do it: only one design point, and the issue itself leaves it out of scope." | `Issues and milestones`: stopping means the open questions, with no plan and no code. A design point is not settled because it looks small. |
| "The release is ready once every artifact resolves from Maven Central." | `references/release.md`: try it in a service that consumes it before announcing it, and know that git-cliff skips the `chore: bump version to` commit. |
