import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addDecision, allDecisions, decisionsFile, listDecisions, readDecisionsDoc, renderDecisionsMd, DecisionInputError } from '../src/forge/decisions.js';
import { appendEvent, readEvents, withEventContext } from '../src/forge/ledger.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { saveExecution } from '../src/forge/execution.js';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-dec-')); });
const at = (m: number) => new Date(Date.parse('2026-10-13T10:00:00.000Z') + m * 60_000).toISOString();
const INPUT = { point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', why: 'ronda 2 sin critical', by: 'auto', undo: { type: 'design-reopen', project: 'reparto' } };

describe('addDecision', () => {
  it('appends a decision with its weight, numbers it and writes the summary', () => {
    const r = addDecision(root, INPUT, { ts: at(0), task: 'reparto' });
    expect(r.n).toBe(1);
    expect(r.event).toMatchObject({ ts: at(0), kind: 'decision', point: 'design-approve', weight: 'major', by: 'auto', task: 'reparto' });
    expect(readEvents(root)).toHaveLength(1);
    expect(readDecisionsDoc(root)).toMatchObject({ scope: 'reparto', count: 1, lastMajor: { n: 1 } });
  });
  it('takes the task flag over the data, and the run of an active execution when the data has none', () => {
    expect(addDecision(root, { ...INPUT, task: 'other' }, { ts: at(0), task: 'T1', runId: 'r9' }).event).toMatchObject({ task: 'T1', runId: 'r9' });
    expect(addDecision(root, { ...INPUT, runId: 'mine' }, { ts: at(1), runId: 'r9' }).event.runId).toBe('mine');
  });
  it('counts old decision events in the numbering', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    appendFileSync(path.join(root, '.forge', 'ledger.jsonl'), JSON.stringify({ ts: at(0), kind: 'decision', what: 'takeover', previous: 'a', by: 'b' }) + '\n');
    expect(addDecision(root, INPUT, { ts: at(1) }).n).toBe(2);
  });
  it('refuses bad input and writes nothing', () => {
    for (const bad of [{ ...INPUT, point: 'nope' }, { ...INPUT, by: 'robot' }, { ...INPUT, extra: 1 }, { ...INPUT, what: ' ' },
      { ...INPUT, undo: { type: 'branch-discard', branch: '-rf' } }, { ...INPUT, alternatives: Array(11).fill('x') }, { ...INPUT, task: '../x' }, null, [1]]) {
      expect(() => addDecision(root, bad, { ts: at(0) })).toThrow(DecisionInputError);
    }
    expect(readEvents(root)).toEqual([]);
    expect(existsSync(decisionsFile(root))).toBe(false);
  });
  it('keeps the summary when the user answers', () => {
    addDecision(root, INPUT, { ts: at(0), task: 'reparto' });
    addDecision(root, { ...INPUT, point: 'route', by: 'user' }, { ts: at(1), task: 'reparto' });
    expect(readDecisionsDoc(root)).toMatchObject({ count: 1 });
  });
  it('cleans and clips the text it stores', () => {
    const r = addDecision(root, { ...INPUT, what: `x\u0007${'y'.repeat(300)}` }, { ts: at(0) });
    expect(String(r.event.what)).toHaveLength(200);
    expect(String(r.event.what).startsWith('x y')).toBe(true);
  });
});

describe('listDecisions', () => {
  beforeEach(() => {
    addDecision(root, { ...INPUT, point: 'ruling', by: 'unattended' }, { ts: at(0), task: 'orders-1' });
    addDecision(root, { ...INPUT, point: 'route', by: 'user' }, { ts: at(1), task: 'orders' });
    addDecision(root, INPUT, { ts: at(2), task: 'T001', runId: 'r1' });
  });
  it('defaults to the scope of the summary', () => {
    expect(listDecisions(root, {}).map(d => d.n)).toEqual([3]);
  });
  it('filters by task (with its briefs), run, since and automatic only', () => {
    expect(listDecisions(root, { task: 'orders' }).map(d => d.n)).toEqual([1, 2]);
    expect(listDecisions(root, { task: 'orders', auto: true }).map(d => d.n)).toEqual([1]);
    expect(listDecisions(root, { run: 'r1' }).map(d => d.n)).toEqual([3]);
    expect(listDecisions(root, { since: at(1) }).map(d => d.n)).toEqual([2, 3]);
    expect(listDecisions(root, { all: true })).toHaveLength(3);
  });
  it("--task takes the task of its project, as the ledger attributes it: another plan's task of the same id is not it (carry 4)", () => {
    // Plan web's T001 was decided on first; then plan shop triaged its own T001, and decided on it.
    withEventContext({ project: 'web' }, () => addDecision(root, INPUT, { ts: at(3), task: 'T001' }));
    appendEvent(root, { ts: at(4), kind: 'triage', task: 'T001', path: 'large', project: 'shop' });
    addDecision(root, INPUT, { ts: at(5), task: 'T001-1' });
    expect(listDecisions(root, { task: 'T001' }).map(d => d.n)).toEqual([5]);
    expect(listDecisions(root, { task: 'T001', project: 'web' }).map(d => d.n)).toEqual([4]);
    // The numbering stays the ledger's; decisions of no project keep matching a task of none.
    expect(listDecisions(root, { task: 'orders' }).map(d => d.n)).toEqual([1, 2]);
    const io: Io = { cwd: root, now: () => new Date(at(9)) };
    expect(JSON.parse(run(['decision', 'list', '--task', 'T001', '--project', 'web'], io).stdout).map((d: { n: number }) => d.n)).toEqual([4]);
  });
  it('is empty with no decision', () => {
    expect(listDecisions(mkdtempSync(path.join(tmpdir(), 'forge-dec-')), {})).toEqual([]);
  });
});

describe('renderDecisionsMd', () => {
  it('lists each decision with what was chosen, why and how to undo it, in es and en', () => {
    addDecision(root, { ...INPUT, alternatives: ['another round'], revert: '/forge:decisions revert 1' }, { ts: at(0), task: 'reparto' });
    const list = allDecisions(root);
    const es = renderDecisionsMd(list, 'reparto', 'es');
    expect(es).toContain('# Decisiones automáticas · reparto');
    expect(es).toContain('## 1. diseño aprobado (v4)');
    expect(es).toContain('- **Elegido:** approve');
    expect(es).toContain('- **Alternativas:** another round');
    expect(es).toContain('- **Cómo revertir:** /forge:decisions revert 1');
    expect(renderDecisionsMd(list, 'reparto', 'en-GB')).toContain('# Automatic decisions · reparto');
    expect(renderDecisionsMd([{ ...list[0], revert: null, alternatives: [] }], 'reparto', 'en')).toContain('- **How to undo:** cannot be undone automatically');
    const none = { ...list[0], revert: null, undo: { type: 'none' as const, reason: 'el ratchet solo sube' } };
    expect(renderDecisionsMd([none], 'reparto', 'es')).toContain('- **Cómo revertir:** no se puede revertir de forma automática: el ratchet solo sube');
  });
});

describe('forge decision CLI', () => {
  let io: Io;
  beforeEach(() => { io = { cwd: root, now: () => new Date(at(0)) }; });
  const write = (name: string, v: unknown) => { writeFileSync(path.join(root, name), typeof v === 'string' ? v : JSON.stringify(v)); return name; };

  it('add prints the numbered event; list and show read it back', () => {
    const r = run(['decision', 'add', '--data-file', write('d.json', INPUT), '--task', 'reparto'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ n: 1, kind: 'decision', ts: at(0), task: 'reparto', weight: 'major' });
    expect(JSON.parse(run(['decision', 'list'], io).stdout).map((d: { n: number }) => d.n)).toEqual([1]);
    expect(JSON.parse(run(['decision', 'show', '1'], io).stdout)).toMatchObject({ n: 1, point: 'design-approve', undo: { type: 'design-reopen', project: 'reparto' } });
    expect(run(['decision', 'show', '2'], io).code).toBe(2);
    expect(run(['decision', 'show', 'x'], io).code).toBe(2);
  });
  it('add takes the run of the active execution', () => {
    saveExecution(root, {
      runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
      coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: at(0), lastStepAt: null,
      lastBlockStep: null, sleepUntil: null, tasks: {},
    });
    expect(JSON.parse(run(['decision', 'add', '--data-file', write('d.json', INPUT)], io).stdout).runId).toBe('r1');
  });
  it('add refuses bad input with exit 2 and writes nothing', () => {
    expect(run(['decision', 'add'], io).code).toBe(2);
    expect(run(['decision', 'add', '--data-file', write('bad.json', '{"point":')], io).code).toBe(2);
    expect(run(['decision', 'add', '--data-file', write('arr.json', [1])], io).code).toBe(2);
    const r = run(['decision', 'add', '--data-file', write('extra.json', { ...INPUT, extra: true })], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('extra');
    expect(run(['decision', 'add', '--data-file', write('d.json', INPUT), '--task', 'a/b'], io).code).toBe(2);
    expect(readEvents(root)).toEqual([]);
    expect(existsSync(decisionsFile(root))).toBe(false);
  });
  it('list checks --since', () => {
    expect(run(['decision', 'list', '--since', 'yesterday'], io).code).toBe(2);
  });
  it('md writes the automatic decisions of a scope under a safe file name, and nothing without them', () => {
    run(['decision', 'add', '--data-file', write('d.json', INPUT), '--task', 'ns:task'], io);
    const r = JSON.parse(run(['decision', 'md', '--scope', 'ns:task', '--locale', 'es'], io).stdout);
    expect(r).toMatchObject({ written: true, scope: 'ns:task', count: 1 });
    expect(r.path).toBe(path.join(root, 'docs', 'forge', 'decisions', 'ns-task.md'));
    expect(readFileSync(r.path, 'utf8')).toContain('# Decisiones automáticas · ns:task');
    expect(JSON.parse(run(['decision', 'md', '--scope', 'nothing'], io).stdout)).toEqual({ written: false, scope: 'nothing', count: 0 });
    expect(run(['decision', 'md'], io).code).toBe(2);
    expect(run(['decision', 'md', '--scope', 'ns:task', '--out', 'x.txt'], io).code).toBe(2);
  });
  it('a session in a linked worktree (a run member) records and reads decisions in the main checkout', () => {
    const main = mkdtempSync(path.join(tmpdir(), 'forge-dec-main-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: main, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(main, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'a');
    const wt = path.join(main, '.claude', 'worktrees', 'task-T1');
    git('worktree', 'add', '-q', '-b', 'task/T1', wt);
    writeFileSync(path.join(wt, 'd.json'), JSON.stringify(INPUT));
    const inWt: Io = { cwd: wt, now: () => new Date(at(0)) };
    expect(run(['decision', 'add', '--data-file', 'd.json', '--task', 'T1'], inWt).code).toBe(0);
    expect(readEvents(main).filter(e => e.kind === 'decision')).toHaveLength(1);
    expect(existsSync(path.join(wt, '.forge', 'ledger.jsonl'))).toBe(false);
    expect(readDecisionsDoc(main)).toMatchObject({ scope: 'T1', count: 1 });
    expect(JSON.parse(run(['decision', 'list', '--task', 'T1'], { cwd: main, now: () => new Date(at(1)) }).stdout)).toHaveLength(1);
    expect(JSON.parse(run(['decision', 'show', '1'], inWt).stdout)).toMatchObject({ n: 1, task: 'T1' });
    // The file of a project without a roadmap goes with the work, in the worktree.
    expect(JSON.parse(run(['decision', 'md', '--scope', 'T1'], inWt).stdout).path).toBe(path.join(wt, 'docs', 'forge', 'decisions', 'T1.md'));
  });
  it('an unknown subcommand prints its usage', () => {
    const r = run(['decision', 'nope'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage: forge decision');
  });
});

describe('decision add --session publishes the decision note (H-17)', () => {
  const cli = (args: string[]) => run(args, { cwd: root, now: () => new Date(at(0)), env: {}, rand: () => 0 });
  it('prints the note of the decision, and the update that closes the question it resolves', () => {
    writeFileSync(path.join(root, 'd.json'), JSON.stringify({ ...INPUT, alternatives: ['wait'], revert: 'reopen the design', resolves: 'q-20261013T090000000Z-main-0000' }));
    const r = JSON.parse(cli(['decision', 'add', '--data-file', 'd.json', '--task', 'T5-2', '--session', 'main']).stdout);
    const text = 'diseño aprobado (v4) → approve: ronda 2 sin critical';
    // Carry 6, re-review m3: the note's id comes from the decision's own event (its time, the session and a digest of the
    // decision), never from chance.
    const id = r.publish[0].doc_id as string;
    expect(id).toMatch(/^20261013T100000000Z-main-d[0-9a-f]{10}$/);
    expect(r.publish).toEqual([
      { op: 'set', collection: 'notes', doc_id: id, data: { ts: at(0), type: 'decision', author: 'session:main', text, taskId: 'T5',
        decision: { point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', alternatives: ['wait'], why: 'ronda 2 sin critical', revert: 'reopen the design', auto: true } } },
      { op: 'update', collection: 'notes', doc_id: 'q-20261013T090000000Z-main-0000', data: { answer: text, answeredBy: 'session:main', answeredAt: at(0), answeredByNote: id } },
    ]);
    expect(readEvents(root).at(-1)).not.toHaveProperty('resolves');
  });
  it('without --session there is no publish; a bad resolves or --session is exit 2 and writes nothing', () => {
    writeFileSync(path.join(root, 'd.json'), JSON.stringify(INPUT));
    expect(JSON.parse(cli(['decision', 'add', '--data-file', 'd.json']).stdout)).not.toHaveProperty('publish');
    writeFileSync(path.join(root, 'bad.json'), JSON.stringify({ ...INPUT, resolves: '../notes/x' }));
    const before = readEvents(root).length;
    expect(cli(['decision', 'add', '--data-file', 'bad.json', '--session', 'main']).code).toBe(2);
    expect(cli(['decision', 'add', '--data-file', 'd.json', '--session', 'a b']).code).toBe(2);
    // Carry 6: a resolves that is not a string, or one without --session (nothing would close the question), is exit 2 too.
    writeFileSync(path.join(root, 'num.json'), JSON.stringify({ ...INPUT, resolves: 7 }));
    expect(cli(['decision', 'add', '--data-file', 'num.json', '--session', 'main']).code).toBe(2);
    writeFileSync(path.join(root, 'q.json'), JSON.stringify({ ...INPUT, resolves: 'q-1' }));
    const lone = cli(['decision', 'add', '--data-file', 'q.json']);
    expect(lone.code).toBe(2);
    expect(lone.stderr).toContain('--session');
    expect(readEvents(root)).toHaveLength(before);
  });
  it('re-review m3: a re-run of the same decision gives the same note id and the same write, never a second note; another decision its own', () => {
    writeFileSync(path.join(root, 'd.json'), JSON.stringify(INPUT));
    const add = (file: string, min: number, rand: number) =>
      JSON.parse(run(['decision', 'add', '--data-file', file, '--session', 'main'], { cwd: root, now: () => new Date(at(min)), env: {}, rand: () => rand }).stdout);
    const first = add('d.json', 0, 0.1);
    const again = add('d.json', 1, 0.9);
    expect(again.n).toBe(first.n);
    expect(again.publish).toEqual(first.publish);
    expect(readEvents(root).filter(e => e.kind === 'decision')).toHaveLength(1);
    // Another decision is its own note.
    writeFileSync(path.join(root, 'd2.json'), JSON.stringify({ ...INPUT, why: 'otra razón' }));
    const other = add('d2.json', 2, 0.1);
    expect(other.n).toBe(2);
    expect(other.publish[0].doc_id).not.toBe(first.publish[0].doc_id);
    // The same decision taken again later than the re-run window is a new one.
    const later = add('d.json', 15, 0.1);
    expect(later.n).toBe(3);
    expect(later.publish[0].doc_id).not.toBe(first.publish[0].doc_id);
  });
  it('carry 6: a user decision is not auto, one without a task has no taskId, and the text is clean and never splits a character', () => {
    const rlo = String.fromCharCode(0x202e), face = String.fromCodePoint(0x1f600);
    writeFileSync(path.join(root, 'u.json'), JSON.stringify({ ...INPUT, by: 'user', what: `a${rlo}b${String.fromCharCode(7)}c`, why: face.repeat(600) }));
    const note = JSON.parse(cli(['decision', 'add', '--data-file', 'u.json', '--session', 'main']).stdout).publish[0].data;
    expect(note.decision.auto).toBe(false);
    expect(note).not.toHaveProperty('taskId');
    expect(note.text.startsWith('a b c → approve: ')).toBe(true);
    expect(note.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(Array.from(note.decision.why)).toHaveLength(500);
  });
  it('carry 6: with --db, a question already answered is not answered again: the update is left out and said', () => {
    mkdirSync(path.join(root, 'db', 'notes'), { recursive: true });
    writeFileSync(path.join(root, 'db', 'notes', 'q-1.json'), JSON.stringify({ ts: at(-5), type: 'question', author: 'session:x', text: '?', answer: 'done already', answeredBy: 'user:me' }));
    writeFileSync(path.join(root, 'db', 'notes', 'q-2.json'), JSON.stringify({ ts: at(-5), type: 'question', author: 'session:x', text: '?' }));
    const add = (q: string) => { writeFileSync(path.join(root, `${q}.json`), JSON.stringify({ ...INPUT, resolves: q })); return JSON.parse(cli(['decision', 'add', '--data-file', `${q}.json`, '--session', 'main', '--db', 'db']).stdout); };
    const answered = add('q-1');
    expect(answered.publish).toHaveLength(1);
    expect(answered.resolvesRefused).toContain('q-1');
    const open = add('q-2');
    expect(open.publish.map((w: { doc_id: string }) => w.doc_id)).toContain('q-2');
    expect(open).not.toHaveProperty('resolvesRefused');
  });
});
