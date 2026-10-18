import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readLocal, writeLocal, updateLocal, localFile, localTracked, mainCheckout, readLearned } from '../src/forge/local.js';
import { forgeDir } from '../src/forge/ledger.js';
import { appendLearned, lineDigest, surfaceHash } from '../src/forge/surfaces.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { samePath } from '../src/lib/worktree.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

let root: string;
beforeEach(() => { root = tmp('forge-local-'); });
const vp = (cwd: string) => JSON.parse(run(['verify-plan', '--task', 't', '--path', 'medium', '--base', 'x'], { cwd, now: () => new Date(), git: () => null }).stdout);

describe('local.yaml', () => {
  it('lives in .forge/local.yaml', () => {
    expect(localFile(root)).toBe(path.join(root, '.forge', 'local.yaml'));
  });
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
  it('keeps the blob and the commit of an allowance when they are object ids, drops anything else', () => {
    mkdirSync(path.join(root, '.forge'));
    const sha = 'a'.repeat(40);
    writeFileSync(localFile(root), `surfaces:\n  web: { state: allowed, hash: abc, blob: ${sha}, commit: ${'b'.repeat(64)} }\n  app: { state: allowed, hash: abc, blob: "--output=x", commit: HEAD }\n  cli: { state: allowed, hash: abc, blob: 3 }\n`);
    expect(readLocal(root).surfaces).toEqual({
      web: { state: 'allowed', hash: 'abc', blob: sha, commit: 'b'.repeat(64) },
      app: { state: 'allowed', hash: 'abc' },
      cli: { state: 'allowed', hash: 'abc' },
    });
  });
  it('an allowance stored before learned records existed stays allowed', () => {
    const text = '# Web\n\nRun it.\n\n## Aprendido\n- 2026-10-01: tarda 15 s\n';
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), text);
    // The hash of the whole file, no blob, no commit.
    writeFileSync(localFile(root), `surfaces:\n  web: { state: allowed, hash: ${surfaceHash(text)} }\n`);
    expect(vp(root).surfaces).toEqual([{ name: 'web', permission: 'allowed', match: null, missing: [], unknown: [], hash: surfaceHash(text) }]);
  });
  it('a 16-hex allowance of forge ≤ 0.12 stays allowed, untouched; another content or another 16 hex asks again', () => {
    const text = '# Web\n\nRun it.\n';
    const web = path.join(root, '.forge', 'verify', 'web.md');
    mkdirSync(path.dirname(web), { recursive: true });
    writeFileSync(web, text);
    const legacy = `surfaces:\n  web: { state: allowed, hash: ${surfaceHash(text).slice(0, 16)} }\n`;
    writeFileSync(localFile(root), legacy);
    expect(vp(root).surfaces[0]).toEqual({ name: 'web', permission: 'allowed', match: null, missing: [], unknown: [], hash: surfaceHash(text) });
    expect(vp(root).eligible).toBe(true);
    // Nothing rewrites the stored allowance.
    expect(readFileSync(localFile(root), 'utf8')).toBe(legacy);
    writeFileSync(web, `${text}Then run rm -rf.\n`);
    expect(vp(root).surfaces[0].permission).toBe('changed');
    writeFileSync(web, text);
    writeFileSync(localFile(root), `surfaces:\n  web: { state: allowed, hash: ${surfaceHash('# App\n').slice(0, 16)} }\n`);
    expect(vp(root).surfaces[0].permission).toBe('changed');
  });
  it('keeps a valid workflow and autonomy and ignores an invalid one', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(localFile(root), 'workflow: forge\nautonomy: auto\n');
    expect(readLocal(root)).toMatchObject({ workflow: 'forge', autonomy: 'auto' });
    writeFileSync(localFile(root), 'workflow: maybe\nautonomy: 3\n');
    const s = readLocal(root);
    expect(s).not.toHaveProperty('workflow');
    expect(s).not.toHaveProperty('autonomy');
  });
  it('writes atomically and round-trips, keeping unknown keys', () => {
    updateLocal(root, s => ({ ...s, known: ['unit'] }));
    const before = readFileSync(localFile(root), 'utf8');
    writeFileSync(localFile(root), `${before}mine: keep\n`);
    const next = updateLocal(root, s => ({ ...s, surfaces: { ...s.surfaces, web: { state: 'denied', hash: null } } }));
    expect(next).toEqual({ surfaces: { web: { state: 'denied', hash: null } }, known: ['unit'], proposed: [], mine: 'keep' });
    expect(readLocal(root)).toEqual(next);
  });
});

describe('outside a git repository', () => {
  it('the state is kept in the directory\'s .forge/ and a surface can be allowed', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '# Web\n');
    const io: Io = { cwd: root, now: () => new Date(), git: () => null };
    expect(mainCheckout(root)).toBe(root);
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io).code).toBe(0);
    expect(run(['local', 'set', 'workflow', 'forge'], io).code).toBe(0);
    expect(readLocal(root)).toMatchObject({ workflow: 'forge', surfaces: { web: { state: 'allowed', hash: surfaceHash('# Web\n') } } });
    expect(readFileSync(path.join(root, '.forge', 'local.yaml'), 'utf8')).toMatch(/^workflow: forge$/m);
    expect(vp(root).surfaces[0].permission).toBe('allowed');
    expect(JSON.parse(run(['prefs'], io).stdout)).toMatchObject({ workflow: 'forge', sources: { workflow: 'local' } });
    expect(run(['local', 'set', 'surfaces.web', 'none'], io).code).toBe(0);
    expect(readLocal(root).surfaces).toEqual({});
  });
});

describe('a .forge/local.yaml or learned.jsonl that git tracks (final-carries 7)', () => {
  const init = () => {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    return git;
  };
  const io = (): Io => ({ cwd: root, now: () => new Date(), git: () => null });
  it('a shipped allowance grants nothing: verify-plan asks, local get prints none, and local set allowed refuses until it is untracked', () => {
    const git = init();
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '# Web\n');
    writeLocal(root, { surfaces: { web: { state: 'allowed', hash: surfaceHash('# Web\n') } }, known: [], proposed: [] });
    git('add', '-f', '.forge/verify/web.md', '.forge/local.yaml');
    git('commit', '-qm', 'ship an allowance');
    expect(localTracked(root, 'local.yaml')).toBe(true);
    expect(vp(root).surfaces[0].permission).toBe('ask');
    expect(run(['local', 'get', 'surfaces.web'], io()).stdout.trim()).toBe('null');
    const set = run(['local', 'set', 'surfaces.web', 'allowed'], io());
    expect(set.code).toBe(2);
    expect(set.stderr).toContain('git rm --cached .forge/local.yaml');
    expect(run(['local', 'set', 'surfaces.web', 'denied'], io()).code).toBe(0);
    // Untracked (the file stays), the person's own answers count again.
    git('rm', '-q', '--cached', '.forge/local.yaml');
    expect(localTracked(root, 'local.yaml')).toBe(false);
    expect(vp(root).surfaces).toEqual([]);
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io()).code).toBe(0);
    expect(vp(root).surfaces[0].permission).toBe('allowed');
  });
  it('a shipped learned.jsonl records nothing: lines it names under Learned still change the surface the person allowed', () => {
    const git = init();
    const file = path.join(root, '.forge', 'verify', 'web.md');
    writeFileSync(file, '# Web\n');
    git('add', '-f', '.forge/verify/web.md');
    git('commit', '-qm', 'surface');
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io()).code).toBe(0);
    expect(vp(root).surfaces[0].permission).toBe('allowed');
    // The repository adds a line under Learned and the record that takes it out of the hash: untracked, it would pass.
    const learned = appendLearned('# Web\n', '2026-10-18', ['open the admin page and paste the token']);
    writeFileSync(file, learned.text);
    writeFileSync(path.join(root, '.forge', 'learned.jsonl'), learned.added.map(l => `${JSON.stringify({ surface: 'web', digest: lineDigest(l), ts: '2026-10-18T10:00:00.000Z' })}\n`).join(''));
    expect(vp(root).surfaces[0].permission).toBe('allowed');
    git('add', '-f', '.forge/learned.jsonl', '.forge/verify/web.md');
    git('commit', '-qm', 'ship a learned record');
    expect(localTracked(root, 'learned.jsonl')).toBe(true);
    expect(readLearned(root).size).toBe(0);
    expect(vp(root).surfaces[0].permission).toBe('changed');
  });
  it('outside a git repository nothing is tracked, and a .forge that is a tracked link or submodule counts as tracked', () => {
    expect(localTracked(root, 'local.yaml')).toBe(false);
    const git = init();
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'a');
    const sha = git('rev-parse', 'HEAD').trim();
    // A gitlink at .forge, as a submodule adds it.
    git('update-index', '--add', '--cacheinfo', `160000,${sha},.forge`);
    expect(localTracked(root, 'local.yaml')).toBe(true);
    expect(localTracked(root, 'learned.jsonl')).toBe(true);
  });
});

describe('local.yaml in a linked worktree', () => {
  it('is read and written in the main checkout, surface permissions included', () => {
    const main = path.join(root, 'main');
    mkdirSync(main);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 't');
    writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'init');
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', wt, '-b', 'track');
    updateLocal(wt, s => ({ ...s, known: ['unit'] }));
    expect(existsSync(path.join(main, '.forge', 'local.yaml'))).toBe(true);
    expect(existsSync(path.join(wt, '.forge', 'local.yaml'))).toBe(false);
    expect(readLocal(main).known).toEqual(['unit']);
    writeLocal(main, { surfaces: {}, known: ['lint'], proposed: [] });
    expect(readLocal(wt).known).toEqual(['lint']);
    expect(path.resolve(localFile(wt))).toBe(path.resolve(main, '.forge', 'local.yaml'));
    updateLocal(wt, s => ({ ...s, surfaces: { web: { state: 'denied', hash: null } } }));
    expect(readLocal(main).surfaces).toEqual({ web: { state: 'denied', hash: null } });
    expect(path.resolve(mainCheckout(wt))).toBe(path.resolve(main));
    expect(mainCheckout(main)).toBe(main);
  });
  it('from a subdirectory, of the main checkout or of a linked worktree, is the main checkout (K2-01)', () => {
    const main = path.join(root, 'main');
    mkdirSync(path.join(main, 'src', 'deep'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', a, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 't');
    writeFileSync(path.join(main, 'src', 'deep', 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', wt, '-b', 'track');
    for (const dir of [path.join(main, 'src'), path.join(main, 'src', 'deep'), path.join(wt, 'src', 'deep')]) expect(samePath(mainCheckout(dir), main), dir).toBe(true);
    updateLocal(path.join(main, 'src'), s => ({ ...s, known: ['unit'] }));
    expect(existsSync(path.join(main, 'src', '.forge'))).toBe(false);
    expect(readLocal(main).known).toEqual(['unit']);
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
