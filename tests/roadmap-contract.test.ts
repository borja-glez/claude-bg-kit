// The contract of the roadmap (C7, wave 4): what forge's CLI generates goes through the page's normalizers whole, with
// nothing dropped (?debug=1 empty), and a page published before wave 4 (its v1 normalizer) still reads every block.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { appendEvent } from '../src/forge/ledger.js';
import { saveExecution, writePublicTask } from '../src/forge/execution.js';
import { normalizeForgeV1, normalizeInfinite, normalizeRun, normalizeRunSummary, normalizeState } from '../src/page/normalize.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';
import { MEDIUM_T1, ROADMAP_AT, largeWithDeferred, writeVerify } from './fixtures/roadmap-ledger.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

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
  root = tmp('roadmap-contract-');
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
      const v1 = normalizeForgeV1(forge);
      expect(v1, t).toBeDefined();
      expect(v1, t).toMatchObject({ path: forge.path, phase: forge.phase });
      expect(v1!.validators ?? [], t).toEqual(forge.validators.map((v: { name: string; ok: boolean }) => ({ name: v.name, ok: v.ok })));
    }
    // Fixed values, so a v1 field forge renames or stops printing fails here instead of comparing undefined with undefined.
    // T1 (Medium, done) fills every v1 field but the agent; T4 (running) carries the agent.
    expect(normalizeForgeV1(doc('T1').forge), 'T1').toMatchObject({
      path: 'medium', phase: 'done', verdict: { action: 'accept', score: 0.9 }, round: 2, cap: 4,
      validators: [{ name: 'test', ok: false }, { name: 'lint', ok: true }, { name: 'e2e', ok: true }],
    });
    expect(normalizeForgeV1(doc('T4').forge), 'T4').toMatchObject({ path: 'large', phase: 'implement', agent: 'forge-impl' });
    expect(normalizeForgeV1(doc('T2').forge), 'T2').toMatchObject({ path: 'large', phase: 'done', verdict: { action: 'accept', score: 0.85 }, round: 2, cap: 5 });
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
  it('every ArtifactData write forge prints creates, carries if_version, or is one the skill pins; each of those families is reached', () => {
    // The store refuses an update, delete or replace of an existing document without if_version. forge prints these families
    // without one on purpose: the skills pin every printed write whose document exists in their listing to the version they
    // listed, and send it unpinned only to create it. A new entry here is a deliberate change.
    const SKILL_PINNED = ['state/update', 'meta/update', 'approvals/set', 'approvals/delete', 'notes/update'];
    // Documents whose id is new by construction (a run id, a note id): a set of them is always a create.
    const CREATES = ['runs/set', 'notes/set'];
    const found: Record<string, unknown>[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.op === 'string' && typeof o.collection === 'string') found.push(o);
        Object.values(o).forEach(walk);
      }
    };
    // approvals: decide, reopen (the delete), confirm and the policy.
    const propose = (title: string, file: string) => {
      writeFileSync(path.join(root, 'p.json'), JSON.stringify({ category: 'quality', risk: 'low', title, rationale: `why ${title}`, evidence: 'e', pillar: 'quality', source: 'scout', path: file }));
      return out(run(['proposals', 'add', '--file', 'p.json'], io)).id as string;
    };
    const [p1, p2, p3] = [propose('Cut dead code', 'src/util/dead.ts'), propose('Document the cart module', 'src/cart/readme.md'), propose('Tidy the logger imports', 'src/log/index.ts')];
    walk(out(run(['proposals', 'decide', p1, 'approve'], io)));
    walk(out(run(['proposals', 'decide', p1, 'reject', '--reopen'], io)));
    walk(out(run(['proposals', 'decide', p2, 'approve'], io)));
    walk(out(run(['proposals', 'decide', p2, 'confirm'], io)));
    walk(out(run(['proposals', 'policy', p3], io)));
    // notes: a decision that resolves a question (the note is a create, the answer an update).
    writeFileSync(path.join(root, 'd.json'), JSON.stringify({ point: 'design-approve', what: 'design approved (v4)', chosen: 'approve', why: 'round 2 without critical', by: 'auto', undo: { type: 'design-reopen', project: 'shop' }, resolves: 'q-20261013T090000000Z-main-0000' }));
    walk(out(run(['decision', 'add', '--data-file', 'd.json', '--task', 'T5-2', '--session', 'main'], io)));
    // state, runs: the roadmap doc, the stop's release, the run summary.
    walk(out(run(['roadmap-doc', 'T2', '--project', 'shop'], io)));
    walk(out(run(['swarm', 'status'], io)));
    walk(out(run(['stop'], io)));
    // Re-review m4: the ended run's status and swarm close print the release of the coordinator's stopped task (T4).
    const ended = out(run(['swarm', 'status'], io));
    expect(ended.publish.release).toEqual([expect.objectContaining({ task: 'T4', write: expect.objectContaining({ op: 'update', collection: 'state', doc_id: 'T4' }) })]);
    walk(ended);
    const closed = out(run(['swarm', 'close'], io));
    expect(closed.release).toEqual(ended.publish.release);
    walk(closed);
    saveExecution(root, execution({ active: false, stopReason: 'stopped', closedAt: ROADMAP_AT(250), closedBy: 'close' }));
    walk(out(run(['roadmap-run', '--run', RUN], io)));
    // meta/metrics: an integrate in a run of its own.
    const root2 = tmp('roadmap-contract-integ-');
    const g2 = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
    try {
      g2(root2, 'init', '-q', '-b', 'main'); g2(root2, 'config', 'user.email', 'a@b.c'); g2(root2, 'config', 'user.name', 't'); g2(root2, 'config', 'core.autocrlf', 'false');
      writeFileSync(path.join(root2, '.gitignore'), '.forge/\n.claude/\n');
      writeFileSync(path.join(root2, 'base.txt'), 'base\n');
      g2(root2, 'add', '.'); g2(root2, 'commit', '-qm', 'init');
      mkdirSync(path.join(root2, '.forge'), { recursive: true });
      writeFileSync(path.join(root2, '.forge', 'config.yaml'), 'validators: []\n');
      const io2: Io = { cwd: root2, now: () => NOW, git: defaultGit(root2), env: {} };
      out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'hook-main'], io2));
      const w = out(run(['swarm', 'worktree', 'T1'], io2)).worktree;
      writeFileSync(path.join(w, 'a.txt'), 'a\n'); g2(w, 'add', 'a.txt'); g2(w, 'commit', '-qm', 'T1: work');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io2));
      const integrated = out(run(['swarm', 'integrate', 'T1'], io2));
      walk(integrated);
      // Re-review m4: swarm step's recovery (`integrated` again, the roadmap still not done) carries the same writes.
      // Under .forge/ (ignored), so the main checkout stays clean for the merge below.
      writeFileSync(path.join(root2, '.forge', 'plan.yaml'), 'project: shop\nlocale: en\nversion: "1"\ntracks:\n  - { id: a, name: A, color: blue }\nphases:\n  - { id: p1, name: P1 }\ntasks:\n  - { id: T1, title: T1, track: a, phase: p1, done_when: x, zones: [a.txt] }\n');
      for (const c of ['state', 'sessions']) mkdirSync(path.join(root2, '.forge', 'db', c), { recursive: true });
      writeFileSync(path.join(root2, '.forge', 'db', 'state', 'T1.json'), JSON.stringify({ status: 'in_progress' }));
      const again = (out(run(['swarm', 'step', '--plan', '.forge/plan.yaml', '--db', '.forge/db'], io2)).actions as Record<string, unknown>[]).find(a => a.again === true)!;
      expect(again).toMatchObject({ type: 'integrated', task: 'T1', publish: { op: 'update', collection: 'state', doc_id: 'T1' }, metrics: integrated.metrics });
      walk(again);
      // Re-review m4: swarm merge prints each integrated task's block (merged: true) for the skill to send.
      const merged = out(run(['swarm', 'merge', '--yes'], io2));
      expect(merged).toMatchObject({ result: 'merged', publish: [{ op: 'update', collection: 'state', doc_id: 'T1' }] });
      walk(merged);
    } finally { try { g2(root2, 'worktree', 'prune'); } catch { /* ignore */ } rmSync(root2, { recursive: true, force: true }); }
    const key = (w: Record<string, unknown>) => `${w.collection}/${w.op}`;
    const unpinned = found.filter(w => w.if_version === undefined);
    for (const w of unpinned) {
      if (CREATES.includes(key(w))) continue;
      expect(SKILL_PINNED, `${key(w)} ${String(w.doc_id)} is printed without if_version`).toContain(key(w));
    }
    // The list cannot rot: each family in it is printed unpinned by some command above, and each create family was reached.
    for (const k of SKILL_PINNED) expect(unpinned.map(key), `${k} is never printed`).toContain(k);
    for (const k of CREATES) expect(found.map(key), `${k} is never printed`).toContain(k);
  });
});
