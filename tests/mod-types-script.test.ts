import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/forge/config.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const script = fileURLToPath(new URL('../scripts/mod-types.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(path.join(repo, p), 'utf8');
let box: string;
beforeEach(() => { box = tmp('mod-types-'); });
const types = (dir: string, version: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.d.ts'), `// Written by Claude Code ${version}.\nexport {};\n`);
};
const ours = (root: string, v: string) => types(path.join(root, 'types', 'claude-code'), v);
const engine = (root: string, v: string, plugin = 'waypoint') => types(path.join(root, 'plugins', plugin, '.claude-plugin', 'types', 'claude-code'), v);
const mod = (cwd: string, cmd: string) => spawnSync(process.execPath, [script, cmd], { cwd, encoding: 'utf8' });
const first = (root: string) => readFileSync(path.join(root, 'types', 'claude-code', 'index.d.ts'), 'utf8').split('\n')[0];

describe('mod-types check (I-04)', () => {
  it('without the copy exits 1 and says how to get it', () => {
    const r = mod(box, 'check');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('engine types missing: run `npm run mod-types:update` after opening a session with `claude --plugin-dir plugins/waypoint`');
  });
  it('with the copy exits 0, and warns when the engine wrote a newer one', () => {
    ours(box, '2.1.296');
    expect(mod(box, 'check')).toMatchObject({ status: 0, stderr: '' });
    engine(box, '2.1.300');
    const r = mod(box, 'check');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('is newer (2.1.300)');
    expect(r.stderr).toContain('npm run mod-types:update');
  });
});

describe('mod-types update (I-04)', () => {
  it('copies the newest copy the engine wrote, and never an older one over a newer copy', () => {
    engine(box, '2.1.296');
    engine(box, '2.1.301', 'lens');
    expect(mod(box, 'update').status).toBe(0);
    expect(first(box)).toBe('// Written by Claude Code 2.1.301.');
    ours(box, '2.2.0');
    expect(mod(box, 'update').status).toBe(0);
    expect(first(box)).toBe('// Written by Claude Code 2.2.0.');
  });
  it('without any copy exits 1 and writes nothing', () => {
    expect(mod(box, 'update').status).toBe(1);
    expect(existsSync(path.join(box, 'types'))).toBe(false);
  });
  it('in a linked worktree, takes the copy of the main checkout', () => {
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });
    git(box, 'init', '-q', '-b', 'main'); git(box, 'config', 'user.email', 'a@b.c'); git(box, 'config', 'user.name', 't');
    writeFileSync(path.join(box, '.gitignore'), '/types/\n.claude/\n');
    git(box, 'add', '.'); git(box, 'commit', '-qm', 'init');
    ours(box, '2.1.296');
    const wt = path.join(box, '.claude', 'worktrees', 'plan');
    git(box, 'worktree', 'add', '-q', wt, '-b', 'plan');
    expect(mod(wt, 'check').status).toBe(1);
    expect(mod(wt, 'update').status).toBe(0);
    expect(first(wt)).toBe('// Written by Claude Code 2.1.296.');
    expect(mod(wt, 'check').status).toBe(0);
  });
  it('an unknown command exits 2', () => {
    expect(mod(box, 'nope').status).toBe(2);
  });
});

describe('the repo compiles its mods against types/claude-code (I-04)', () => {
  it('tsconfig.mod.json, .gitignore, package.json and the setup of forge task worktrees', () => {
    const include = JSON.parse(read('tsconfig.mod.json')).include as string[];
    expect(include).toContain('types/claude-code');
    expect(include).not.toContain('plugins/waypoint/.claude-plugin/types');
    // Anchored at the root: plugins/*/types/index.d.ts are tracked build output.
    expect(read('.gitignore').split(/\r?\n/)).toContain('/types/');
    expect(JSON.parse(read('package.json')).scripts).toMatchObject({
      'typecheck:mod': 'tsc -p tsconfig.mod.json', 'pretypecheck:mod': 'node scripts/mod-types.mjs check',
      'mod-types:check': 'node scripts/mod-types.mjs check', 'mod-types:update': 'node scripts/mod-types.mjs update',
    });
    expect(loadConfig(repo).swarm.setup).toBe('npm ci && npm run mod-types:update');
  });
});
