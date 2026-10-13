import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocal, writeLocal, updateLocal, localFile, readPermissions, setPermission, permissionsFile, gitCommonDir } from '../src/forge/local.js';
import { forgeDir } from '../src/forge/ledger.js';
import { surfaceHash } from '../src/forge/surfaces.js';
import { run, type Io } from '../src/forge/cli/run.js';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-local-')); });
const gitIn = (dir: string) => (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const initRepo = (dir: string) => { const git = gitIn(dir); git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false'); return git; };

describe('local.yaml under the git common dir', () => {
  beforeEach(() => { initRepo(root); });
  it('lives in <common>/forge/local.yaml', () => {
    expect(localFile(root)).toBe(path.join(gitCommonDir(root)!, 'forge', 'local.yaml'));
    expect(path.resolve(gitCommonDir(root)!)).toBe(path.resolve(root, '.git'));
  });
  it('a missing, empty or corrupt file reads as empty', () => {
    const empty = { known: [], proposed: [] };
    expect(readLocal(root)).toEqual(empty);
    mkdirSync(path.dirname(localFile(root)!), { recursive: true });
    writeFileSync(localFile(root)!, '');
    expect(readLocal(root)).toEqual(empty);
    writeFileSync(localFile(root)!, ': : [oops');
    expect(readLocal(root)).toEqual(empty);
    writeFileSync(localFile(root)!, '- a list\n');
    expect(readLocal(root)).toEqual(empty);
  });
  it('drops bad names and values, keeps unknown keys', () => {
    mkdirSync(path.dirname(localFile(root)!), { recursive: true });
    writeFileSync(localFile(root)!, 'known: [unit, unit, "x y", 3]\nproposed: [android]\nmine: 1\n');
    expect(readLocal(root)).toEqual({ known: ['unit'], proposed: ['android'], mine: 1 });
  });
  it('keeps a valid workflow and autonomy and ignores an invalid one', () => {
    mkdirSync(path.dirname(localFile(root)!), { recursive: true });
    writeFileSync(localFile(root)!, 'workflow: forge\nautonomy: auto\n');
    expect(readLocal(root)).toMatchObject({ workflow: 'forge', autonomy: 'auto' });
    writeFileSync(localFile(root)!, 'workflow: maybe\nautonomy: 3\n');
    const s = readLocal(root);
    expect(s).not.toHaveProperty('workflow');
    expect(s).not.toHaveProperty('autonomy');
  });
  it('writes atomically and round-trips, keeping unknown keys', () => {
    updateLocal(root, s => ({ ...s, known: ['unit'] }));
    const before = readFileSync(localFile(root)!, 'utf8');
    writeFileSync(localFile(root)!, `${before}mine: keep\n`);
    const next = updateLocal(root, s => ({ ...s, proposed: ['web'] }));
    expect(next).toEqual({ known: ['unit'], proposed: ['web'], mine: 'keep' });
    expect(readLocal(root)).toEqual(next);
  });
  it('the working tree\'s .forge/local.yaml (forge ≤ 0.12, or one a commit ships under any name) is never read nor written', () => {
    const git = gitIn(root);
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '# Web\n');
    const shipped = `workflow: off\nautonomy: auto\nknown: [unit]\nsurfaces:\n  web: { state: allowed, hash: ${surfaceHash('# Web\n')} }\n`;
    for (const rel of ['.forge/local.yaml', 'FORGE~1/local.yaml']) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), shipped);
      git('add', '-f', rel);
    }
    git('commit', '-qm', 'ships local.yaml');
    expect(readLocal(root)).toEqual({ known: [], proposed: [] });
    expect(readPermissions(root)).toEqual({});
    const io: Io = { cwd: root, now: () => new Date(), git: () => null };
    expect(JSON.parse(run(['prefs'], io).stdout)).toEqual({ workflow: 'ask', autonomy: 'ask', sources: { workflow: 'default', autonomy: 'default' } });
    expect(JSON.parse(run(['verify-plan', '--task', 't', '--path', 'medium', '--base', 'x'], io).stdout).surfaces[0].permission).toBe('ask');
    expect(JSON.parse(run(['local', 'get'], io).stdout)).toEqual({ known: [], proposed: [], surfaces: {} });
    // Untracking it (git rm --cached) changes nothing either.
    git('rm', '-q', '--cached', '.forge/local.yaml', 'FORGE~1/local.yaml');
    expect(JSON.parse(run(['verify-plan', '--task', 't', '--path', 'medium', '--base', 'x'], io).stdout).surfaces[0].permission).toBe('ask');
    expect(readLocal(root)).toEqual({ known: [], proposed: [] });
    // Writes go to the common dir and leave the working tree's file as it was.
    expect(run(['local', 'set', 'workflow', 'forge'], io).code).toBe(0);
    expect(readLocal(root).workflow).toBe('forge');
    expect(readFileSync(path.join(root, '.forge', 'local.yaml'), 'utf8')).toBe(shipped);
  });
});

describe('surface permissions under the git common dir', () => {
  it('are read and written in <common>/forge/surfaces.json, never in the working tree', () => {
    initRepo(root);
    const sha = 'a'.repeat(40);
    expect(setPermission(root, 'web', { state: 'allowed', hash: 'f'.repeat(64), blob: sha })).toBe(true);
    expect(permissionsFile(root)).toBe(path.join(gitCommonDir(root)!, 'forge', 'surfaces.json'));
    expect(readPermissions(root)).toEqual({ web: { state: 'allowed', hash: 'f'.repeat(64), blob: sha } });
    expect(existsSync(path.join(root, '.forge', 'surfaces.json'))).toBe(false);
    expect(setPermission(root, 'web', null)).toBe(true);
    expect(readPermissions(root)).toEqual({});
  });
  it('keep the blob and the commit only when they are object ids, and drop bad names and states', () => {
    initRepo(root);
    mkdirSync(path.dirname(permissionsFile(root)!), { recursive: true });
    writeFileSync(permissionsFile(root)!, JSON.stringify({
      web: { state: 'allowed', hash: 'abc', blob: 'a'.repeat(40), commit: 'b'.repeat(64) },
      app: { state: 'allowed', hash: 'abc', blob: '--output=x', commit: 'HEAD' },
      cli: { state: 'denied' }, api: 'allowed', bad: { state: 'maybe' }, 'bad name': { state: 'denied' },
    }));
    expect(readPermissions(root)).toEqual({
      web: { state: 'allowed', hash: 'abc', blob: 'a'.repeat(40), commit: 'b'.repeat(64) },
      app: { state: 'allowed', hash: 'abc' },
      cli: { state: 'denied', hash: null },
    });
    writeFileSync(permissionsFile(root)!, 'garbage');
    expect(readPermissions(root)).toEqual({});
  });
  it('an allowance forge ≤ 0.12 kept in .forge/local.yaml is not carried over: the surface asks again', () => {
    initRepo(root);
    const text = '# Web\n\nRun it.\n';
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), text);
    writeFileSync(path.join(root, '.forge', 'local.yaml'), `surfaces:\n  web: { state: allowed, hash: ${surfaceHash(text).slice(0, 16)} }\n`);
    const vp = () => JSON.parse(run(['verify-plan', '--task', 't', '--path', 'medium', '--base', 'x'], { cwd: root, now: () => new Date(), git: () => null }).stdout);
    expect(vp().surfaces).toEqual([{ name: 'web', permission: 'ask', match: null, missing: [], unknown: [], hash: surfaceHash(text), ask: { question: 'Verify web (Web)?', options: ['Yes, always', 'Not this time', 'Never in this project'] } }]);
    expect(existsSync(permissionsFile(root)!)).toBe(false);
  });
});

describe('outside a git repository', () => {
  it('there is no personal state: nothing is read, kept, allowed or excused', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '# Web\n');
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'autonomy: auto\n');
    writeFileSync(path.join(root, '.forge', 'local.yaml'), `workflow: off\nsurfaces:\n  web: { state: allowed, hash: ${surfaceHash('# Web\n')} }\n`);
    expect(localFile(root)).toBeNull();
    expect(readLocal(root)).toEqual({ known: [], proposed: [] });
    expect(readPermissions(root)).toEqual({});
    expect(writeLocal(root, { known: ['unit'], proposed: [] })).toBe(false);
    expect(setPermission(root, 'web', { state: 'denied', hash: null })).toBe(false);
    const io: Io = { cwd: root, now: () => new Date(), git: () => null };
    for (const args of [['local', 'set', 'surfaces.web', 'allowed'], ['local', 'set', 'surfaces.web', 'denied'], ['local', 'set', 'workflow', 'forge'], ['local', 'set', 'autonomy', 'none']]) {
      const r = run(args, io);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/git repository/);
    }
    expect(JSON.parse(run(['verify-plan', '--task', 't', '--path', 'medium', '--base', 'x'], io).stdout).surfaces[0].permission).toBe('ask');
    expect(JSON.parse(run(['prefs'], io).stdout)).toEqual({ workflow: 'ask', autonomy: 'auto', sources: { workflow: 'default', autonomy: 'config' } });
  });
});

describe('a linked worktree', () => {
  it('shares local.yaml and the permissions of the main checkout, all under its common dir', () => {
    const main = path.join(root, 'main');
    mkdirSync(main);
    const git = initRepo(main);
    writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'init');
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', wt, '-b', 'track');
    updateLocal(wt, s => ({ ...s, known: ['unit'] }));
    expect(readLocal(main).known).toEqual(['unit']);
    writeLocal(main, { known: ['lint'], proposed: [] });
    expect(readLocal(wt).known).toEqual(['lint']);
    expect(path.resolve(localFile(wt)!)).toBe(path.resolve(main, '.git', 'forge', 'local.yaml'));
    for (const dir of [main, wt]) expect(existsSync(path.join(dir, '.forge'))).toBe(false);
    expect(setPermission(wt, 'web', { state: 'denied', hash: null })).toBe(true);
    expect(readPermissions(main)).toEqual({ web: { state: 'denied', hash: null } });
    expect(path.resolve(permissionsFile(wt)!)).toBe(path.resolve(main, '.git', 'forge', 'surfaces.json'));
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
});
