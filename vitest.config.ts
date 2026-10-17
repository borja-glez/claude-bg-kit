import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// G-13: the waypoint version, as build.mjs defines it for the bundles.
const waypoint = JSON.parse(readFileSync('plugins/waypoint/.claude-plugin/plugin.json', 'utf8')) as { version: string };

export default defineConfig({ define: { __WAYPOINT_VERSION__: JSON.stringify(waypoint.version) }, test: { include: ['tests/**/*.test.ts'] } });
