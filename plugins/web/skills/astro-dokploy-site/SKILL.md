---
name: astro-dokploy-site
description: Use when working on an Astro site with Preact islands, built with pnpm and shipped as a Docker image with nginx on Dokploy, and facing CSP hashes or is:inline scripts, Lighthouse or Playwright runs under Claude Code (lhci EPERM on Windows, astro preview going to the background, port 4321 taken), Vite workers blocked by the CSP, layout shift from hydrating islands, MDX components, Prettier or astro check failing in CI, or a Dokploy build that cannot find its files.
---

# Astro sites on Dokploy

This is for a static Astro site with Preact islands, built by pnpm into a Docker image where nginx serves `dist`, deployed by Dokploy and gated by GitHub Actions. Versions are set by the project's `package.json` (or its Dockerfile), never by this skill, and a configuration key is confirmed with Context7 before you trust it.

## Rules

1. Astro with Preact islands and pnpm (the `packageManager` field of `package.json`). An island follows the `mounted` pattern: whatever depends on the client is painted after `mounted` turns true, and the island reserves its height with `min-height`.
2. The `Dockerfile` lives at the repo root, with nginx serving `dist`. In Dokploy set Dockerfile path `Dockerfile` and `Docker Context Path` `.`: an empty field makes the Dockerfile's own folder the context.
3. The CSP comes from `security.csp`, with hashes per page. Every `is:inline` script gets its hash in the config. Never `<style is:inline>` in a figure.
4. Vite finds a worker only through the literal `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`, written at the call site with no helper in between. Behind a helper the `.ts` ships embedded as a `data:` URL, which the CSP blocks. A guard after the build checks it.
5. In MDX, a prose line never starts with an inline component (`<Term`): Prettier turns it into a block and the sentence breaks. Keep a test for it.
6. Prettier (`pnpm format:check`) is a CI gate that `astro check` does not cover. `astro check` needs TypeScript 6, not 7.
7. `astro preview` detects the agent and goes to the background. Playwright's webServer carries `env: { CLAUDECODE: '', … }` and `--ignore-lock`; the port comes from `PORT` (4321 is often taken) and `reuseExistingServer: false` makes a busy port fail instead of testing someone else's server.
8. Lighthouse:
   - in CI, `lhci` with `numberOfRuns` 3;
   - on Windows `lhci` ends in `EPERM`: use `npx lighthouse` against a headless Chrome launched on its own;
   - CI numbers are reproduced in the Playwright container with `CHROME_PATH`;
   - the gate is the GitHub run. Never change lhci, the CI or the project to silence a local failure.
9. Checks in a real browser go through Playwright with `channel: 'chrome'`, not Claude in Chrome, which hides the tab and stops animations.
10. Never add `CLAUDE.md`, `AGENTS.md` or `.claude/` to a site's repo. If the person asks for one, say this rule in one line and ask; what the next session must know goes to memory. A temporary `.claude/launch.json` is deleted when you finish.

## When you get here

- **Writing the Dockerfile, the nginx conf or the Dokploy app:** Read `references/deploy.md` now, and again every time you get here.
- **Touching the CSP, an inline script or a figure's style:** Read `references/csp.md` now, and again every time you get here.
- **Writing an island, a worker or MDX prose:** Read `references/islands.md` now, and again every time you get here.
- **Before a push, or when running Prettier, `astro check`, Playwright or Lighthouse:** Read `references/verify.md` now, and again every time you get here.

## Red flags

| Thought | Rule that stops it |
| --- | --- |
| "checks are green, push now" | Prettier is a separate gate: `pnpm format && pnpm format:check` first (rule 6). |
| "a CLAUDE.md would help the next session" | Rule 10: no `CLAUDE.md`, `AGENTS.md` or `.claude/` in the repo; say the rule, ask, or use memory. |
| "a `spawnWorker(url)` helper is cleaner" | Rule 4: the literal stays at every call site, or the worker ships embedded and the CSP blocks it. |
| "I'll point TEMP elsewhere and run lhci" | Rule 8: do not bend lhci or the project around the EPERM; use `npx lighthouse`. |

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Playwright webServer without `env` or `--ignore-lock`, or a port from a custom variable | Rule 7: `PORT` with 4321 as default, `CLAUDECODE: ''`, `--ignore-lock`, `reuseExistingServer: false`. |
| `reuseExistingServer: !isCI` | A running server may be another project's: always `false`. |
| Running `lhci assert` or a TEMP workaround on Windows | `npx lighthouse` against a separate headless Chrome (verify reference). |
| Lighthouse against a server that lhci starts | Start `astro preview` yourself on a free port with `CLAUDECODE=` blank, and point `npx lighthouse` at it. |
| Comparing with CI through an ad-hoc Docker run | Use the Playwright container with `CHROME_PATH`. |
| Trusting a local Lighthouse pass | A local pass is not the gate; the GitHub run is. The local Chrome also follows the system's dark theme. |
| Theme script as an external file in `public/` | An `is:inline` script with its `sha256-` hash in `security.csp`. |
| Figure animation on by default, switched off under `reduce` | Animate only under `prefers-reduced-motion: no-preference`. |
| Checking `dist` for workers by hand | A guard in `postbuild` that fails if the build embeds a worker. |
| Dockerfile left in `apps/web` | Dockerfile at the root, Dockerfile path `Dockerfile`, `Docker Context Path` `.`. |
| Monorepo Dockerfile that skips a package's `package.json` | One `COPY` per package, including a new one. |
| nginx with only `Cache-Control`, no `absolute_redirect off`, no `frame-ancestors` | Security headers in every `location` (or an `include`), `absolute_redirect off`, `frame-ancestors 'none'` from nginx. |
| `min-height` on the container only | Reserve the island's height and keep a stable SSR placeholder. |
| Client-only state painted during hydration | The `mounted` pattern: Preact does not fix attributes when hydrating. |
| `Term` rewritten as `<dfn>` to dodge Prettier | Keep the component and the test that no line starts with `<Term`. |
| Playwright with the default Chromium for a visual check | `channel: 'chrome'`. |
| Visual check through Claude in Chrome | It hides the tab: `requestAnimationFrame` stops and smooth scroll never ends. Use Playwright. |
