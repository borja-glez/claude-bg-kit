import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// G-13: the waypoint version, as build.mjs defines it for the bundles.
const waypoint = JSON.parse(readFileSync('plugins/waypoint/.claude-plugin/plugin.json', 'utf8')) as { version: string };

// I-17: vitest 5 fails a synchronous test that outran its timeout (vitest 2 let it pass), and the slow suites take 5–20 s under load.
export default defineConfig({ define: { __WAYPOINT_VERSION__: JSON.stringify(waypoint.version) }, test: {
  include: ['tests/**/*.test.ts'],
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // I-01: one temp root per run; TEMP, TMP and TMPDIR point at it while the workers run, and it is removed at the end.
  globalSetup: ['tests/setup/temp-root.ts'],
} });
