<div align="center">

# ☕ java

**The decisions of a Java and Spring Boot service, fixed once.**
The DDD and hexagonal rules of a service, the upkeep of the Java libraries, and an on-demand architecture reviewer.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.1.0](https://img.shields.io/badge/version-0.1.0-f9e2af?style=flat-square)

</div>

## Contents

- [Why java](#why-java)
- [Install](#install)
- [spring-hexagonal-ddd](#spring-hexagonal-ddd)
- [java-oss-library](#java-oss-library)
- [The architecture reviewer](#the-architecture-reviewer)
- [Versions](#versions)
- [Develop](#develop)

## Why java

Every Java project made you rediscover the same things: where an event is published, which exception becomes a 422, how a new starter joins the build. java fixes those decisions once. It is text only: two skills and one agent, with no hooks, and only its two skill descriptions and the agent's description sit in context until used.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install java@bg-kit
```

It installs for your user, in every project. To turn it off in one project, put `"enabledPlugins": { "java@bg-kit": false }` in that project's `.claude/settings.local.json`. It needs none of the other plugins.

## spring-hexagonal-ddd

Loads as `/java:spring-hexagonal-ddd`, or by itself when Claude sees its description match: designing, implementing or reviewing a Spring Boot service with DDD and hexagonal architecture, or code that uses spring-boot-cqrs or spring-boot-specification-repository. It is for someone who already knows DDD: it fixes decisions and does not teach.

| Rule | What it fixes |
| --- | --- |
| `core-free` | `domain` and `application` import no framework; the cqrs API is the only exception, and time comes from an injected `Clock`. |
| `ports-and-layout` | The core reaches the outside only through ports; adapters translate and never decide. |
| `aggregates` | One root per consistency boundary, changed only by its behavior; value objects are records; one transaction, one aggregate. |
| `events-split` | Domain events and versioned integration events are separate families, joined by one translator with an exhaustive `switch`. |
| `outbox` | The events are recorded in the same transaction as the change, and a relay publishes them. |
| `domain-exception` | Every business failure is a named `DomainException` with a kebab-case `code`, rendered as an RFC 9457 problem. |
| `archunit` | ArchUnit guards the core, the events and the layout, and a new package gets its rules in the same change. |
| `specrepo-reads` | Every read goes through specification-repository, never a derived or `@Query` method. |
| `idempotent-consumers` | A consumer is `@HandleEvent` with `@Idempotent`, and it tolerates out-of-order delivery. |
| `business-no` | Over a remote command, a business "no" is a result record, never an exception. |
| `flyway-immutable` | An applied migration is never edited: a change is a new `V<n>`. |

When the project lacks what a rule names (no outbox, no specification-repository, a base exception without a `code`), the skill follows the mechanism the project has, never builds the missing piece inside a feature task, and says once in its report which rule could not apply.

Six references (tactical DDD, hexagonal layout, cqrs and specification-repository, messaging and the outbox, persistence and Flyway, testing) are read when the work reaches them, not up front. The skill tells Claude to read each one at that moment and again every time it returns to it, because its memory of it does not survive compaction.

## java-oss-library

Loads as `/java:java-oss-library`, or by itself for work on spring-boot-cqrs, spring-boot-specification-repository or a library built the same way. It sends Claude to the repository's `AGENTS.md`, which stays the contract of every session, and adds only what that file lacks: how the build changes (`build-logic`, never a module's own file), what a new module must be added to, the two Boot starters, 100 % coverage, the Maven Central release, the `agent-ready` and `needs-design` issues, the merge train after a squash merge, and keeping `docs/superpowers` out of `main`.

## The architecture reviewer

Call it as `@agent-java:architecture-reviewer`, or ask for it: "review the architecture of this branch". It is on demand, not a forge reviewer: nothing runs it by itself.

It reads the diff of a branch (or a diff file) against the rules above, whole files and not just hunks, and it runs ArchUnit (`*ArchitectureTest*`) or, if the project has none, `./gradlew quality`. It never runs what needs Docker. Its report has a fixed shape:

```text
rules: spring-hexagonal-ddd
tests: <command> → <passed | N failed: <test names>> | not run: <reason>
findings:
- [<critical|important|minor>] <file>:<line> `<rule id>` — <what breaks the rule> → <the change that fixes it>
pre-existing (outside the diff, at most 5):
- <file>:<line> `<rule id>` — <one line>
not applicable: <rule ids and why, in one line, or none>
verdict: <clean | changes needed>
```

It is read-only (Read, Grep, Glob and Bash; it has no tool to edit), runs on `opus` with `effort: high`, and has the `spring-hexagonal-ddd` skill preloaded through `skills:` with the plugin-qualified name `java:spring-hexagonal-ddd`, a form checked in a real session. If the rules do not arrive, its whole reply is `rules not loaded`.

## Versions

No version is pinned in the skills or the agent. They are read from the project's `gradle/libs.versions.toml`, or from Context7 for a doubtful API.

## Develop

- `plugins/java/.claude-plugin/plugin.json`, the two skills under `skills/` (each with its `references/`) and `agents/architecture-reviewer.md`.
- `npx vitest run tests/java-plugin.test.ts` checks the manifest, the frontmatter, the sizes, the rules and the READMEs.
- `claude plugin validate plugins/java` checks the manifest and the components.

Bump the version in `plugin.json` on every change: the installed plugin cache is keyed by version.
