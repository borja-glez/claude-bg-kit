import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, appendFileSync, existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  addDecision, allDecisions, decisionsFile, listDecisions, markPublished, publishedFile, publishedNs, readDecisionsDoc, renderDecisionsMd, shasOutside, DecisionInputError,
} from '../src/forge/decisions.js';
import { appendEvent, readEvents, withEventContext } from '../src/forge/ledger.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

let root: string;
beforeEach(() => { root = tmp('forge-dec-'); });
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
    expect(listDecisions(tmp('forge-dec-'), {})).toEqual([]);
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
    seedExecution(root, {
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
    const main = tmp('forge-dec-main-');
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
  it("add in a prepared profile's worktree takes that profile's runId before its run starts, and list --run finds it (T6B2-PRESTART-DECISIONS)", () => {
    const main = tmp('forge-dec-prep-');
    const git = (...a: string[]) => execFileSync('git', a, { cwd: main, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(main, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'a');
    const wt = path.join(main, '.claude', 'worktrees', 'spike-combo');
    git('worktree', 'add', '-q', '-b', 'forge/spike-combo', wt);
    const other = path.join(main, '.claude', 'worktrees', 'product-other');
    git('worktree', 'add', '-q', '-b', 'forge/product-other', other);
    writeFileSync(path.join(wt, 'd.json'), JSON.stringify(INPUT));
    writeFileSync(path.join(other, 'd.json'), JSON.stringify({ ...INPUT, what: 'not prepared' }));
    writeFileSync(path.join(main, 'd.json'), JSON.stringify({ ...INPUT, what: 'in main' }));
    mkdirSync(path.join(main, '.forge', 'autonomous', 'spike-combo'), { recursive: true });
    writeFileSync(path.join(main, '.forge', 'autonomous', 'spike-combo', 'start.json'), JSON.stringify({ startBranch: 'main', defaultBranch: null, at: at(0) }));
    const add = (cwd: string) => JSON.parse(run(['decision', 'add', '--data-file', 'd.json'], { cwd, now: () => new Date(at(0)), env: {} }).stdout);
    expect(add(wt).runId).toBe('spike-combo');
    expect(add(other).runId).toBeUndefined();
    expect(add(main).runId).toBeUndefined();
    const listed = JSON.parse(run(['decision', 'list', '--auto', '--run', 'spike-combo'], { cwd: main, now: () => new Date(at(1)), env: {} }).stdout);
    expect(listed.map((d: { what: string }) => d.what)).toEqual(['diseño aprobado (v4)']);
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

describe('undo.shas: the exact commits a revert undoes (K2-19)', () => {
  let io: Io;
  let base: string, mine: string, theirs: string, other: string;
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const commit = (f: string) => { writeFileSync(path.join(root, f), f); g('add', f); g('commit', '-qm', f); return g('rev-parse', 'HEAD'); };
  const add = (shas: unknown, cwd?: string) => {
    writeFileSync(path.join(root, 'd.json'), JSON.stringify({ ...INPUT, point: 'design-apply', undo: { type: 'git-revert', base, head: theirs, shas, ...(cwd ? { cwd } : {}) } }));
    return run(['decision', 'add', '--data-file', 'd.json'], io);
  };
  beforeEach(() => {
    io = { cwd: root, now: () => new Date(at(0)), env: {} };
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'a@b.c');
    g('config', 'user.name', 't');
    g('config', 'core.autocrlf', 'false');
    base = commit('a.txt');
    mine = commit('b.txt');
    // Another session's commit lands in the same range: the revert must not take it.
    theirs = commit('c.txt');
    g('checkout', '-q', '-b', 'side', base);
    other = commit('d.txt');
    g('checkout', '-q', 'main');
  });
  it('takes the shas of base..head, a short one included, and keeps them', () => {
    expect(add([mine, theirs.slice(0, 8)]).code).toBe(0);
    expect(JSON.parse(run(['decision', 'show', '1'], io).stdout).undo).toEqual({ type: 'git-revert', base, head: theirs, shas: [mine, theirs.slice(0, 8)] });
  });
  it('refuses a sha outside base..head, a repeated one or more than 50, and records nothing', () => {
    const outside = add([other]);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain(other);
    expect(add([mine, mine]).code).toBe(2);
    expect(add(Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(7, '0'))).code).toBe(2);
    expect(readEvents(root).filter(e => e.kind === 'decision')).toEqual([]);
  });
  it('refuses a cwd outside the main checkout, even a repo that holds the same commits', () => {
    const sibling = tmp('forge-sib-');
    execFileSync('git', ['clone', '-q', root, sibling], { stdio: 'ignore' });
    const r = add([mine], sibling);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('inside the main checkout');
    expect(add([mine], '..').code).toBe(2);
  });
  it('accepts a cwd inside the checkout and refuses one that does not exist', () => {
    mkdirSync(path.join(root, 'sub'));
    expect(add([mine], '.').code).toBe(0);
    expect(add([mine], 'sub').code).toBe(0);
    const gone = add([mine], 'nope');
    expect(gone.code).toBe(2);
    expect(gone.stderr).toContain('does not exist');
  });
  it('refuses a full sha and its short form as one commit named twice', () => {
    const r = add([mine, mine.slice(0, 9)]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('twice');
  });
  it('shasOutside counts a short sha that prefixes two range commits as outside', () => {
    const range = ['abc1234' + '0'.repeat(33), 'abc1235' + '0'.repeat(33), 'def5678' + '0'.repeat(33)];
    expect(shasOutside(['abc123', 'def5678', 'abc1234'], range)).toEqual(['abc123']);
  });
  it('the schema itself refuses more than 50 shas', () => {
    const shas = Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(7, '0'));
    expect(() => addDecision(root, { ...INPUT, point: 'design-apply', undo: { type: 'git-revert', base: 'abc1234', head: 'def5678', shas } }, { ts: at(0) })).toThrow(DecisionInputError);
  });
});

describe('decisions with why not and trade-offs (6b-1)', () => {
  const ALT = { option: 'redis', whyNot: 'one more service to run', tradeoffs: 'faster reads; another process' };
  it('decision add takes plain and structured alternatives and the chosen trade-offs, and publishes them', () => {
    writeFileSync(path.join(root, 'd.json'), JSON.stringify({ ...INPUT, alternatives: ['wait', ALT], tradeoffs: 'nothing new to run; slower' }));
    const r = JSON.parse(run(['decision', 'add', '--data-file', 'd.json', '--session', 'main'], { cwd: root, now: () => new Date(at(0)), env: {} }).stdout);
    expect(r.publish[0].data.decision).toMatchObject({ alternatives: ['wait', ALT], tradeoffs: 'nothing new to run; slower' });
    expect(JSON.parse(run(['decision', 'show', '1'], { cwd: root, now: () => new Date(at(0)), env: {} }).stdout)).toMatchObject({ alternatives: [{ option: 'wait' }, ALT] });
  });
  it('refuses an alternative object without option or with another key', () => {
    for (const alt of [{ whyNot: 'x' }, { option: 'a', cost: 3 }, { option: '' }]) {
      expect(() => addDecision(root, { ...INPUT, alternatives: [alt] }, { ts: at(0) }), JSON.stringify(alt)).toThrow(DecisionInputError);
    }
  });
  it('the decisions file lists each alternative with its why not and trade-offs when any has them', () => {
    addDecision(root, { ...INPUT, alternatives: ['wait', ALT], tradeoffs: 'simple' }, { ts: at(0), task: 'reparto' });
    const es = renderDecisionsMd(allDecisions(root), 'reparto', 'es');
    expect(es).toContain('- **Alternativas:**\n  - wait\n  - redis · Por qué no: one more service to run · Qué se gana y qué se pierde: faster reads; another process');
    expect(es).toContain('- **Qué se gana y qué se pierde:** simple');
    expect(renderDecisionsMd(allDecisions(root), 'reparto', 'en')).toContain('  - redis · Why not: one more service to run · Trade-offs: faster reads; another process');
  });
});

describe('decision publish (6b-2)', () => {
  const cli = (args: string[]) => JSON.parse(run(args, { cwd: root, now: () => new Date(at(5)), env: {} }).stdout);
  it('prints the notes of the automatic decisions not published yet, once', () => {
    addDecision(root, INPUT, { ts: at(0) });
    addDecision(root, { ...INPUT, what: 'otra', by: 'user' }, { ts: at(1) });
    writeFileSync(path.join(root, 'd.json'), JSON.stringify({ ...INPUT, what: 'tercera' }));
    cli(['decision', 'add', '--data-file', 'd.json', '--session', 'main']);
    const r = cli(['decision', 'publish', '--session', 'main', '--since', at(0)]);
    expect(r.published).toBe(1);
    expect(r.publish.map((w: { data: { decision: { what: string } } }) => w.data.decision.what)).toEqual(['diseño aprobado (v4)']);
    expect(cli(['decision', 'publish', '--session', 'main', '--since', at(0)])).toEqual({ published: 0, publish: [] });
  });
  it('needs --session and a date', () => {
    expect(run(['decision', 'publish', '--since', at(0)], { cwd: root, now: () => new Date(at(5)), env: {} }).code).toBe(2);
    expect(run(['decision', 'publish', '--session', 'main'], { cwd: root, now: () => new Date(at(5)), env: {} }).code).toBe(2);
  });
  it('--run publishes only the decisions of that run, and leaves the others for later (M-8)', () => {
    addDecision(root, INPUT, { ts: at(0), runId: 'spike-x' });
    addDecision(root, { ...INPUT, what: 'attended' }, { ts: at(1), runId: 'r1' });
    const r = cli(['decision', 'publish', '--session', 'main', '--since', at(0), '--run', 'spike-x']);
    expect(r.publish.map((w: { data: { decision: { what: string } } }) => w.data.decision.what)).toEqual(['diseño aprobado (v4)']);
    expect(cli(['decision', 'publish', '--session', 'main', '--since', at(0)]).publish.map((w: { data: { decision: { what: string } } }) => w.data.decision.what)).toEqual(['attended']);
    expect(run(['decision', 'publish', '--session', 'main', '--since', at(0), '--run', '../x'], { cwd: root, now: () => new Date(at(5)), env: {} }).code).toBe(2);
  });
  it('--run publishes every decision of that run whatever --since says; without --run, --since still applies (T6B2-PRESTART-DECISIONS)', () => {
    addDecision(root, INPUT, { ts: at(0), runId: 'spike-x' });
    addDecision(root, { ...INPUT, what: 'early, no run' }, { ts: at(0) });
    addDecision(root, { ...INPUT, what: 'later' }, { ts: at(3), runId: 'spike-x' });
    const whats = (r: { publish: { data: { decision: { what: string } } }[] }) => r.publish.map(w => w.data.decision.what);
    expect(whats(cli(['decision', 'publish', '--session', 'main', '--since', at(2), '--run', 'spike-x']))).toEqual(['diseño aprobado (v4)', 'later']);
    expect(whats(cli(['decision', 'publish', '--session', 'main', '--since', at(2)]))).toEqual([]);
    expect(whats(cli(['decision', 'publish', '--session', 'main', '--since', at(0)]))).toEqual(['early, no run']);
  });
  it('marks under their own lock: one a dead command left is taken over, and none stays after (m-7)', () => {
    addDecision(root, INPUT, { ts: at(0) });
    const lock = `${publishedFile(root)}.lock`;
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(cli(['decision', 'publish', '--session', 'main', '--since', at(0)]).published).toBe(1);
    expect(existsSync(lock)).toBe(false);
    markPublished(root, [7]);
    expect([...publishedNs(root)]).toEqual([1, 7]);
    expect(existsSync(lock)).toBe(false);
  });
});
