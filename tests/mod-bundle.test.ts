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
});
