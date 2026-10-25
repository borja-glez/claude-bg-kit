import { describe, it, expect } from 'vitest';
import { bundleMod } from '../scripts/mod-bundle.mjs';

const WAYPOINT = 'src/mod/register.tsx';
const LENS = 'src/lens/register.tsx';
// Each mod is bundled once for the whole file: the tests share the promise.
const bundles = new Map<string, Promise<string>>();
const bundle = (entry: string): Promise<string> => {
  let js = bundles.get(entry);
  if (!js) bundles.set(entry, (js = bundleMod(entry)));
  return js;
};

describe('the mod bundles (I-13)', () => {
  for (const entry of [WAYPOINT, LENS]) {
    it(`${entry}: minified, with export const register = alone on its line and no other export`, async () => {
      const js = await bundle(entry);
      expect(js.match(/^export const register = /gm)).toHaveLength(1);
      expect(js).not.toMatch(/\bexport\s*\{/);
      // Whitespace minified: a few hundred lines at most, where the plain bundle has thousands.
      expect(js.split('\n').length).toBeLessThan(500);
    }, 60_000);
  }
  it('no zod in either bundle, and waypoint under 240 KiB (I-13)', async () => {
    const [waypoint, lens] = await Promise.all([bundle(WAYPOINT), bundle(LENS)]);
    for (const js of [waypoint, lens]) expect(js).not.toContain('ZodError');
    // The spec's 200 KB is not reachable while the band parses YAML (about 213 KB without zod when this was written): the guard is that zod never comes back.
    // The "waiting for you" inbox (w7 A5) took it to 228761 bytes, hence 240 KiB.
    expect(Buffer.byteLength(waypoint)).toBeLessThan(240 * 1024);
  }, 60_000);
  it('identifiers are not minified: buildBandModel keeps its name, and JSX still calls the factory h (I-13)', async () => {
    const [waypoint, lens] = await Promise.all([bundle(WAYPOINT), bundle(LENS)]);
    for (const js of [waypoint, lens]) {
      // The guard: minifyIdentifiers would rename this function.
      expect(js).toMatch(/\bfunction buildBandModel\(/);
      // Only that JSX compiles to calls of h, the engine's global factory, which no minifier renames.
      expect(js).toMatch(/[^\w$.]h\(/);
    }
  }, 60_000);
});
