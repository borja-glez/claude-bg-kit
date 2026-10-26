import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readEvents } from '../src/forge/ledger.js';
import { selectValidators, type Validator } from '../src/forge/validators.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

// FX3: the Small path's own pass runs the whole suite. Inside an execution that will integrate the task it runs only what
// the change affects: `swarm integrate` runs every validator on the merged tree before the task lands, and rolls it back on
// a failure. A Small task with no integration after it (attended, or infinite mode without an execution) keeps the whole suite.

describe('what integrate runs covers what the Small pass runs', () => {
  it('every validator the small scope selects, the heavy scope integrate uses selects too', () => {
    const v = (name: string, kind: string, extra: Partial<Validator> = {}): Validator => ({ name, cmd: name, kind, source: 'manual', ...extra });
    const all = [v('t', 'test'), v('l', 'lint'), v('ty', 'typecheck'), v('b', 'build'), v('o', 'other'), v('x', 'a11y'), v('e', 'e2e', { affects: ['src/**'] }),
      v('bench', 'bench'), v('always', 'test', { when: 'always' }), v('medium', 'lint', { when: 'medium' }), v('final', 'test', { when: 'final' }), v('aff', 'test', { affects: ['docs/**'] })];
    const small = selectValidators(all, { mode: 'small' }).map(x => x.name);
    const integrate = selectValidators(all, { mode: 'heavy', changed: null }).map(x => x.name);
    expect(small.filter(n => !integrate.includes(n))).toEqual([]);
  });
});

describe('forge validate --all --path small', () => {
  let root: string; let wt: string; let io: Io; let base: string;
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: wt, encoding: 'utf8' }).trim();
  const ran = () => { const f = path.join(wt, 'ran.txt'); const t = existsSync(f) ? readFileSync(f, 'utf8') : ''; rmSync(f, { force: true }); return t.split('\n').filter(Boolean); };
  const mark = (what: string) => `node -e "require('fs').appendFileSync('ran.txt','${what}\\n')"`;
  beforeEach(() => {
    root = tmp('forge-small-exec-');
    wt = path.join(root, '.claude', 'worktrees', 'task-T1');
    mkdirSync(path.join(wt, '.forge'), { recursive: true });
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), [
      'detect: false', 'validators:',
      `  - name: unit`, `    cmd: ${JSON.stringify(mark('full'))}`, '    kind: test', `    affected_cmd: ${JSON.stringify(`${mark('related')} {files}`)}`,
      `  - name: build`, `    cmd: ${JSON.stringify(mark('build'))}`, '    kind: build',
      `  - name: types`, `    cmd: ${JSON.stringify(mark('types'))}`, '    kind: typecheck', '',
    ].join('\n'));
    writeFileSync(path.join(wt, '.gitignore'), 'ran.txt\n');
    writeFileSync(path.join(wt, 'a.ts'), 'export const a = 1;\n');
    g('init', '-q'); g('config', 'core.autocrlf', 'false'); g('add', '-A'); g('commit', '-q', '-m', 'base');
    base = g('rev-parse', 'HEAD');
    writeFileSync(path.join(wt, 'a.ts'), 'export const a = 2;\n'); g('commit', '-q', '-am', 'T1: a');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    io = { cwd: root, now: () => new Date('2026-10-26T12:00:00.000Z'), git: defaultGit(root), env: {} };
  });
  const execution = (active: boolean, status = 'running') => seedExecution(root, {
    runId: 'e1', kind: 'ephemeral', mode: 'subagents', parallel: 3, project: 'loose', base: 'main', branch: 'main', mergeOnFinish: false,
    coordinator: 'main', hookSession: 's1', active, stopReason: active ? null : 'finished', stallReason: null, startedAt: '2026-10-26T11:00:00.000Z',
    lastStepAt: null, lastBlockStep: null, sleepUntil: null,
    tasks: { T1: { status, stage: 'validate', round: 0, worktree: wt, branch: 'task/T1', executor: 'subagents', attempts: 0, agent: null,
      startedAt: '2026-10-26T11:00:00.000Z', stageSince: '2026-10-26T11:00:00.000Z', updatedAt: '2026-10-26T11:00:00.000Z', detail: null } } as never,
  });
  // --no-cache: the same tree validated again would come from the tree cache and run nothing
  const small = (...extra: string[]) => run(['validate', '--all', '--path', 'small', '--task', 'T1-1', '--cwd', wt, '--no-cache', ...extra], io);

  it('without an execution it runs the whole suite, as before', () => {
    const r = small('--base', base);
    expect(r.code).toBe(0);
    expect(ran().sort()).toEqual(['build', 'full', 'types']);
    expect(readEvents(root).filter(e => e.kind === 'validate').at(-1)).toMatchObject({ scope: 'small' });
  });
  it('for a task an active execution will integrate, only what the change affects, and it says integrate runs the rest', () => {
    execution(true);
    const r = small('--base', base);
    expect(r.code).toBe(0);
    expect(ran().sort()).toEqual(['related', 'types']);
    expect(r.stderr).toContain('swarm integrate runs every validator');
    expect(readEvents(root).filter(e => e.kind === 'validate').at(-1)).toMatchObject({ scope: 'affected', task: 'T1-1' });
  });
  it('the whole suite again without --base, once the execution ended, or for a task it no longer runs', () => {
    execution(true);
    expect(small().code).toBe(0);
    expect(ran().sort()).toEqual(['build', 'full', 'types']);
    execution(false);
    small('--base', base);
    expect(ran().sort()).toEqual(['build', 'full', 'types']);
    execution(true, 'integrated');
    small('--base', base);
    expect(ran().sort()).toEqual(['build', 'full', 'types']);
  });
});
