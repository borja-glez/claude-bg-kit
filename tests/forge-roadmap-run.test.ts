import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, type Io } from '../src/forge/cli/run.js';
import { appendEvent } from '../src/forge/ledger.js';
import { saveExecution, writePublicTask } from '../src/forge/execution.js';
import { writeMember } from '../src/forge/members.js';
import { normalizeRunSummary, RUN_SUMMARY_MAX } from '../src/lib/run-summary.js';
import { byteLength } from '../src/lib/roadmap-doc.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';
import { MEDIUM_T1, ROADMAP_AT } from './fixtures/roadmap-ledger.js';

let root: string;
let io: Io;
const NOW = new Date(ROADMAP_AT(300));
const RUN = 'shop-20261016T100000000Z';
const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const out = (r: { code: number; stdout: string; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
const task = (status: ExecTask['status'], over: Partial<ExecTask> = {}): ExecTask => ({
  status, stage: 'integrate', round: 1, worktree: '', branch: 'task/x', executor: 'subagents', attempts: 0, agent: null,
  startedAt: ROADMAP_AT(0), stageSince: ROADMAP_AT(0), updatedAt: ROADMAP_AT(0), detail: null, ...over,
});
const execution = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: RUN, kind: 'plan', mode: 'sessions', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main', hookSession: 'h1',
  active: false, stopReason: 'stopped', stallReason: null, startedAt: ROADMAP_AT(0), lastStepAt: ROADMAP_AT(200), lastBlockStep: null, sleepUntil: null,
  closedAt: ROADMAP_AT(210), closedBy: 'close',
  tasks: {
    T1: task('integrated', { finishedAt: ROADMAP_AT(45), title: 'Cart' }),
    T2: task('blocked', { stage: 'review', finishedAt: ROADMAP_AT(60), executor: 'sessions' }),
    T3: task('conflict'),
    T4: task('stopped', { stage: 'implement', executor: 'sessions' }),
  },
  ...over,
});
const pub = (t: string, by: string, mode: 'subagents' | 'sessions' | 'manual') =>
  writePublicTask(root, { task: t, runId: RUN, stage: 'review', status: 'running', agent: null, round: 1, since: ROADMAP_AT(0), updatedAt: ROADMAP_AT(0), leaseUntil: ROADMAP_AT(10), by, mode });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-roadmap-run-'));
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n');
  g('add', '.'); g('commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge', 'work', 'shop', 'T1'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => NOW, env: {} };
  for (const e of MEDIUM_T1) appendEvent(root, e);
  writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'deferred.json'), JSON.stringify([{ problem: 'a' }, { problem: 'b' }]));
  appendEvent(root, { ts: ROADMAP_AT(100), kind: 'decision', point: 'safe-path', what: 'skip', chosen: 'skip', why: 'unattended', by: 'unattended', weight: 'minor', runId: RUN });
  appendEvent(root, { ts: ROADMAP_AT(190), kind: 'verdict', task: 'shop-final', dir: '.forge/work/shop/final-1', action: 'accept', score: 0.9, signature: 'f', critical: 0, important: 1, minor: 2 });
  saveExecution(root, execution());
  pub('T1', 'main', 'subagents');
  pub('T2', 'ui', 'sessions');
  pub('T4', 'ui2', 'sessions');
  writeMember(root, { sessionId: 'ui3', role: 'executor', runId: RUN, task: 'T3', name: 'wp-shop-T3', since: ROADMAP_AT(0), hookSession: 'h3' });
  writeMember(root, { sessionId: 'mm', role: 'manual', runId: RUN, task: null, name: null, since: ROADMAP_AT(0), hookSession: 'h4' });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('FORGE roadmap-run (G-07, G-04)', () => {
  it('--run summarizes the ended run: each task with its status (stopped too), seconds, rounds and deferred, the final review and the decisions', () => {
    const r = out(run(['roadmap-run', '--run', RUN], io));
    expect(r.write).toEqual({ op: 'set', collection: 'runs', doc_id: RUN, file_path: path.join(root, '.forge', 'work', 'run', `runs-${RUN}.json`) });
    const doc = JSON.parse(readFileSync(r.write.file_path, 'utf8'));
    expect(doc).toMatchObject({ v: 1, runId: RUN, kind: 'plan', mode: 'sessions', parallel: 3, branch: 'forge/run-shop', target: 'main', coordinator: 'main',
      startedAt: ROADMAP_AT(0), endedAt: ROADMAP_AT(210), stopReason: 'stopped', closedBy: 'close', merged: false, loose: false,
      finalReview: { action: 'accept', critical: 0, important: 1, minor: 2 }, decisions: 1, deferred: 2 });
    expect(doc.tasks).toEqual([
      { id: 'T1', title: 'Cart', status: 'integrated', seconds: 2700, rounds: 2, deferred: 2 },
      { id: 'T2', status: 'blocked', seconds: 3600 },
      { id: 'T3', status: 'conflict' },
      { id: 'T4', status: 'stopped' },
    ]);
    expect(normalizeRunSummary(doc)).toEqual(doc);
  });
  it('cleanup deletes each executor session of the run, never its coordinator nor a manual member', () => {
    expect(out(run(['roadmap-run', '--run', RUN], io)).cleanup).toEqual([
      { op: 'delete', collection: 'sessions', doc_id: 'ui' },
      { op: 'delete', collection: 'sessions', doc_id: 'ui2' },
      { op: 'delete', collection: 'sessions', doc_id: 'ui3' },
    ]);
  });
  it('--task summarizes a task closed outside a run: kind single, its integration, its rounds, no cleanup', () => {
    const r = out(run(['roadmap-run', '--task', 'T1', '--project', 'shop', '--session', 'be'], io));
    const doc = JSON.parse(readFileSync(r.write.file_path, 'utf8'));
    expect(doc).toMatchObject({ v: 1, kind: 'single', mode: 'single', parallel: 1, coordinator: 'be', branch: 'main', target: 'main', merged: true,
      startedAt: ROADMAP_AT(0), endedAt: ROADMAP_AT(45), stopReason: 'finished', closedBy: null, loose: false, finalReview: null,
      tasks: [{ id: 'T1', status: 'integrated', seconds: 2700, rounds: 2, deferred: 2 }] });
    expect(doc.runId).toMatch(/^single-T1-\d{8}T\d{9}Z$/);
    expect(r.write.doc_id).toBe(doc.runId);
    expect(r.cleanup).toEqual([]);
    expect(normalizeRunSummary(doc)).toEqual(doc);
  });
  it('refuses another run, both flags or none, an active run and a Trivial task', () => {
    expect(run(['roadmap-run', '--run', 'other'], io).code).toBe(2);
    expect(run(['roadmap-run'], io).code).toBe(2);
    expect(run(['roadmap-run', '--run', RUN, '--task', 'T1'], io).code).toBe(2);
    appendEvent(root, { ts: ROADMAP_AT(250), kind: 'triage', task: 'T8', path: 'trivial', reasons: [] });
    expect(run(['roadmap-run', '--task', 'T8'], io).code).toBe(2);
    saveExecution(root, execution({ active: true, stopReason: null, closedAt: null, closedBy: null }));
    expect(run(['roadmap-run', '--run', RUN], io).code).toBe(2);
  });
  it('a summary over 8 KB drops tasks from the end and says so', () => {
    const tasks = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`T${100 + i}`, task('integrated', { title: `A task with a long title number ${i} `.padEnd(190, 'x') })]));
    saveExecution(root, execution({ tasks }));
    const r = out(run(['roadmap-run', '--run', RUN], io));
    const doc = JSON.parse(readFileSync(r.write.file_path, 'utf8'));
    expect(doc.tasks.length).toBeLessThan(60);
    expect(r.bytes).toBeLessThanOrEqual(RUN_SUMMARY_MAX);
    expect(byteLength(JSON.stringify(doc))).toBe(r.bytes);
    expect(r.dropped).toEqual(['tasks>60', `tasks:${doc.tasks.length}`]);
  });
  it('swarm close prints the summary of the run it closes, for /forge:stop to publish', () => {
    saveExecution(root, execution({ closedAt: null, closedBy: null }));
    const c = out(run(['swarm', 'close'], io));
    expect(c).toMatchObject({ closed: true, runs: { write: { collection: 'runs', doc_id: RUN } } });
    expect(c.runs.cleanup.map((x: { doc_id: string }) => x.doc_id)).toEqual(['ui', 'ui2', 'ui3']);
  });
  it('normalizeRunSummary drops a bad task with a report and refuses a document that is not a summary', () => {
    const doc = JSON.parse(readFileSync(out(run(['roadmap-run', '--run', RUN], io)).write.file_path, 'utf8'));
    const got: string[] = [];
    const n = normalizeRunSummary({ ...doc, tasks: [...doc.tasks, { id: '../x', status: 'integrated' }, { id: 'T9', status: 'lost' }] }, (f, a) => { got.push(`${f} · ${a}`); })!;
    expect(n.tasks).toHaveLength(4);
    expect(got).toEqual(['tasks[4] · dropped', 'tasks[5] · dropped']);
    for (const bad of [null, { ...doc, v: 2 }, { ...doc, runId: 'a b' }, { ...doc, kind: 'x' }, { ...doc, endedAt: 'later' }]) expect(normalizeRunSummary(bad)).toBeNull();
  });
});
