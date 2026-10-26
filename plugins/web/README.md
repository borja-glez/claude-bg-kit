<div align="center">

# 🌐 web

**Domain skills for web projects.**
What every Astro site with Preact islands on Dokploy otherwise rediscovers, written down once.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.1.0](https://img.shields.io/badge/version-0.1.0-94e2d5?style=flat-square)

</div>

## Contents

- [Why web](#why-web)
- [Install](#install)
- [astro-dokploy-site](#astro-dokploy-site)
- [How it is checked](#how-it-is-checked)

## Why web

Every Astro site that ships as a Docker image behind Dokploy trips over the same things: a preview server that goes to the background under Claude Code, `lhci` failing on Windows, workers the CSP blocks, and the fields Dokploy reads its context from. web writes them down once, as a skill that loads when the work gets there, so the next site does not rediscover them.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install web@bg-kit
```

It installs at user scope (the default), because a site's repo carries no `.claude/`. To turn it off in one project, run `claude plugin disable web@bg-kit --scope local`: that writes your own `.claude/settings.local.json`, which is never committed. Restart Claude Code after installing or updating.

## astro-dokploy-site

It loads when you work on a static Astro site with Preact islands, built by pnpm into a Docker image where nginx serves `dist`, deployed by Dokploy and gated by GitHub Actions: CSP hashes and `is:inline` scripts, Lighthouse and Playwright runs under Claude Code, Vite workers the CSP blocks, layout shift from hydrating islands, MDX components, Prettier or `astro check` failing in CI, or a Dokploy build that cannot find its files.

| Area | What it settles |
| --- | --- |
| Build and islands | The `mounted` pattern, `min-height` for islands, the literal Vite worker call, MDX prose with components, pnpm pinned by `packageManager`. |
| CSP | `security.csp` with hashes per page, `is:inline` scripts hashed in the config, no `<style is:inline>` in figures, `worker-src`. |
| Checks | Prettier as its own gate, `astro check` with the TypeScript range of `@astrojs/check`, Playwright's webServer under Claude Code, Lighthouse on Windows and in CI, real Chrome. |
| Deploy | The Dockerfile at the root, nginx headers and MIME types, the Dokploy path and context fields. |
| Repo hygiene | No `CLAUDE.md` or `.claude/` in a site's repo, and the skill's rules are not duplicated in `AGENTS.md`. |

The rules live in `SKILL.md`, which stays under 16,000 bytes so a compaction keeps all of it. Four references hold the procedures; each is read when the work reaches its moment, and again every time it comes back.

## How it is checked

- `tests/plugin-web.test.ts` covers the manifest, text only, hygiene, the size cap, the pointers and the values each file must hold.
- Scenarios are run with and without the skill (superpowers:writing-skills) whenever it changes.
