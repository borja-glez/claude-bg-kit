// The contract of the roadmap (C7, wave 4): what forge's CLI generates goes through the page's normalizers whole, with
// nothing dropped (?debug=1 empty), and a page published before wave 4 (its v1 normalizer) still reads every block.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, type Io } from '../src/forge/cli/run.js';
import { appendEvent } from '../src/forge/ledger.js';
import { saveExecution, writePublicTask } from '../src/forge/execution.js';
import { normalizeForgeV1, normalizeInfinite, normalizeRun, normalizeRunSummary, normalizeState } from '../src/page/normalize.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';
import { MEDIUM_T1, ROADMAP_AT, largeWithDeferred, writeVerify } from './fixtures/roadmap-ledger.js';

let root: string;
let io: Io;
const NOW = new Date(ROADMAP_AT(300));
const RUN = 'shop-20261016T100000000Z';
const TASKS = ['T1', 'T2', 'T3', 'T4'];
const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const out = (r: { code: number; stdout: string; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
/** The stored document after an update: each field set, one written as {__delete__: true} removed. */
const applyUpdate = (prev: Record<string, unknown>, data: Record<string, unknown>) => {
  const next = { ...prev };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && (v as { __delete__?: unknown }).__delete__ === true) delete next[k];
    else next[k] = v;
  }
  return next;
};
const drops = () => { const list: string[] = []; return { list, rep: (f: string, a: string, d: string) => { list.push(`${f} · ${a} · ${d}`); } }; };
const task = (status: ExecTask['status'], over: Partial<ExecTask> = {}): ExecTask => ({
  status, stage: 'implement', round: 1, worktree: '', branch: 'task/x', executor: 'subagents', attempts: 0, agent: null,
  startedAt: ROADMAP_AT(0), stageSince: ROADMAP_AT(0), updatedAt: ROADMAP_AT(0), detail: null, ...over,
});
const execution = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: RUN, kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main', hookSession: 'h1',
  active: true, stopReason: null, stallReason: null, startedAt: ROADMAP_AT(0), lastStepAt: ROADMAP_AT(200), lastBlockStep: null, sleepUntil: null, closedAt: null, closedBy: null,
  tasks: {
    T1: task('integrated', { stage: 'integrate', finishedAt: ROADMAP_AT(45), sha: g('rev-parse', 'HEAD') }),
    T2: task('integrated', { stage: 'integrate', finishedAt: ROADMAP_AT(150) }),
    T3: task('blocked', { stage: 'review', finishedAt: ROADMAP_AT(160) }),
    T4: task('running', { agent: 'forge-impl' }),
  },
  ...over,
});
const doc = (t: string) => JSON.parse(readFileSync(out(run(['roadmap-doc', t, '--project', 'shop'], io)).file, 'utf8'));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'roadmap-contract-'));
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n');
  g('add', '.'); g('commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => NOW, env: {} };
  for (const e of [...MEDIUM_T1, ...largeWithDeferred('T2', 'shop'),
    { ts: ROADMAP_AT(155), kind: 'triage' as const, task: 'T3', project: 'shop', path: 'medium', reasons: [] },
    { ts: ROADMAP_AT(156), kind: 'phase' as const, task: 'T3', project: 'shop', phase: 'implement', brief: 1, base: 'abc1234' },
    { ts: ROADMAP_AT(170), kind: 'triage' as const, task: 'T4', project: 'shop', path: 'large', reasons: [] },
  ]) appendEvent(root, e);
  const work = '.forge/work/shop/T1';
  writeVerify(root, work, 1, 2, { surfaces: ['web'], result: 'blocked', reason: 'the payments sandbox was down', unchecked: ['refund'], checks: [
    { id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'the home page', observed: 'it loads', shot: '01-home.png' },
    { id: 2, surface: 'web', name: 'cart', main: false, ok: false, expected: '3 items', observed: '2 items', shot: '02-cart.png' },
    { id: 3, surface: 'web', name: 'logs', main: false, ok: true, expected: 'no errors', observed: 'none', shot: null },
  ] }, ['01-home.png', '02-cart.png']);
  writeFileSync(path.join(root, 'up.json'), JSON.stringify([
    { path: `${work}/evidence/1-2/01-home.png`, id: 'a1', url: 'https://claude.ai/_blob/a1' },
    { path: `${work}/evidence/1-2/02-cart.png`, id: 'a2', url: 'https://claude.ai/_blob/a2' },
  ]));
  saveExecution(root, execution());
  writePublicTask(root, { task: 'T4', runId: RUN, stage: 'implement', status: 'running', agent: 'forge-impl', round: 1, since: ROADMAP_AT(170), updatedAt: ROADMAP_AT(170), leaseUntil: ROADMAP_AT(400), by: 'main', mode: 'subagents' });
  out(run(['roadmap-doc', 'T1', '--project', 'shop', '--assets', 'up.json'], io));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the roadmap contract (C7, wave 4)', () => {
  it('state/T of a Medium with its evidence, a Large with deferred findings, a blocked and a running task pass normalizeState whole', () => {
    for (const t of TASKS) {
      const data = doc(t);
      const d = drops();
      const state = normalizeState(applyUpdate({ status: 'in_progress' }, data), d.rep);
      expect(d.list, t).toEqual([]);
      expect(state.forge, t).toEqual(data.forge);
      if (data.evidence) expect(state.evidence, t).toEqual(data.evidence);
      if (data.exec && !data.exec.__delete__) expect(state.exec, t).toEqual(data.exec);
    }
    expect(doc('T1').evidence).toMatchObject({ result: 'blocked', reason: 'the payments sandbox was down', unchecked: ['refund'] });
    expect(doc('T2').forge.deferred).toHaveLength(3);
    expect(doc('T3').forge.stage).toBe('blocked');
    expect(doc('T4').exec).toMatchObject({ runId: RUN, stage: 'implement', by: 'main' });
  });
  it('a page published before wave 4 still reads path, phase, agent, every validator, verdict, round and cap of each block', () => {
    for (const t of TASKS) {
      const forge = doc(t).forge;
      const v1 = normalizeForgeV1(forge)!;
      expect(v1, t).toMatchObject({ path: forge.path, phase: forge.phase });
      expect(v1.validators ?? [], t).toEqual(forge.validators.map((v: { name: string; ok: boolean }) => ({ name: v.name, ok: v.ok })));
      for (const k of ['agent', 'verdict', 'round', 'cap'] as const) expect(v1[k], `${t} ${k}`).toEqual(forge[k]);
    }
  });
  it('meta/run, runs/<runId> and meta/infinite pass their normalizers whole', () => {
    const d = drops();
    const runDoc = out(run(['swarm', 'status'], io)).publish.run;
    expect(normalizeRun(runDoc, d.rep)).toEqual(runDoc);
    saveExecution(root, execution({ active: false, stopReason: 'stopped', closedAt: ROADMAP_AT(250), closedBy: 'close' }));
    const summary = JSON.parse(readFileSync(out(run(['roadmap-run', '--run', RUN], io)).write.file_path, 'utf8'));
    expect(normalizeRunSummary(summary, d.rep)).toEqual(summary);
    const infinite = out(run(['infinite', 'start', '--cycles', '2', '--session', 'c1'], io)).publish.infinite;
    expect(normalizeInfinite(infinite, d.rep)).toEqual(infinite);
    expect(d.list).toEqual([]);
  });
  it('every ArtifactData write forge prints either creates, carries if_version, or is one the skill pins by design', () => {
    // The store refuses an update, delete or replace of an existing document without if_version. These are printed without
    // one on purpose (the skill pins each to the version it lists): a new entry here is a deliberate change.
    const UNPINNED_BY_DESIGN = ['state/update', 'meta/update'];
    const found: Record<string, unknown>[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.op === 'string' && typeof o.collection === 'string') found.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(out(run(['roadmap-doc', 'T2', '--project', 'shop'], io)));
    walk(out(run(['swarm', 'status'], io)));
    walk(out(run(['stop'], io)));
    saveExecution(root, execution({ active: false, stopReason: 'stopped', closedAt: ROADMAP_AT(250), closedBy: 'close' }));
    walk(out(run(['roadmap-run', '--run', RUN], io)));
    expect(found.map(w => `${w.collection}/${w.op}`)).toEqual(expect.arrayContaining(['state/update', 'runs/set']));
    for (const w of found) {
      const key = `${w.collection}/${w.op}`;
      if (w.op === 'set' && w.if_version === undefined) continue; // a create
      if (w.if_version !== undefined) continue;
      expect(UNPINNED_BY_DESIGN, `${key} ${String(w.doc_id)} is printed without if_version`).toContain(key);
    }
  });
});
