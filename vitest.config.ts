import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// G-13: the waypoint version, as build.mjs defines it for the bundles.
const waypoint = JSON.parse(readFileSync('plugins/waypoint/.claude-plugin/plugin.json', 'utf8')) as { version: string };

// I-16: the test files that take long run in the project `slow`. `npm test` runs both projects; `npm run test:unit`
// only `unit`, for a quick loop. The list: forge-swarm-integrate, the files over 5 s in vitest's duration report
// when plan 5a started, slowest first, and those 5a added that take longer (forge-trust, about 20 s); since 5d, the
// files that start real processes (forge-verify-proc) and those that build git histories for verify (forge-verify-flow).
export const SLOW = [
  'tests/forge-swarm-integrate.test.ts',
  'tests/forge-execution-lock.test.ts',
  'tests/forge-swarm-step.test.ts',
  'tests/forge-exec-cli.test.ts',
  'tests/forge-review-cli.test.ts',
  'tests/forge-cleanup.test.ts',
  'tests/forge-cli.test.ts',
  'tests/app.test.ts',
  'tests/cli.test.ts',
  'tests/band-fit.test.ts',
  'tests/forge-verify-plan.test.ts',
  'tests/forge-live.test.ts',
  'tests/forge-roadmap-doc.test.ts',
  'tests/roadmap-contract.test.ts',
  'tests/forge-validate-cache.test.ts',
  'tests/forge-route-hooks.test.ts',
  'tests/forge-roadmap-run.test.ts',
  'tests/forge-route.test.ts',
  'tests/forge-validate-restore.test.ts',
  'tests/forge-ledger.test.ts',
  'tests/forge-set-aside.test.ts',
  'tests/forge-surfaces.test.ts',
  'tests/forge-local.test.ts',
  'tests/forge-jobs.test.ts',
  'tests/forge-trust.test.ts',
  'tests/forge-verify-proc.test.ts',
  'tests/forge-verify-env.test.ts',
  'tests/forge-verify-flow.test.ts',
];

// I-17: vitest 5 fails a synchronous test that outran its timeout (vitest 2 let it pass), and the slow suites take 5–20 s under load.
export default defineConfig({
  define: { __WAYPOINT_VERSION__: JSON.stringify(waypoint.version) },
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // I-01: one temp root per run; TEMP, TMP and TMPDIR point at it while the workers run, and it is removed at the end.
    globalSetup: ['tests/setup/temp-root.ts'],
    // I-03: every command of a test's .forge/config.yaml counts as trusted (tests/forge-trust.test.ts turns it off).
    setupFiles: ['tests/setup/trust-commands.ts'],
    // Each project names its own files and the root names none: arrays a project inherits are concatenated.
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: ['**/node_modules/**', ...SLOW] } },
      { extends: true, test: { name: 'slow', include: [...SLOW] } },
    ],
  },
});
