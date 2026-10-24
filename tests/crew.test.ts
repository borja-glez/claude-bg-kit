import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './helpers/files.js';

// w7 D4: the crew plugin is text only: a manifest, its agents and its two READMEs.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CREW = path.join(ROOT, 'plugins', 'crew');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const files = () => walk(CREW).map(f => path.relative(CREW, f).split(path.sep).join('/'));

describe('crew plugin (w7 D4)', () => {
  it('a manifest with no dependencies, and a marketplace entry with its description', () => {
    const m = JSON.parse(read('plugins/crew/.claude-plugin/plugin.json'));
    expect(m).toMatchObject({ name: 'crew', author: { name: 'Borja' } });
    expect(typeof m.description).toBe('string');
    expect(m.dependencies).toBeUndefined();
    const entry = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find((p: { name: string }) => p.name === 'crew');
    expect(entry).toEqual({ name: 'crew', source: './plugins/crew', description: m.description });
  });
  it('holds only text: the manifest, agents/*.md and the two READMEs (no src, bundle, hooks, skills or scripts)', () => {
    expect(files().filter(f => !/^(\.claude-plugin\/plugin\.json|agents\/[a-z-]+\.md|README(\.es)?\.md)$/.test(f))).toEqual([]);
  });
  it('names no personal path and holds no invisible or bidi character', () => {
    for (const f of walk(CREW)) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/|E:[\\/]work|(?<![\w.])\/[a-z]\/work(?![\w-])/i);
      // The same invisible and bidi set as A7's plugin-hygiene test.
      expect(t, f).not.toMatch(/[­؜ᅟᅠ᠎​-‏‪-‮⁠-⁤⁦-⁩ㅤ﻿ﾠ]/);
    }
  });
});
