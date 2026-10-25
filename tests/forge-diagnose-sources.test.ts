import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeSources, ledgerLines, projectSlug, scopeLines, subagentFile, transcriptsOf } from '../src/forge/diagnose-sources.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { TX_AT as at } from './helpers/transcript.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const put = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
const ledger = (root: string, lines: (Record<string, unknown> | string)[]) =>
  put(path.join(root, '.forge', 'ledger.jsonl'), lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
const EXEC: ExecutionState = {
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop',
  mergeOnFinish: false, coordinator: 'main', hookSession: 'h1', active: true, stopReason: null, stallReason: null,
  startedAt: at(0), lastStepAt: null, lastBlockStep: null, sleepUntil: null, closedAt: null, closedBy: null,
  tasks: { T001: { status: 'running', stage: 'implement', round: 1, worktree: '/r/.claude/worktrees/task-T001', branch: 'task/T001', executor: 'subagents',
    attempts: 0, agent: 'forge-impl', startedAt: at(1), stageSince: at(1), updatedAt: at(5), detail: null } },
};

describe('the ledger of a scope (A6)', () => {
  it('numbers every line and keeps only the events: a junk line or an unknown kind is none', () => {
    const root = tmp('diag-src-');
    ledger(root, [{ ts: at(1), kind: 'triage', task: 'fix', path: 'small' }, 'junk', '{"ts":"x","kind":"nope"}', { ts: at(2), kind: 'phase', task: 'fix-1', phase: 'implement' }]);
    const { lines, source } = ledgerLines(root);
    expect(lines.map(l => l.line)).toEqual([1, 4]);
    expect(source).toMatchObject({ file: '.forge/ledger.jsonl', kind: 'ledger', lines: 4 });
  });
  it('a task is the pair (project, task): T001 of shop, of garden and a loose T001 never mix (D-08, Review Focus 3)', () => {
    const root = tmp('diag-src-');
    ledger(root, [
      { ts: at(1), kind: 'triage', task: 'T001', project: 'shop', path: 'medium' },
      { ts: at(2), kind: 'phase', task: 'T001-1', project: 'shop', phase: 'implement' },
      { ts: at(3), kind: 'triage', task: 'T001', project: 'garden', path: 'small' },
      { ts: at(4), kind: 'phase', task: 'T001-1', project: 'garden', phase: 'implement' },
      { ts: at(5), kind: 'verdict', task: 'T001-1', action: 'accept' },
      { ts: at(6), kind: 'triage', task: 'T001', path: 'trivial' },
      { ts: at(7), kind: 'validate', task: 'T001', ok: true },
      { ts: at(8), kind: 'triage', task: 'T0011', project: 'shop', path: 'small' },
    ]);
    const { lines } = ledgerLines(root);
    const of = (task: string, project: string | null) => scopeLines(lines, { kind: 'task', task, project }).map(l => l.line);
    expect(of('T001', 'shop')).toEqual([1, 2]);
    expect(of('T001', 'garden')).toEqual([3, 4, 5]);
    expect(of('T001', null)).toEqual([6, 7]);
  });
  it('an execution is the events that carry its runId', () => {
    const root = tmp('diag-src-');
    ledger(root, [{ ts: at(1), kind: 'triage', task: 'T001', project: 'shop', runId: 'r1' }, { ts: at(2), kind: 'triage', task: 'T002', project: 'shop' },
      { ts: at(3), kind: 'verdict', task: 'T001-1', project: 'shop', runId: 'r1' }]);
    expect(scopeLines(ledgerLines(root).lines, { kind: 'execution', runId: 'r1' }).map(l => l.line)).toEqual([1, 3]);
  });
});

describe("forge's files of a scope (A6)", () => {
  it("reads a task's out files, findings, asked, overrides and jobs, measures decisions.json, and leaves the job file and swarm.json as they were (Review Focus 4)", () => {
    const root = tmp('diag-src-');
    ledger(root, [{ ts: at(1), kind: 'triage', task: 'fix', path: 'medium', session: 's1' }, { ts: at(2), kind: 'phase', task: 'fix-1', phase: 'implement', brief: 1, session: 's2' }]);
    const work = path.join(root, '.forge', 'work', 'fix');
    put(path.join(work, 'brief-1.md'), '# brief\n');
    put(path.join(work, 'prep-1.json'), '{"base":"abc"}\n');
    const failed = put(path.join(work, 'review-prep-2.json'), '{"error":"boom","code":1}\n');
    utimesSync(failed, new Date(at(9)), new Date(at(9)));
    put(path.join(work, 'findings-1-1.json'), JSON.stringify({ task: 'fix-1', round: 1, action: 'fix', findings: [{ id: 'F1' }], validators: [] }));
    put(path.join(work, 'reviews-1-1', 'asked.json'), JSON.stringify({ at: at(9), findings: ['F1'] }));
    put(path.join(work, 'reviews-1-1', 'overrides.json'), JSON.stringify({ outOfModel: ['F1'], defer: [] }));
    put(path.join(work, 'notes.txt'), 'x');
    const job = put(path.join(root, '.forge', 'jobs', 'prep-fix-1-999999.json'),
      JSON.stringify({ name: 'prep-fix-1-999999', cmd: 'prep', task: 'fix-1', pid: 999999, startedAt: at(3), out: '.forge/work/fix/prep-1.json', session: 's1' }));
    put(path.join(root, '.forge', 'decisions.json'), '{}\n');
    put(path.join(root, '.forge', 'swarm.json'), '{}\n');
    const s = forgeSources(root, { kind: 'task', task: 'fix', project: null });
    expect(s.scoped.map(l => l.line)).toEqual([1, 2]);
    expect(s.tasks).toEqual([{ task: 'fix', project: null, inExecution: false }]);
    expect(s.exec).toBeNull();
    expect(s.sessions).toEqual(['s1', 's2']);
    expect(s.docs.map(d => [d.kind, d.file]).sort()).toEqual([
      ['asked', '.forge/work/fix/reviews-1-1/asked.json'], ['findings', '.forge/work/fix/findings-1-1.json'], ['job', '.forge/jobs/prep-fix-1-999999.json'],
      ['out', '.forge/work/fix/prep-1.json'], ['out', '.forge/work/fix/review-prep-2.json'], ['overrides', '.forge/work/fix/reviews-1-1/overrides.json'],
    ]);
    expect(s.docs.find(d => d.abs === failed)).toMatchObject({ ts: at(9), task: 'fix', doc: { error: 'boom', code: 1 } });
    expect(s.docs.find(d => d.kind === 'job')).toMatchObject({ ts: at(3), task: 'fix' });
    expect(s.sources.map(x => x.kind)).toEqual(expect.arrayContaining(['ledger', 'decisions']));
    expect(existsSync(job)).toBe(true);
    expect(existsSync(path.join(root, '.forge', 'execution.json'))).toBe(false);
  });
  it('a job joins the scope of its (project, task) pair: garden\'s T001 jobs never reach shop\'s T001, and a loose T001 job reaches neither (D-08)', () => {
    const root = tmp('diag-src-');
    ledger(root, [{ ts: at(1), kind: 'triage', task: 'T001', project: 'shop' }, { ts: at(2), kind: 'triage', task: 'T001', project: 'garden' }, { ts: at(3), kind: 'triage', task: 'T001' }]);
    const job = (name: string, out: string) => put(path.join(root, '.forge', 'jobs', `${name}.json`),
      JSON.stringify({ name, cmd: 'prep', task: 'T001', pid: 999999, startedAt: at(4), out, session: null }));
    job('prep-shop', '.forge/work/shop/T001/prep-1.json');
    job('prep-garden', path.join(root, '.forge', 'work', 'garden', 'T001', 'prep-1.json'));
    job('prep-loose', '.forge/work/T001/prep-1.json');
    const jobs = (project: string | null) => forgeSources(root, { kind: 'task', task: 'T001', project }).docs.filter(d => d.kind === 'job').map(d => d.file);
    expect(jobs('shop')).toEqual(['.forge/jobs/prep-shop.json']);
    expect(jobs('garden')).toEqual(['.forge/jobs/prep-garden.json']);
    expect(jobs(null)).toEqual(['.forge/jobs/prep-loose.json']);
  });
  it("in an execution, a job joins by the run's (project, task) pairs, and one that writes to the run folder joins by its task (D-08)", () => {
    const root = tmp('diag-src-');
    ledger(root, [{ ts: at(1), kind: 'triage', task: 'T001', project: 'shop', runId: 'r1' }, { ts: at(2), kind: 'triage', task: 'T001', project: 'garden' }]);
    put(path.join(root, '.forge', 'execution.json'), JSON.stringify(EXEC));
    const job = (name: string, cmd: string, task: string | null, out: string) => put(path.join(root, '.forge', 'jobs', `${name}.json`),
      JSON.stringify({ name, cmd, task, pid: 999999, startedAt: at(4), out, session: null }));
    job('prep-T001-1-1', 'prep', 'T001-1', '.forge/work/shop/T001/prep-1.json');
    job('prep-T001-1-2', 'prep', 'T001-1', '.forge/work/garden/T001/prep-1.json');
    job('prep-T001-1-3', 'prep', 'T001-1', '.forge/work/T001/prep-1.json');
    job('integrate-T001-4', 'integrate', 'T001', '.forge/work/run/integrate-T001.json');
    job('integrate-T002-5', 'integrate', 'T002', '.forge/work/run/integrate-T002.json');
    job('step-run-6', 'step', null, '.forge/work/run/step.json');
    const s = forgeSources(root, { kind: 'execution', runId: 'r1' });
    expect(s.tasks).toEqual([{ task: 'T001', project: 'shop', inExecution: true }]);
    expect(s.docs.filter(d => d.kind === 'job').map(d => [d.file, d.task])).toEqual([
      ['.forge/jobs/integrate-T001-4.json', 'T001'], ['.forge/jobs/prep-T001-1-1.json', 'T001'], ['.forge/jobs/step-run-6.json', null]]);
  });
  it("an execution comes only from execution.json of that runId: its tasks, their public files and the run folder's outs", () => {
    const root = tmp('diag-src-');
    ledger(root, [{ ts: at(1), kind: 'triage', task: 'T001', project: 'shop', runId: 'r1', session: 's9' }]);
    put(path.join(root, '.forge', 'execution.json'), JSON.stringify(EXEC));
    put(path.join(root, '.forge', 'execution', 'T001.json'), JSON.stringify({ task: 'T001', runId: 'r1', stage: 'implement', status: 'running', agent: null,
      round: 1, since: at(1), updatedAt: at(5), leaseUntil: at(30), by: 'main', mode: 'subagents' }));
    put(path.join(root, '.forge', 'work', 'run', 'step.json'), '{"actions":[]}\n');
    put(path.join(root, '.forge', 'work', 'run', 'integrate-T001.json'), '{"error":"conflict","code":2}\n');
    const s = forgeSources(root, { kind: 'execution', runId: 'r1' });
    expect(s.exec?.runId).toBe('r1');
    expect(s.tasks).toEqual([{ task: 'T001', project: 'shop', inExecution: true }]);
    expect(s.sessions).toEqual(['s9', 'h1']);
    expect(s.docs.map(d => [d.kind, d.file]).sort()).toEqual([['execution', '.forge/execution.json'], ['execution-task', '.forge/execution/T001.json'],
      ['out', '.forge/work/run/integrate-T001.json'], ['out', '.forge/work/run/step.json']]);
    expect(forgeSources(root, { kind: 'execution', runId: 'r2' }).exec).toBeNull();
  });
});

describe('the transcripts of a scope (A6, Review Focus 5)', () => {
  it("finds a session's transcript under the checkout's slug first, then in any project folder; an unsafe session is never looked for", () => {
    const cfg = tmp('diag-cfg-');
    const main = path.join(tmp('diag-main-'), 'my repo');
    const own = put(path.join(cfg, 'projects', projectSlug(main), 's1.jsonl'), '\n');
    const other = put(path.join(cfg, 'projects', 'C--elsewhere', 's2.jsonl'), '\n');
    expect(projectSlug('E:\\work\\claude-bg-kit')).toBe('E--work-claude-bg-kit');
    expect(transcriptsOf(['s1', 's2', 's3', '../s1'], cfg, main)).toEqual({ found: [own, other], missing: ['s3'] });
  });
  it("finds a subagent only inside <session>/subagents/, by a safe id, and reads its meta leniently", () => {
    const dir = tmp('diag-sub-');
    const t = put(path.join(dir, 's1.jsonl'), '\n');
    const sub = put(path.join(dir, 's1', 'subagents', 'agent-a1.jsonl'), '\n');
    const meta = put(path.join(dir, 's1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'forge:forge-impl', toolUseId: 'g1', spawnDepth: 1 }));
    expect(subagentFile(t, 'a1')).toEqual({ file: sub, metaFile: meta, agentId: 'a1', meta: { agentType: 'forge:forge-impl', toolUseId: 'g1', spawnDepth: 1 } });
    put(path.join(dir, 's1', 'subagents', 'agent-a2.jsonl'), '\n');
    put(path.join(dir, 's1', 'subagents', 'agent-a2.meta.json'), '{not json');
    expect(subagentFile(t, 'a2')?.meta).toBeNull();
    for (const id of ['a9', '../a1', 'a1/../a1']) expect(subagentFile(t, id), id).toBeNull();
  });
});
