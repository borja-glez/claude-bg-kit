# Verify: gates, Playwright, Lighthouse and real Chrome

## Gates

The CI runs, in this order: `format:check`, `lint`, `check`, `test`, `build`, `docker build`, Lighthouse, `e2e`. Before every push run the first four together, in one command:

```bash
pnpm format && pnpm format:check && pnpm lint && pnpm check && pnpm test
```

Prettier covers everything: `.astro`, `.mdx` and `.json` too. A green `pnpm check` and green tests say nothing about it. `astro check` requires the TypeScript range in the `peerDependencies` of `@astrojs/check` (TypeScript 6.x as of 2026-10, not 7): read that field, keep `typescript` inside it and do not merge a major bump that leaves it.

## Playwright under Claude Code

`astro preview` detects the agent environment and goes to the background, so the webServer would never be seen as up. Blank the variables, pass `--ignore-lock`, take the port from `PORT` (4321 is often taken) and never reuse a server you did not start:

```ts
const PORT = Number(process.env.PORT ?? 4321);

export default defineConfig({
  webServer: {
    command: `pnpm preview --host 127.0.0.1 --port ${PORT} --ignore-lock`,
    url: `http://127.0.0.1:${PORT}`,
    env: { CLAUDECODE: '', CURSOR_TRACE_ID: '' },
    reuseExistingServer: false,
  },
});
```

With `reuseExistingServer: false`, a busy port fails the run instead of testing a stranger's server. In a shell, with a free port:

```bash
CLAUDECODE= pnpm preview --host 127.0.0.1 --port <free port>
```

## Lighthouse

CI: `lhci autorun`, with `numberOfRuns: 3` (a single run flips around the 0.95 edge on GitHub's runner) and one assertion per category, `categories:performance`, `categories:accessibility`, `categories:best-practices` and `categories:seo`, each with `minScore: 0.95`. The assertions carry no `assert.preset`; the config collects with `collect.settings.preset`, and a local run uses whatever that key says as `--preset`, with no `--preset` when the config has none.

On Windows `lhci` ends with `EPERM` while deleting `...\Temp\lighthouse.*` (the Chrome profile, removed by chrome-launcher). Do not alter lhci, the CI or the project: run Lighthouse by hand.

1. Start the preview on a free port (see above), in the background.
2. Launch Chrome on its own, in the background, and note its PID:
   `<path to chrome.exe> --headless=new --enable-gpu --use-angle=d3d11 --remote-debugging-port=<free port> --user-data-dir=<temp dir>`
   (`--enable-gpu --use-angle=d3d11` is for Windows. use a port nothing listens on, the same one in step 3.)
   (`chrome` is not on PATH on Windows; chrome.exe usually sits under `C:\Program Files\Google\Chrome\Application\`.)
3. Run `npx lighthouse <url> --port=<free port> [--preset=<config's preset>] --output=json --output-path=<file>`.
4. Stop Chrome and the preview by those PIDs, never by process name.

Shorter alternative, which writes the report even though it prints the EPERM:

```bash
npx lighthouse <url> [--preset=<config's preset>] --chrome-flags=--headless=new --output=json --output-path=<file>
```

Read the report, not the exit message.

To reproduce CI numbers, run in the Playwright container (use the version of `@playwright/test`), mounting the repo at `/work`:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v<version>-noble \
  bash -c 'export CHROME_PATH=$(ls /ms-playwright/chromium-*/chrome-linux64/chrome) && npx lhci autorun'
```

`MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the volume path. Remember the local Chrome follows the system's dark theme, which CI's does not, so scores differ for that alone.

The gate is the GitHub run: `gh run watch`. A local pass is not the gate, and a local failure is not fixed by changing the project.

## Real Chrome

Use Playwright with `channel: 'chrome'` for checks that need a real browser. Do not use Claude in Chrome for animations or scrolling: during its actions it leaves the tab hidden, `requestAnimationFrame` stops, and a `scrollIntoView` with smooth scrolling never finishes. To probe positions, jump with `scrollTo({ behavior: 'instant' })`.
