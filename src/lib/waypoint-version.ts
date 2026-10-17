// G-13: the waypoint version this code was built as. build.mjs defines __WAYPOINT_VERSION__ (from
// plugins/waypoint/.claude-plugin/plugin.json) in waypoint's CLI, forge's CLI and the roadmap page; vitest.config.ts
// does the same. Read with typeof, so a bundle built without it gets 0.0.0 and never throws.
declare const __WAYPOINT_VERSION__: string | undefined;
export const WAYPOINT_VERSION: string = typeof __WAYPOINT_VERSION__ === 'string' ? __WAYPOINT_VERSION__ : '0.0.0';

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})/;
const partsOf = (v: unknown): number[] => {
  const m = typeof v === 'string' ? VERSION.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
};

/** -1, 0 or 1, comparing x.y.z versions numerically; anything that is not one counts as 0.0.0. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 {
  const x = partsOf(a), y = partsOf(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
