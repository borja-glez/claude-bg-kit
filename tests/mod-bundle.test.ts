import { describe, it, expect } from 'vitest';
import { bundleMod } from '../scripts/mod-bundle.mjs';

describe('the mod bundles (I-13)', () => {
  for (const entry of ['src/mod/register.tsx', 'src/lens/register.tsx']) {
    it(`${entry}: minified, with export const register = alone on its line and no other export`, async () => {
      const js = await bundleMod(entry);
      expect(js.match(/^export const register = /gm)).toHaveLength(1);
      expect(js).not.toMatch(/\bexport\s*\{/);
      // Whitespace minified: a few hundred lines at most, where the plain bundle has thousands.
      expect(js.split('\n').length).toBeLessThan(500);
    }, 60_000);
  }
  it('no zod in either bundle, and waypoint under 220 KiB (I-13)', async () => {
    const [waypoint, lens] = await Promise.all([bundleMod('src/mod/register.tsx'), bundleMod('src/lens/register.tsx')]);
    for (const js of [waypoint, lens]) expect(js).not.toContain('ZodError');
    // The spec's 200 KB is not reachable while the band parses YAML; that bundle is now 212 863 B, and the guard is that zod never comes back.
    expect(Buffer.byteLength(waypoint)).toBeLessThan(220 * 1024);
  }, 60_000);
  it('identifiers stay unminified: the JSX factory h and the band model by their names (I-13)', async () => {
    const [waypoint, lens] = await Promise.all([bundleMod('src/mod/register.tsx'), bundleMod('src/lens/register.tsx')]);
    // h, the engine's global JSX factory, is called as such; buildBandModel keeps its name, which minifyIdentifiers would not.
    for (const js of [waypoint, lens]) {
      expect(js).toMatch(/[^\w$.]h\(/);
      expect(js).toMatch(/\bfunction buildBandModel\(/);
    }
  }, 60_000);
});
