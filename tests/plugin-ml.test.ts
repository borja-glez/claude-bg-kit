import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './helpers/files.js';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ML = fileURLToPath(new URL('../plugins/ml/', import.meta.url));
/** Every file of plugins/ml, relative to it, with forward slashes. */
const mlFiles = () => walk(ML).map(f => path.relative(ML, f).split(path.sep).join('/'));

describe('plugin ml (w7 D3)', () => {
  it('the marketplace lists ml at ./plugins/ml with the description of its manifest', () => {
    const entry = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find((p: { name: string }) => p.name === 'ml');
    const manifest = JSON.parse(read('plugins/ml/.claude-plugin/plugin.json'));
    expect(entry).toMatchObject({ name: 'ml', source: './plugins/ml' });
    expect(manifest).toMatchObject({ name: 'ml', author: { name: 'Borja' } });
    expect(manifest.description).toBe(entry.description);
    expect(manifest.dependencies).toBeUndefined();
  });
  it('ml is text only: its manifest, two READMEs and Markdown skills; no src, dist, hooks, bin, scripts or agents', () => {
    const files = mlFiles();
    expect(files).toContain('.claude-plugin/plugin.json');
    expect(files.filter(f => !/^(\.claude-plugin\/plugin\.json|README(\.es)?\.md|skills\/[a-z0-9-]+\/(SKILL|references\/[a-z0-9-]+)\.md)$/.test(f))).toEqual([]);
  });
});
