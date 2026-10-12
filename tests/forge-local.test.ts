import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocal, writeLocal, updateLocal, localFile } from '../src/forge/local.js';
import { forgeDir } from '../src/forge/ledger.js';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-local-')); });

describe('local.yaml', () => {
  it('a missing, empty or corrupt file reads as empty', () => {
    const empty = { surfaces: {}, known: [], proposed: [] };
    expect(readLocal(root)).toEqual(empty);
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(localFile(root), '');
    expect(readLocal(root)).toEqual(empty);
    writeFileSync(localFile(root), ': : [oops');
    expect(readLocal(root)).toEqual(empty);
    writeFileSync(localFile(root), '- a list\n');
    expect(readLocal(root)).toEqual(empty);
  });
  it('drops bad names and values, keeps unknown keys', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(localFile(root), 'surfaces:\n  web: { state: allowed, hash: abc }\n  app: { state: maybe }\n  api: allowed\n  cli: { state: denied }\n  "bad name": { state: denied }\nknown: [unit, unit, "x y", 3]\nproposed: [android]\nmine: 1\n');
    expect(readLocal(root)).toEqual({ surfaces: { web: { state: 'allowed', hash: 'abc' }, cli: { state: 'denied', hash: null } }, known: ['unit'], proposed: ['android'], mine: 1 });
  });
  it('writes atomically and round-trips, keeping unknown keys', () => {
    updateLocal(root, s => ({ ...s, known: ['unit'] }));
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    const before = readFileSync(localFile(root), 'utf8');
    writeFileSync(localFile(root), `${before}mine: keep\n`);
    const next = updateLocal(root, s => ({ ...s, surfaces: { ...s.surfaces, web: { state: 'denied', hash: null } } }));
    expect(next).toEqual({ surfaces: { web: { state: 'denied', hash: null } }, known: ['unit'], proposed: [], mine: 'keep' });
    expect(readLocal(root)).toEqual(next);
  });
});

describe('.forge/.gitignore', () => {
  const NEW = '*\n!.gitignore\n!config.yaml\n!verify/\n!verify/*.md\n';
  it('a new .forge lets verify/*.md through', () => {
    forgeDir(root);
    expect(readFileSync(path.join(root, '.forge', '.gitignore'), 'utf8')).toBe(NEW);
  });
  it('upgrades the 0.5.x content, leaves an edited file alone', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', '.gitignore'), '*\n!.gitignore\n!config.yaml\n');
    forgeDir(root);
    expect(readFileSync(path.join(root, '.forge', '.gitignore'), 'utf8')).toBe(NEW);
    writeFileSync(path.join(root, '.forge', '.gitignore'), '*\n!.gitignore\n');
    forgeDir(root);
    expect(readFileSync(path.join(root, '.forge', '.gitignore'), 'utf8')).toBe('*\n!.gitignore\n');
  });
  it('writeLocal creates .forge with the new .gitignore', () => {
    writeLocal(root, { surfaces: {}, known: [], proposed: [] });
    expect(readFileSync(path.join(root, '.forge', '.gitignore'), 'utf8')).toBe(NEW);
  });
});
