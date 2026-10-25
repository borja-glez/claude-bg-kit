import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const waypoint = JSON.parse(readFileSync('plugins/waypoint/.claude-plugin/plugin.json', 'utf8')) as { version: string };

// A8: the e2e scenarios start real sessions of claude, so they live in their own config: `npm test` and `npm run ci`
// do not run them, only `npm run test:e2e` does. Without a claude on PATH (or BGKIT_E2E_CLAUDE) they are skipped.
export default defineConfig({
  // The scenarios import forge sources, which read the waypoint version at build time.
  define: { __WAYPOINT_VERSION__: JSON.stringify(waypoint.version) },
  test: {
    name: 'e2e',
    include: ['tests/e2e/**/*.e2e.ts'],
    globalSetup: ['tests/setup/temp-root.ts', 'tests/e2e/harness/announce.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
