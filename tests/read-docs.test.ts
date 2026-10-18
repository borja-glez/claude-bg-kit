import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocs } from '../src/lib/read-docs.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

describe('readDocs (A-06, I-14)', () => {
  it('reads each JSON document by id and skips, by file name, one that does not parse or that the normalizer rejects', () => {
    const dir = tmp('read-docs-');
    writeFileSync(path.join(dir, 'T001.json'), '{"status":"done"}');
    writeFileSync(path.join(dir, 'T002.json'), '{oops');
    writeFileSync(path.join(dir, 'T003.json'), '[1, 2]');
    writeFileSync(path.join(dir, 'T004.json'), 'null');
    writeFileSync(path.join(dir, 'notes.txt'), 'not a document');
    mkdirSync(path.join(dir, 'T005.json'));
    expect(readDocs(dir, x => (isObj(x) ? x : null))).toEqual({ docs: { T001: { status: 'done' } }, skipped: ['T002.json', 'T003.json', 'T004.json', 'T005.json'] });
    // Without a normalizer only what does not parse, and null, is skipped.
    expect(readDocs(dir)).toEqual({ docs: { T001: { status: 'done' }, T003: [1, 2] }, skipped: ['T002.json', 'T004.json', 'T005.json'] });
  });
  it('a directory that does not exist, or a file in its place, reads as empty: the caller decides whether that is an error', () => {
    const dir = tmp('read-docs-');
    expect(readDocs(path.join(dir, 'missing'))).toEqual({ docs: {}, skipped: [] });
    writeFileSync(path.join(dir, 'file'), 'x');
    expect(readDocs(path.join(dir, 'file'))).toEqual({ docs: {}, skipped: [] });
  });
  it('a document named __proto__ is skipped, never set on the result', () => {
    const dir = tmp('read-docs-');
    writeFileSync(path.join(dir, '__proto__.json'), '{"polluted":true}');
    const r = readDocs<Record<string, unknown>>(dir);
    expect(r.skipped).toEqual(['__proto__.json']);
    expect(Object.keys(r.docs)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('only src/lib/read-docs.ts defines readDocs: waypoint and swarm read through it, with the same entries and result', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      const p = path.join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const defs = walk(src).filter(f => /\.tsx?$/.test(f) && /function readDocs\b/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(src, f).split(path.sep).join('/'));
    expect(defs).toEqual(['lib/read-docs.ts']);
  });
});
