// w8 W4: the steps of /waypoint:work that the CLI groups, so a task costs fewer calls and the session writes fewer files:
// `next --notes --seat-dir` reads the notes and keeps lastNoteTs, `next --check-sync` says when the main checkout has to
// sync first, `done --metrics-version --seat-dir` pins meta/metrics, empties the seat's pending commits and gives the
// plan's progress, and `commit-info --event` prints the commit event and drops its pending lines. The guarantees stay:
// every write it prints is pinned (or creates its document), and a batch is sent whole.
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, type Io } from '../src/cli/run.js';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs, planHash } from '../src/lib/sync.js';
import { computeMetrics } from '../src/lib/metrics.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const FIXTURE = new URL('./fixtures/plan.yaml', import.meta.url);
let dir: string;
let io: Io;
const NOW = '2026-10-11T10:00:00.000Z';
const cli = (...a: string[]) => run(a, { ...io, env: {} });
const docsAt = (sub: string, docs: Record<string, unknown>) => {
  const d = path.join(dir, sub);
  mkdirSync(d, { recursive: true });
  for (const [id, body] of Object.entries(docs)) writeFileSync(path.join(d, `${id}.json`), JSON.stringify(body));
  return sub;
};
const plan = () => parsePlan(readFileSync(path.join(dir, 'plan.yaml'), 'utf8'));
/** The runtime plan as the roadmap holds it (meta and plan listings), synced with plan.yaml unless `hash` says otherwise. */
const dbOf = (hash?: string) => {
  const { meta, phases } = buildDocs(plan(), NOW);
  docsAt('db/meta', { project: { ...meta, ...(hash ? { planHash: hash } : {}) } });
  docsAt('db/plan', Object.fromEntries(phases.map(p => [p.id, p])));
  docsAt('db/state', {});
  docsAt('db/sessions', {});
  docsAt('db/messages', {});
  return 'db';
};
const SEAT = '.waypoint/demo-shop';
const seatFile = (name: string) => path.join(dir, SEAT, name);
const sessionJson = () => JSON.parse(readFileSync(seatFile('session.json'), 'utf8')) as Record<string, unknown>;

beforeEach(() => {
  dir = tmp('wp-work-');
  copyFileSync(FIXTURE, path.join(dir, 'plan.yaml'));
  io = { cwd: dir, now: () => new Date(NOW), rand: () => 0, assetsDir: dir };
  mkdirSync(path.join(dir, SEAT), { recursive: true });
  writeFileSync(seatFile('session.json'), JSON.stringify({ plan: 'plan.yaml', sessionId: 'be', track: 'backend' }));
});

describe('next --notes --seat-dir: the notes of a pick, and lastNoteTs kept by the CLI (w8 W4)', () => {
  const next = (...extra: string[]) => {
    const r = cli('next', 'plan.yaml', '--db', 'db', '--states', 'db/state', '--sessions', 'db/sessions', '--messages', 'db/messages', '--session', 'be', '--track', 'backend', ...extra);
    expect(r.code, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as Record<string, unknown> & { notes?: { notes: { id: string }[]; latest: string | null; say: string[]; mentions: string[][] } };
  };
  const note = (min: number, text: string, author = 'user:u1') => ({ ts: new Date(Date.parse(NOW) - min * 60000).toISOString(), type: 'idea', author, authorName: 'Ana', text });
  it('gives the notes with the pick, stores latest as lastNoteTs in the seat\'s session.json, and the next pick gives only newer ones', () => {
    dbOf();
    docsAt('db/notes', { n1: note(30, 'Mira T001 antes'), n2: note(20, 'una nota de sesión', 'session:ui') });
    const first = next('--notes', 'db/notes', '--seat-dir', SEAT);
    expect(first).toMatchObject({ task: { id: 'T001' }, multi: false });
    expect(first.notes).toMatchObject({ latest: note(20, '').ts, say: ['Nota de Ana en el roadmap: «Mira T001 antes»'], mentions: [['T001']] });
    expect(sessionJson()).toEqual({ plan: 'plan.yaml', sessionId: 'be', track: 'backend', lastNoteTs: note(20, '').ts });
    docsAt('db/notes', { n3: note(5, 'Otra más') });
    expect(next('--notes', 'db/notes', '--seat-dir', SEAT).notes).toMatchObject({ say: ['Nota de Ana en el roadmap: «Otra más»'] });
    expect(next('--notes', 'db/notes', '--seat-dir', SEAT).notes).toMatchObject({ notes: [], say: [] });
    expect(sessionJson().lastNoteTs).toBe(note(5, '').ts);
  });
  it('on a first join keeps only the five most recent of the notes a person wrote', () => {
    dbOf();
    docsAt('db/notes', Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`n${i}`, note(70 - i * 10, `nota ${i}`)])));
    const r = next('--notes', 'db/notes', '--seat-dir', SEAT);
    expect(r.notes!.say).toEqual([2, 3, 4, 5, 6].map(i => `Nota de Ana en el roadmap: «nota ${i}»`));
    expect(r.notes!.notes.map(n => n.id)).toEqual(['n2', 'n3', 'n4', 'n5', 'n6']);
  });
  it('without --notes it prints what it printed before; --notes without --seat-dir, or a seat with no session.json, is exit 2', () => {
    dbOf();
    expect(next()).not.toHaveProperty('notes');
    expect(cli('next', 'plan.yaml', '--db', 'db', '--session', 'be', '--notes', 'db/notes').code).toBe(2);
    expect(cli('next', 'plan.yaml', '--db', 'db', '--session', 'be', '--notes', 'db/notes', '--seat-dir', '.waypoint/none').code).toBe(2);
  });
});

describe('next --check-sync: the main checkout syncs first when the roadmap does not hold this plan (w8 W4)', () => {
  const next = (...extra: string[]) => cli('next', 'plan.yaml', '--db', 'db', '--states', 'db/state', '--sessions', 'db/sessions', '--session', 'be', ...extra);
  it('prints sync: true and picks nothing when meta/project is missing, its plan hash differs or the plan listing is empty', () => {
    dbOf();
    const synced = next('--check-sync');
    expect(synced.code, synced.stderr).toBe(0);
    expect(JSON.parse(synced.stdout)).toMatchObject({ task: { id: 'T001' } });
    expect(JSON.parse(synced.stdout)).not.toHaveProperty('sync');
    dbOf('another-hash');
    expect(JSON.parse(next('--check-sync').stdout)).toEqual({ sync: true, why: 'changed' });
    dbOf();
    writeFileSync(path.join(dir, 'db', 'meta', 'project.json'), '');
    expect(JSON.parse(next('--check-sync').stdout)).toEqual({ sync: true, why: 'missing' });
    dbOf();
    rmSync(path.join(dir, 'db', 'plan'), { recursive: true });
    expect(JSON.parse(next('--check-sync').stdout)).toEqual({ sync: true, why: 'missing' });
    expect(planHash(plan())).not.toBe('another-hash');
  });
  it('without --check-sync a missing plan cache still fails, as a session in a worktree reads it', () => {
    dbOf();
    writeFileSync(path.join(dir, 'db', 'meta', 'project.json'), '');
    expect(next().code).toBe(1);
  });
});

describe('done --metrics-version --seat-dir: the close of a task in fewer calls (w8 W4)', () => {
  const git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const init = () => { git('init', '-q'); git('add', 'plan.yaml'); git('commit', '-qm', 'T001: esquema'); };
  const done = (...extra: string[]) => cli('done', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--summary-file', 'summary.txt', ...extra);
  beforeEach(() => { writeFileSync(path.join(dir, 'summary.txt'), 'El esquema está aplicado.'); });
  it('pins meta/metrics to the listed version, empties the seat\'s pending commits and gives the plan\'s progress', () => {
    init(); dbOf();
    docsAt('db/state', { T001: { status: 'in_progress', owner: 'be' }, T003: { status: 'done' } });
    writeFileSync(seatFile('pending-commits.jsonl'), `${JSON.stringify({ sha: git('rev-parse', 'HEAD'), task: 'T001' })}\n`);
    const r = done('--metrics-version', '5', '--seat-dir', SEAT);
    expect(r.code, r.stderr).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.metrics).toMatchObject({ op: 'update', collection: 'meta', doc_id: 'metrics', if_version: 5 });
    expect(o.batch).toHaveLength(3);
    expect(readFileSync(seatFile('pending-commits.jsonl'), 'utf8')).toBe('');
    const m = computeMetrics(plan(), { T001: { status: 'done' }, T003: { status: 'done' } } as never, Date.parse(NOW));
    expect(o.progress).toEqual({ percent: m.percent, done: 2, total: m.total });
  });
  it('without the new flags it prints and touches what it did before: metrics unpinned, pending commits kept', () => {
    init(); dbOf();
    writeFileSync(seatFile('pending-commits.jsonl'), '{"sha":"abc1234"}\n');
    const o = JSON.parse(done().stdout);
    expect(o.metrics).not.toHaveProperty('if_version');
    expect(readFileSync(seatFile('pending-commits.jsonl'), 'utf8')).toBe('{"sha":"abc1234"}\n');
    expect(done('--metrics-version', '0').code).toBe(2);
    expect(done('--seat-dir', '.waypoint/none').code).toBe(2);
  });
});

describe('commit-info --event: the commit event of an intermediate commit, its pending lines dropped (w8 W4)', () => {
  const git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  it('prints the set of events/<EID> as the work skill composed it, and removes every pending line of that sha', () => {
    git('init', '-q'); git('add', 'plan.yaml'); git('commit', '-qm', 'T001: primera parte');
    const sha = git('rev-parse', 'HEAD');
    const line = (s: string) => `${JSON.stringify({ ts: NOW, task: 'T001', sha: s, command: 'git commit', session: 'c1', seat: 'be' })}\n`;
    writeFileSync(seatFile('pending-commits.jsonl'), line(sha) + line('0123456789abcdef0123456789abcdef01234567') + line(sha));
    const r = cli('commit-info', '--event', '--session', 'be', '--task', 'T001', '--seat-dir', SEAT);
    expect(r.code, r.stderr).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o).toMatchObject({ sha, title: 'T001: primera parte', del: 0 });
    expect(o.write).toEqual({ op: 'set', collection: 'events', doc_id: '20261011T100000000Z-be-0000',
      data: { ts: NOW, type: 'commit', sessionId: 'be', taskId: 'T001', text: 'T001: primera parte', sha, add: o.add, del: 0 } });
    expect(readFileSync(seatFile('pending-commits.jsonl'), 'utf8')).toBe(line('0123456789abcdef0123456789abcdef01234567'));
    // A rev still reads as before, with or without the event.
    expect(JSON.parse(cli('commit-info', sha).stdout)).toEqual({ sha, ts: o.ts, title: o.title, add: o.add, del: 0 });
    expect(JSON.parse(cli('commit-info', 'HEAD', '--event', '--session', 'be', '--task', 'T001').stdout).write.doc_id).toBe('20261011T100000000Z-be-0000');
  });
  it('--event needs the session and a plan task; --seat-dir needs a seat', () => {
    git('init', '-q'); git('add', 'plan.yaml'); git('commit', '-qm', 'x');
    for (const a of [['--event'], ['--event', '--session', 'be'], ['--event', '--task', 'T001'], ['--event', '--session', 'be', '--task', 'a b'],
      ['--event', '--session', 'be', '--task', 'T001', '--seat-dir', '.waypoint/none']]) {
      expect(cli('commit-info', ...a).code, a.join(' ')).toBe(2);
    }
    expect(existsSync(seatFile('pending-commits.jsonl'))).toBe(false);
  });
});
