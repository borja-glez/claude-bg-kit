import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './helpers/files.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = path.join(ROOT, 'plugins', 'web');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const manifest = () => JSON.parse(read('plugins/web/.claude-plugin/plugin.json'));
/** Personal paths, machine data and the names of the projects the skill was written from (spec, «Común a D1–D4»; A7). */
const PERSONAL = /[A-Za-z]:[\\/](?:Users|work)[\\/]|\/(?:Users|home)\/[^/\s]+|LOCALAPPDATA|borjaglez|rukh|chess-lm/i;
/** Zero-width, bidi and BOM characters (A7). Built from code points, as in tests/source-text.test.ts, which fails on any raw one under tests/. */
const cp = (n: number) => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${cp(0x200b)}-${cp(0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2060)}-${cp(0x2064)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}]`);

describe('plugin web (w7 D2)', () => {
  it('the manifest is web 0.1.0, and the marketplace lists it from plugins/web with the same description', () => {
    expect(manifest()).toEqual({ name: 'web', description: expect.stringMatching(/^Astro sites with Preact islands/), version: '0.1.0', author: { name: 'Borja' } });
    expect(JSON.parse(read('.claude-plugin/marketplace.json')).plugins).toContainEqual({ name: 'web', source: './plugins/web', description: manifest().description });
  });
  it('web is text only: a manifest, its READMEs and skills, without hooks, bundles, scripts, sources or agents', () => {
    const files = walk(WEB).map(f => path.relative(WEB, f).split(path.sep).join('/'));
    expect(files).toContain('.claude-plugin/plugin.json');
    for (const f of files) expect(f).toMatch(/^(\.claude-plugin\/plugin\.json|README(\.es)?\.md|skills\/[a-z-]+\/(SKILL\.md|references\/[a-z-]+\.md))$/);
  });
  it('no file of plugins/web carries a personal path, a project name, a CR or an invisible character', () => {
    for (const f of walk(WEB)) {
      const text = readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f);
      expect(text, rel).not.toMatch(PERSONAL);
      expect(text, rel).not.toMatch(INVISIBLE);
      expect(text.includes('\r'), rel).toBe(false);
    }
  });
});
