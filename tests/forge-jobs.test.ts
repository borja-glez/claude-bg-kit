import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { jobsDir, liveJobs, withJob, slotFor, normalizeJob, JOB_MAX_AGE_MS, SLOT_POLL_MS, type JobDoc } from '../src/forge/jobs.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readEvents } from '../src/forge/ledger.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

let root: string;
const T = '2026-10-12T12:00:00.000Z';
const now = () => new Date(T);
// A pid that existed and is gone: its process already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
const job = (over: Partial<JobDoc> = {}): JobDoc => ({ name: 'prep-T1-1-1', cmd: 'prep', task: 'T1-1', pid: process.pid, startedAt: T, out: 'x.json', session: null, ...over });
const put = (j: JobDoc) => { mkdirSync(jobsDir(root), { recursive: true }); writeFileSync(path.join(jobsDir(root), `${j.name}.json`), JSON.stringify(j)); };
const jobFiles = () => (existsSync(jobsDir(root)) ? readdirSync(jobsDir(root)).sort() : []);
beforeEach(() => { root = tmp('forge-jobs-'); });

describe('jobs (C-03)', () => {
  it('liveJobs keeps the live ones and removes the files of a dead pid or of a job older than 2 h (Review Focus 2)', () => {
    put(job({ name: 'a' }));
    put(job({ name: 'dead', pid: deadPid() }));
    put(job({ name: 'old', startedAt: new Date(Date.parse(T) - JOB_MAX_AGE_MS - 1000).toISOString() }));
    writeFileSync(path.join(jobsDir(root), 'junk.json'), '{oops');
    expect(liveJobs(root, now()).map(j => j.name)).toEqual(['a']);
    expect(jobFiles()).toEqual(['a.json', 'junk.json']);
    expect(liveJobs(path.join(root, 'none'), now())).toEqual([]);
  });
  it('normalizeJob keeps the fields of the contract and drops what it cannot trust', () => {
    expect(normalizeJob({ ...job(), session: 'a b', extra: 1 })).toEqual({ ...job(), session: null });
    expect(normalizeJob({ ...job(), slot: 'validating' })).toEqual({ ...job(), slot: 'validating' });
    expect(normalizeJob({ ...job(), pid: 0 })).toBeNull();
    expect(normalizeJob({ ...job(), name: '../x' })).toBeNull();
    expect(normalizeJob('x')).toBeNull();
  });
  it('withJob writes the job file while fn runs and removes it after, also when fn throws', () => {
    const seen: string[][] = [];
    withJob(root, { cmd: 'prep', task: 'T1-1', out: 'o.json', session: 's1', startedAt: T }, j => {
      seen.push(jobFiles());
      expect(j).toMatchObject({ cmd: 'prep', task: 'T1-1', pid: process.pid, session: 's1', out: 'o.json' });
    });
    expect(seen).toEqual([[`prep-T1-1-${process.pid}.json`]]);
    expect(jobFiles()).toEqual([]);
    // The jobs live under .forge, whose .gitignore keeps them out of git from a repo's first forge command.
    expect(readFileSync(path.join(root, '.forge', '.gitignore'), 'utf8')).toMatch(/^\*\n/);
    expect(() => withJob(root, { cmd: 'step', task: null, out: 'o.json', session: null, startedAt: T }, () => { throw new Error('x'); })).toThrow('x');
    expect(jobFiles()).toEqual([]);
  });
  it('a slot waits while max other jobs validate or queue ahead, and counts the wait', () => {
    put(job({ name: 'b', slot: 'validating' }));
    put(job({ name: 'a', slot: 'waiting' })); // queued ahead of c: same start, name first
    const me = job({ name: 'c' });
    put(me);
    let sleeps = 0;
    const s = slotFor(root, me, 2, { now, sleep: () => { sleeps++; if (sleeps === 2) put(job({ name: 'b' })); } });
    const during = s.slot(() => JSON.parse(readFileSync(path.join(jobsDir(root), 'c.json'), 'utf8')).slot);
    expect(during).toBe('validating');
    expect(sleeps).toBe(2);
    expect(s.waited()).toBe(2 * SLOT_POLL_MS);
    expect(JSON.parse(readFileSync(path.join(jobsDir(root), 'c.json'), 'utf8')).slot).toBeUndefined();
  });
  it('a slot never waits for a job whose process died', () => {
    put(job({ name: 'b', slot: 'validating', pid: deadPid() }));
    const me = job({ name: 'c' });
    put(me);
    const s = slotFor(root, me, 1, { now, sleep: () => { throw new Error('it should not wait'); } });
    expect(s.slot(() => 7)).toBe(7);
    expect(s.waited()).toBe(0);
  });
});

describe('the forge Stop hook and the jobs (C-03, Review Focus 2)', () => {
  it('a live job of the coordinator\'s session, or of none, holds the block back; one of another session or whose process died does not', () => {
    seedExecution(root, {
      runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
      coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {},
    });
    const blocks = () => run(['hook', 'stop'], { cwd: root, now, sleep: () => undefined, env: {}, stdin: JSON.stringify({ session_id: 's1' }) }).stdout.includes('"decision":"block"');
    const only = (j: JobDoc) => { for (const f of jobFiles()) rmSync(path.join(jobsDir(root), f)); put(j); };
    only(job({ session: 's1' }));
    expect(blocks()).toBe(false);
    only(job({ session: null }));
    expect(blocks()).toBe(false);
    only(job({ session: 's2' }));
    expect(blocks()).toBe(true);
    only(job({ session: 's1', pid: deadPid() }));
    expect(blocks()).toBe(true);
    expect(jobFiles()).toEqual([]);
  });
  it('waits about 2 s for an execution.lock a live process holds, then lets the session stop without blocking or writing', () => {
    seedExecution(root, {
      runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
      coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {},
    });
    const before = readFileSync(path.join(root, '.forge', 'execution.json'), 'utf8');
    writeFileSync(path.join(root, '.forge', 'execution.lock'), JSON.stringify({ pid: process.pid, at: T }));
    let sleeps = 0;
    const r = run(['hook', 'stop'], { cwd: root, now, sleep: () => { sleeps++; }, env: {}, stdin: JSON.stringify({ session_id: 's1' }) });
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(sleeps).toBe(40);
    expect(readFileSync(path.join(root, '.forge', 'execution.json'), 'utf8')).toBe(before);
  });
});

describe('--out (C-03)', () => {
  let io: Io;
  beforeEach(() => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' });
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
    io = { cwd: root, now, sleep: () => undefined, env: {} };
  });
  it('prep --out writes its JSON with waitedMs, prints the same, and leaves no job behind', () => {
    const r = run(['prep', '--task', 'T1-1', '--path', 'medium', '--out', '.forge/work/T1/prep-1.json'], io);
    expect(r.code).toBe(0);
    const file = JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'T1', 'prep-1.json'), 'utf8'));
    expect(file).toMatchObject({ base: expect.any(String), waitedMs: 0 });
    expect(JSON.parse(r.stdout)).toEqual(file);
    expect(jobFiles()).toEqual([]);
  });
  it('validate --out writes the results as it prints them; --out without a file exits 2', () => {
    const r = run(['validate', '--all', '--path', 'medium', '--out', '.forge/work/v.json'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'v.json'), 'utf8'))).toEqual(JSON.parse(r.stdout));
    expect(run(['validate', '--all', '--out'], io)).toMatchObject({ code: 2, stderr: 'validate: --out needs a file\n' });
  });
  it('prep and validate wait for a slot while swarm.validateJobs other jobs hold one; prep says the wait in waitedMs', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'detect: false\nswarm:\n  validateJobs: 1\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    let sleeps = 0;
    const waiting = { ...io, sleep: () => { if (++sleeps === 2) rmSync(path.join(jobsDir(root), 'other.json')); } };
    put(job({ name: 'other', slot: 'validating' }));
    const r = run(['prep', '--task', 'T1-1', '--path', 'medium', '--out', '.forge/work/T1/prep-1.json'], waiting);
    expect(JSON.parse(r.stdout).waitedMs).toBe(2 * SLOT_POLL_MS);
    put(job({ name: 'other', slot: 'validating' }));
    sleeps = 0;
    expect(run(['validate', '--all', '--no-cache', '--out', '.forge/work/v.json'], waiting).code).toBe(0);
    expect(sleeps).toBe(2);
    expect(jobFiles()).toEqual([]);
  });
  it('an --out that reaches validate (a flag before the command, a second --out) exits 2 and validates nothing', () => {
    for (const argv of [['--cwd', root, 'validate', '--all', '--out', '.forge/work/v.json'], ['validate', '--all', '--out', '.forge/work/a.json', '--out', '.forge/work/v.json']]) {
      expect(run(argv, io), argv.join(' ')).toMatchObject({ code: 2, stderr: expect.stringContaining('validate: --out') });
    }
    expect(existsSync(path.join(root, '.forge', 'work', 'v.json'))).toBe(false);
    expect(readEvents(root).filter(e => e.kind === 'validate')).toEqual([]);
  });
  it('a command that fails writes {error, code} to its file', () => {
    const r = run(['review-prep', '--task', 'T1-1', '--out', '.forge/work/T1/rp.json'], io);
    expect(r.code).toBe(2);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'T1', 'rp.json'), 'utf8'))).toEqual({ error: expect.stringContaining('review-prep:'), code: 2 });
    expect(jobFiles()).toEqual([]);
  });
});
