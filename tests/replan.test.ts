import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { applyReplan, normalizeOps, ReplanError, MAX_OPS } from '../src/lib/replan.js';
import { parsePlan } from '../src/lib/plan.js';
import { planLite } from '../src/lib/plan-lite.js';
import { buildSyncWrites } from '../src/lib/sync.js';
import { proposalToTask } from '../src/forge/to-task.js';
import { PLAN_HISTORY_MAX } from '../src/lib/types.js';
import type { ProposalDoc } from '../src/lib/proposals.js';
import { run, type Io } from '../src/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const FIXTURE = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');
const AT = '2026-10-22T10:00:00.000Z';
const ops = (...o: unknown[]) => normalizeOps({ ops: o }).ops;
const bad = (o: unknown[]) => {
  try { applyReplan(FIXTURE, ops(...o), 'x', AT); return []; } catch (e) { expect(e).toBeInstanceOf(ReplanError); return (e as ReplanError).issues; }
};
// m-2: an anchor and an alias, which a reorder could put before its anchor.
const ALIAS = FIXTURE.replace('zones: ["src/db/**"]', 'zones: &z ["src/db/**"]').replace('zones: ["src/api/orders/**"]', 'zones: *z');
// m-5: two versions, F1 in the first and F2 in the second.
const TWO_VERSIONS = FIXTURE.replace('    phases: [F1, F2]', '    phases: [F1]\n  - id: "0.2"\n    phases: [F2]');
const proposal = (): ProposalDoc & { id: string } => ({
  id: 'p20261022100000abcd', ts: '', category: 'feature', risk: 'low', title: 'Otra idea', rationale: 'r', evidence: '', pillar: 'p', status: 'approved', source: 'scout', author: 'a',
});

describe('applyReplan', () => {
  it('adds a phase after another, moves tasks into it and reorders, never renumbering, with one history entry', () => {
    const r = applyReplan(FIXTURE, ops(
      { op: 'add-phase', id: 'F3', name: 'Pulido', goal: 'lo que pide un producto serio', after: 'F1' },
      { op: 'move', task: 'T006', phase: 'F3' },
      { op: 'order-tasks', phase: 'F1', tasks: ['T003', 'T001', 'T002'] },
    ), 'la revisión de F1 pide pulir antes de cobrar', AT);
    const p = parsePlan(r.text);
    expect(p.phases.map(f => f.id)).toEqual(['F1', 'F3', 'F2']);
    expect(p.versions[0].phases).toEqual(['F1', 'F3', 'F2']);
    expect(p.tasks.map(t => t.id)).toEqual(['T003', 'T001', 'T002', 'T004', 'T005', 'T006']);
    expect(p.tasks.find(t => t.id === 'T006')?.phase).toBe('F3');
    expect(r.changes).toEqual(['+F3 Pulido', 'T006: F2 → F3', 'F1: T003, T001, T002']);
    expect(p.history).toEqual([{ at: AT, why: 'la revisión de F1 pide pulir antes de cobrar', changes: r.changes }]);
  });
  it('reorders phases, edits a task and retires one nothing depends on', () => {
    const r = applyReplan(FIXTURE, ops(
      { op: 'order-phases', phases: ['F2', 'F1'] }, { op: 'edit', task: 'T005', done_when: 'un pago de prueba de punta a punta', estimate_min: 45 },
      { op: 'retire', task: 'T006', why: 'el proveedor ya envía el email' },
    ), 'x', AT);
    const p = parsePlan(r.text);
    expect(p.phases.map(f => f.id)).toEqual(['F2', 'F1']);
    expect(p.versions[0].phases).toEqual(['F2', 'F1']);
    expect(p.tasks.find(t => t.id === 'T005')).toMatchObject({ done_when: 'un pago de prueba de punta a punta', estimate_min: 45 });
    expect(p.tasks.some(t => t.id === 'T006')).toBe(false);
    expect(r.changes).toEqual(['phases: F2, F1', 'T005: done_when, estimate_min', '−T006 (el proveedor ya envía el email)']);
  });
  it('refuses what would break the plan, and says each problem', () => {
    expect(bad([{ op: 'move', task: 'T001', phase: 'F9' }]).join()).toContain('F9');
    expect(bad([{ op: 'retire', task: 'T004', why: 'x' }]).join()).toContain('T004');
    expect(bad([{ op: 'order-phases', phases: ['F1'] }]).length).toBeGreaterThan(0);
    expect(bad([{ op: 'edit', task: 'T001', depends_on: ['T005'] }]).join()).toContain('cycle');
    expect(bad([{ op: 'add-phase', id: 'F1', name: 'otra' }]).join()).toContain('F1');
    expect(bad([{ op: 'move', task: 'T099', phase: 'F1' }]).join()).toContain('T099');
    // A list of the tasks of a phase with one missing, one of another phase and one twice: each is said.
    const order = bad([{ op: 'order-tasks', phase: 'F1', tasks: ['T001', 'T001', 'T004'] }]).join();
    for (const s of ['T002', 'T003', 'T004', 'twice']) expect(order).toContain(s);
    // Every problem of the batch, not only the first.
    expect(bad([{ op: 'move', task: 'T099', phase: 'F1' }, { op: 'edit-phase', id: 'F7', name: 'x' }])).toHaveLength(2);
    // A task retired earlier in the batch is gone for the operations after it.
    expect(bad([{ op: 'retire', task: 'T006', why: 'x' }, { op: 'edit', task: 'T006', title: 'otra' }]).join()).toContain('T006');
  });
  it('checks a retire against the plan after every operation: an edit of the same batch can lift the dependency', () => {
    const r = applyReplan(FIXTURE, ops(
      { op: 'retire', task: 'T004', why: 'la pasarela la da el proveedor' },
      { op: 'edit', task: 'T005', depends_on: ['T003'] }, { op: 'edit', task: 'T006', depends_on: [] },
    ), 'x', AT);
    const p = parsePlan(r.text);
    expect(p.tasks.map(t => t.id)).toEqual(['T001', 'T002', 'T003', 'T005', 'T006']);
    expect(p.tasks.find(t => t.id === 'T006')?.depends_on).toEqual([]);
  });
  it(`keeps the last ${PLAN_HISTORY_MAX.entries} history entries`, () => {
    let text = FIXTURE;
    for (let i = 0; i < PLAN_HISTORY_MAX.entries + 2; i++) text = applyReplan(text, ops({ op: 'order-phases', phases: i % 2 ? ['F1', 'F2'] : ['F2', 'F1'] }), `r${i}`, AT).text;
    const h = parsePlan(text).history!;
    expect(h).toHaveLength(PLAN_HISTORY_MAX.entries);
    expect(h[0].why).toBe('r2');
    expect(h.at(-1)?.why).toBe(`r${PLAN_HISTORY_MAX.entries + 1}`);
  });
  it('L-2: names every change line, an edit of a phase too', () => {
    const r = applyReplan(FIXTURE, ops(
      { op: 'edit-phase', id: 'F2', name: 'Cobro', goal: 'cobrar de verdad', plan_status: 'committed' },
      { op: 'order-tasks', phase: 'F2', tasks: ['T006', 'T004', 'T005'] },
    ), 'x', AT);
    expect(r.changes).toEqual(['F2: name, goal, plan_status', 'F2: T006, T004, T005']);
    expect(parsePlan(r.text).phases[1]).toEqual({ id: 'F2', name: 'Cobro', plan_status: 'committed', goal: 'cobrar de verdad' });
  });
  it('M-1: clips the why and the change lines with clean, never refusing for length', () => {
    const long = applyReplan(FIXTURE, ops({ op: 'move', task: 'T003', phase: 'F2' }), `la revisión\nde F1 ${'x'.repeat(2000)}`, AT);
    const why = parsePlan(long.text).history![0].why;
    expect(why).toHaveLength(PLAN_HISTORY_MAX.why);
    expect(why.startsWith('la revisión de F1 x')).toBe(true);
    // Characters outside the BMP count twice in the schema's length: the clip keeps whole ones and still fits.
    const face = String.fromCodePoint(0x1f600);
    const astral = parsePlan(applyReplan(FIXTURE, ops({ op: 'move', task: 'T003', phase: 'F2' }), face.repeat(400), AT).text).history![0].why;
    expect(astral.length).toBeLessThanOrEqual(PLAN_HISTORY_MAX.why);
    expect(Array.from(astral).every(c => c === face)).toBe(true);
    const retire = applyReplan(FIXTURE, ops({ op: 'retire', task: 'T006', why: 'y'.repeat(500) }), 'x', AT);
    expect(retire.changes[0].startsWith('−T006 (yyy')).toBe(true);
    expect(retire.changes[0].endsWith('y)')).toBe(true);
    expect(retire.changes[0]).toHaveLength(PLAN_HISTORY_MAX.change);
    expect(parsePlan(retire.text).history![0].changes).toEqual(retire.changes);
  });
  it(`M-2: a history entry keeps ${PLAN_HISTORY_MAX.changes} change lines, and the result gives all of them`, () => {
    const many = Array.from({ length: PLAN_HISTORY_MAX.changes + 1 }, (_, i) => ({ op: 'order-phases', phases: i % 2 ? ['F1', 'F2'] : ['F2', 'F1'] }));
    const r = applyReplan(FIXTURE, ops(...many), 'x', AT);
    expect(r.changes).toHaveLength(PLAN_HISTORY_MAX.changes + 1);
    const entry = parsePlan(r.text).history![0].changes;
    expect(entry).toHaveLength(PLAN_HISTORY_MAX.changes);
    expect(entry.slice(0, -1)).toEqual(r.changes.slice(0, PLAN_HISTORY_MAX.changes - 1));
    expect(entry.at(-1)).toBe('… 2 more');
  });
  it('keeps the comments, the quoting and the order of everything it does not change', () => {
    const commented = FIXTURE.replace('phases:\n  - { id: F1', '# the base first\nphases:\n  - { id: F1').replace('  - id: T004\n', '  # the payment\n  - id: T004\n');
    const r = applyReplan(commented, ops({ op: 'order-phases', phases: ['F2', 'F1'] }, { op: 'move', task: 'T004', phase: 'F1' }), 'x', AT);
    expect(r.text).toContain('# the base first\nphases:\n');
    expect(r.text).toContain('  # the payment\n  - id: T004\n');
    expect(r.text.startsWith('project: demo-shop\nlocale: es\nversion: "0.1"\n')).toBe(true);
    // m-6: the meaning, not the yaml library's padding: the zone keeps its quotes, and the phases stay one-line maps.
    expect(r.text).toMatch(/^ {4}zones: \[\s*"src\/db\/\*\*"\s*\]$/m);
    expect(r.text).toMatch(/^ {2}- \{\s*id: F2, name: Checkout, plan_status: provisional\s*\}\n {2}- \{\s*id: F1, name: Base, plan_status: committed\s*\}$/m);
  });
  it('m-3: keeps the line endings of the file: a CRLF plan stays CRLF', () => {
    const crlf = FIXTURE.replace(/\n/g, '\r\n');
    const r = applyReplan(crlf, ops({ op: 'move', task: 'T003', phase: 'F2' }), 'x', AT);
    expect(r.text).toContain('\r\n');
    expect(r.text).not.toMatch(/[^\r]\n/);
    expect(parsePlan(r.text).tasks.find(t => t.id === 'T003')?.phase).toBe('F2');
  });
  it('m-5: on a plan with two versions, a new phase joins the version of `after`, else the last one, and each version is reordered', () => {
    const after = parsePlan(applyReplan(TWO_VERSIONS, ops({ op: 'add-phase', id: 'F3', name: 'Tres', after: 'F1' }), 'x', AT).text);
    expect(after.versions.map(v => v.phases)).toEqual([['F1', 'F3'], ['F2']]);
    const last = parsePlan(applyReplan(TWO_VERSIONS, ops({ op: 'add-phase', id: 'F3', name: 'Tres' }), 'x', AT).text);
    expect(last.phases.map(f => f.id)).toEqual(['F1', 'F2', 'F3']);
    expect(last.versions.map(v => v.phases)).toEqual([['F1'], ['F2', 'F3']]);
    const ordered = parsePlan(applyReplan(TWO_VERSIONS, ops({ op: 'add-phase', id: 'F3', name: 'Tres', after: 'F1' }, { op: 'order-phases', phases: ['F2', 'F3', 'F1'] }), 'x', AT).text);
    expect(ordered.phases.map(f => f.id)).toEqual(['F2', 'F3', 'F1']);
    expect(ordered.versions.map(v => v.phases)).toEqual([['F3', 'F1'], ['F2']]);
  });
  it('m-1: an operation that changes nothing gives no line, and a batch with no real change gives the text as it was', () => {
    const same = ops(
      { op: 'order-phases', phases: ['F1', 'F2'] }, { op: 'order-tasks', phase: 'F1', tasks: ['T001', 'T002', 'T003'] },
      { op: 'edit', task: 'T001', title: 'Esquema de pedidos', estimate_min: 20 }, { op: 'edit', task: 'T002', depends_on: ['T001'] },
      { op: 'edit', task: 'T003', depends_on: [] }, { op: 'edit-phase', id: 'F1', name: 'Base', plan_status: 'committed' },
    );
    expect(applyReplan(FIXTURE, same, 'x', AT)).toEqual({ text: FIXTURE, changes: [] });
    // A move away and back: the plan is the same, so nothing is written and no entry is added.
    expect(applyReplan(FIXTURE, ops({ op: 'move', task: 'T003', phase: 'F2' }, { op: 'move', task: 'T003', phase: 'F1' }), 'x', AT)).toEqual({ text: FIXTURE, changes: [] });
    // Beside a real change, the same operations give no line.
    const mixed = applyReplan(FIXTURE, [...same, ...ops({ op: 'edit', task: 'T001', title: 'Esquema' })], 'x', AT);
    expect(mixed.changes).toEqual(['T001: title']);
    expect(parsePlan(mixed.text).history?.[0].changes).toEqual(['T001: title']);
  });
  it('m-2: refuses a plan with an alias, whatever the operation', () => {
    expect(parsePlan(ALIAS).tasks[1].zones).toEqual(['src/db/**']);
    for (const o of [[{ op: 'order-tasks', phase: 'F1', tasks: ['T002', 'T001', 'T003'] }], [{ op: 'move', task: 'T006', phase: 'F1' }]]) {
      const issues = (() => { try { applyReplan(ALIAS, ops(...o), 'x', AT); return []; } catch (e) { expect(e).toBeInstanceOf(ReplanError); return (e as ReplanError).issues; } })();
      expect(issues.join()).toContain('alias');
    }
  });
  it('writes a new id that reads as a number back as text', () => {
    const p = parsePlan(applyReplan(FIXTURE, ops({ op: 'add-phase', id: '10', name: 'Diez' }, { op: 'move', task: 'T006', phase: '10' }), 'x', AT).text);
    expect(p.phases.map(f => f.id)).toEqual(['F1', 'F2', '10']);
    expect(p.versions[0].phases).toEqual(['F1', 'F2', '10']);
    expect(p.tasks.find(t => t.id === 'T006')?.phase).toBe('10');
  });
  it('L-22, M-1: refuses an empty list, too many operations and an empty why', () => {
    expect(() => applyReplan(FIXTURE, [], 'x', AT)).toThrow(ReplanError);
    const move = ops({ op: 'move', task: 'T003', phase: 'F2' })[0];
    expect(() => applyReplan(FIXTURE, Array.from({ length: MAX_OPS + 1 }, () => move), 'x', AT)).toThrow(ReplanError);
    expect(() => applyReplan(FIXTURE, [move], ' \n ', AT)).toThrow(ReplanError);
  });
});

describe('a retired id is never minted again (T6B3-RETIRED-IDS)', () => {
  it('retire keeps the id in `retired`, to-task mints past it, and sync never gives the new task the old state', () => {
    const r = applyReplan(FIXTURE, ops({ op: 'retire', task: 'T006', why: 'el proveedor lo envía' }), 'x', AT);
    const plan = parsePlan(r.text);
    expect(plan.retired).toEqual(['T006']);
    expect(planLite(r.text)).toEqual(plan);
    const { task } = proposalToTask(plan, proposal(), {});
    expect(task.id).toBe('T007');
    // A later retire adds its id, after the first.
    expect(parsePlan(applyReplan(r.text, ops({ op: 'retire', task: 'T005', why: 'y' }), 'y', AT).text).retired).toEqual(['T006', 'T005']);
    // The roadmap holds T006 done with its commits; the first sync orphans it, the next one adds T007 as a new, free task.
    const known = { state: Object.fromEntries(['T001', 'T002', 'T003', 'T004', 'T005', 'T006'].map(id => [id, 1])) };
    const done = { status: 'done' as const, commits: [{ sha: 'abc1234', ts: AT, title: 'email', add: 1, del: 0 }] };
    const opts = (states: Record<string, unknown>) => ({ nowIso: AT, sessionId: 'main', eventId: 'e1', states: states as never });
    const writes = (p: typeof plan, states: Record<string, unknown>) => buildSyncWrites(p, known, 'out', opts(states)).batches.flat().filter(w => w.collection === 'state');
    expect(writes(plan, { T006: done })).toEqual([{ op: 'update', collection: 'state', doc_id: 'T006', data: { status: 'orphaned', prevStatus: 'done' }, if_version: 1 }]);
    const next = writes({ ...plan, tasks: [...plan.tasks, task] }, { T006: { ...done, status: 'orphaned', prevStatus: 'done' } });
    expect(next).toEqual([{ op: 'set', collection: 'state', doc_id: 'T007', data: { status: 'free' } }]);
  });
});

describe('the history every reader takes (T6B3-HISTORY-LENIENT, m-4)', () => {
  const entry = (i: number, why = `r${i}`) => `  - at: "2026-10-${String(i % 28 + 1).padStart(2, '0')}T10:00:00.000Z"\n    why: ${why}\n    changes: ["phases: F2, F1"]\n`;
  // Hand-edited: 31 entries, a why of 400 characters, an entry with 25 lines and one that is not text, and two malformed entries.
  const MESSY = `${FIXTURE}history:\n${entry(0, 'w'.repeat(400))}${Array.from({ length: 30 }, (_, i) => entry(i + 1)).join('')}`
    + '  - just text\n  - { at: 1, why: x, changes: [] }\n'
    + `  - at: "2026-10-30T10:00:00.000Z"\n    why: many\n    changes: [${Array.from({ length: 25 }, (_, i) => `"c${i}"`).join(', ')}, 7]\n`;
  it('keeps the last 30 well-formed entries, clips their texts to the caps, and never fails the plan', () => {
    const h = parsePlan(MESSY).history!;
    expect(h).toHaveLength(PLAN_HISTORY_MAX.entries);
    expect(h[0].why).toBe('r2');
    expect(h.at(-1)).toEqual({ at: '2026-10-30T10:00:00.000Z', why: 'many', changes: Array.from({ length: PLAN_HISTORY_MAX.changes }, (_, i) => `c${i}`) });
    const long = parsePlan(`${FIXTURE}history:\n${entry(0, 'w'.repeat(400))}`).history!;
    expect(long[0].why).toHaveLength(PLAN_HISTORY_MAX.why);
    // planLite reads it the same, and a history that is no list is no history.
    expect(planLite(MESSY)).toEqual(parsePlan(MESSY));
    expect(parsePlan(`${FIXTURE}history: oops\n`).history).toBeUndefined();
    expect(planLite(`${FIXTURE}history: oops\n`)).toEqual(parsePlan(`${FIXTURE}history: oops\n`));
  });
  it('a replan of such a plan still writes within the caps', () => {
    const text = applyReplan(MESSY, ops({ op: 'move', task: 'T003', phase: 'F2' }), 'w'.repeat(400), AT).text;
    // The file's list keeps its last 30 items; the readers show the well-formed ones, the new entry last.
    expect((parse(text) as { history: unknown[] }).history).toHaveLength(PLAN_HISTORY_MAX.entries);
    expect(parsePlan(text).history!.at(-1)).toEqual({ at: AT, why: 'w'.repeat(PLAN_HISTORY_MAX.why), changes: ['T003: F1 → F2'] });
  });
});

describe('normalizeOps', () => {
  it('keeps the known operations and says where the others are', () => {
    const r = normalizeOps({ ops: [{ op: 'move', task: 'T1', phase: 'F1' }, { op: 'delete-phase', id: 'F1' }, { op: 'move', task: '../x', phase: 'F1' }] });
    expect(r.ops).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain('ops[1]');
    expect(r.errors[1]).toContain('ops[2]');
    expect(normalizeOps('nope')).toEqual({ ops: [], errors: ['ops: not a list'] });
  });
  it('L-1: reads ops and ignores the other keys of replan.json', () => {
    expect(normalizeOps({ summary: 's', findings: [{ kind: 'gap' }], vision: null, ops: [{ op: 'move', task: 'T1', phase: 'F1', extra: 1 }] }))
      .toEqual({ ops: [{ op: 'move', task: 'T1', phase: 'F1' }], errors: [] });
  });
  it('L-22, M-1: an empty list and more than the limit are errors', () => {
    expect(normalizeOps({ ops: [] }).errors).toHaveLength(1);
    const over = normalizeOps({ ops: Array.from({ length: MAX_OPS + 1 }, () => ({ op: 'move', task: 'T1', phase: 'F1' })) });
    expect(over.ops).toEqual([]);
    expect(over.errors.join()).toContain(String(MAX_OPS));
    expect(normalizeOps({ ops: Array.from({ length: MAX_OPS }, () => ({ op: 'move', task: 'T1', phase: 'F1' })) }).errors).toEqual([]);
  });
  it('says each malformed operation', () => {
    const r = normalizeOps({ ops: [
      { op: 'edit', task: 'T1' }, { op: 'add-phase', id: 'F3' }, { op: 'edit', task: 'T1', estimate_min: -5 },
      { op: 'edit-phase', id: 'F1', plan_status: 'maybe' }, { op: 'order-phases', phases: [] }, { op: 'retire', task: 'T1' }, 'move',
      { op: 'edit', task: 'T1', depends_on: ['T2', 'a b'] },
    ] });
    expect(r.ops).toEqual([]);
    expect(r.errors.map(e => e.slice(0, 7))).toEqual(['ops[0] ', 'ops[1] ', 'ops[2] ', 'ops[3] ', 'ops[4] ', 'ops[5] ', 'ops[6]:', 'ops[7] ']);
  });
  it('cleans the texts of an operation to one line and drops a repeated dependency', () => {
    expect(normalizeOps({ ops: [{ op: 'edit', task: 'T1', title: '  Nuevo\ntítulo ', depends_on: ['T2', 'T2'] }] }).ops)
      .toEqual([{ op: 'edit', task: 'T1', title: 'Nuevo título', depends_on: ['T2'] }]);
  });
});

describe('waypoint replan', () => {
  let dir: string;
  let io: Io;
  beforeEach(() => {
    dir = tmp('replan-');
    writeFileSync(path.join(dir, 'plan.yaml'), FIXTURE);
    mkdirSync(path.join(dir, 'assets'));
    io = { cwd: dir, now: () => new Date(AT), rand: () => 0, assetsDir: path.join(dir, 'assets') };
    writeFileSync(path.join(dir, 'why.txt'), 'la revisión de fase');
  });
  const replan = (...extra: string[]) => run(['replan', 'plan.yaml', '--ops', 'ops.json', '--why-file', 'why.txt', ...extra], io);
  it('writes the plan and prints the changes', () => {
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [{ op: 'move', task: 'T003', phase: 'F2' }] }));
    const r = replan();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ changes: ['T003: F1 → F2'], history: 1 });
    const after = readFileSync(path.join(dir, 'plan.yaml'), 'utf8');
    expect(parsePlan(after).tasks.find(t => t.id === 'T003')?.phase).toBe('F2');
    // The write is a rename of a temporary file, and nothing is left beside the plan.
    expect(readdirSync(dir).sort()).toEqual(['assets', 'ops.json', 'plan.yaml', 'why.txt']);
    // The same move again changes nothing: no history entry, and the file stays as it is.
    expect(JSON.parse(replan().stdout)).toEqual({ changes: [], history: 1 });
    expect(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')).toBe(after);
  });
  it('leaves the plan as it was on any problem, and needs the why', () => {
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [{ op: 'retire', task: 'T004', why: 'x' }] }));
    const r = replan();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('T004');
    expect(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')).toBe(FIXTURE);
    expect(run(['replan', 'plan.yaml', '--ops', 'ops.json'], io).code).toBe(2);
  });
  it('refuses, byte for byte untouched and with nothing left beside it, an ops file that does not read, bad operations and an empty why', () => {
    const untouched = () => {
      expect(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')).toBe(FIXTURE);
      expect(readdirSync(dir).sort()).toEqual(['assets', 'ops.json', 'plan.yaml', 'why.txt']);
    };
    writeFileSync(path.join(dir, 'ops.json'), '{ "ops": [');
    expect(replan().code).toBe(2);
    untouched();
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ summary: 's', ops: [{ op: 'move', task: 'T003', phase: 'F2' }, { op: 'split', task: 'T003' }] }));
    const r = replan();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('ops[1]');
    untouched();
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [] }));
    expect(replan().code).toBe(2);
    untouched();
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [{ op: 'move', task: 'T003', phase: 'F2' }] }));
    writeFileSync(path.join(dir, 'why.txt'), ' \n');
    expect(replan().code).toBe(2);
    untouched();
    expect(run(['replan', 'plan.yaml', '--ops', 'ops.json', '--why-file', 'missing.txt'], io).code).toBe(2);
    expect(run(['replan', '--ops', 'ops.json', '--why-file', 'why.txt'], io).code).toBe(2);
    untouched();
    // m-7: a bare list is told what the file must be.
    writeFileSync(path.join(dir, 'why.txt'), 'la revisión de fase');
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ op: 'move', task: 'T003', phase: 'F2' }]));
    const list = replan();
    expect(list.code).toBe(2);
    expect(list.stderr).toContain('{ "ops": [...] }');
    untouched();
  });
  it('m-2: a plan with an alias is exit 2 with waypoint\'s message, and stays as it was', () => {
    writeFileSync(path.join(dir, 'plan.yaml'), ALIAS);
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [{ op: 'order-tasks', phase: 'F1', tasks: ['T002', 'T001', 'T003'] }] }));
    const r = replan();
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^replan: refused/);
    expect(r.stderr).toContain('alias');
    expect(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')).toBe(ALIAS);
    expect(readdirSync(dir).sort()).toEqual(['assets', 'ops.json', 'plan.yaml', 'why.txt']);
  });
  it('H-1: --check validates and prints the changes, and writes nothing', () => {
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [{ op: 'move', task: 'T003', phase: 'F2' }, { op: 'edit-phase', id: 'F2', goal: 'cobrar' }] }));
    const r = replan('--check');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ changes: ['T003: F1 → F2', 'F2: goal'] });
    expect(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')).toBe(FIXTURE);
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify({ ops: [{ op: 'retire', task: 'T004', why: 'x' }] }));
    const refused = replan('--check');
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('T004');
    expect(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')).toBe(FIXTURE);
  });
});
