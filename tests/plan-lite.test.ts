import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { parsePlan } from '../src/lib/plan.js';
import { planLite } from '../src/lib/plan-lite.js';

const FIXTURE = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');
// Every optional field of the schema of src/lib/plan.ts (1c and 4a included), and the defaults left out.
const FULL = `project: full
locale: es
version: "1.2"
design_version: 3
artifacts:
  roadmap: https://claude.ai/artifact/r1
  design: https://claude.ai/artifact/d1
versions:
  - id: v1
    phases: [p1]
    target: "2026-11-01"
tracks:
  - { id: core, name: Core, color: blue }
phases:
  - { id: p1, name: Base, goal: Lo mínimo }
  - { id: p2, name: Más, plan_status: provisional }
tasks:
  - id: T1
    title: Uno
    track: core
    phase: p1
    category: feature
    includes: a, b
    done_when: hecho
    verification: test
    zones: [src/a]
    estimate_min: 30
    delicate: true
    design_ref: alcance
  - { id: T2, title: Dos, track: core, phase: p2, done_when: hecho, depends_on: [T1] }
retired: [T0]
history:
  - { at: "2026-10-22T10:00:00.000Z", why: la revisión de p1, changes: ["T2: p1 → p2", −T0 (ya no hace falta)] }
`;
// The schema's defaults: FULL without locale, artifacts and versions (T2 already leaves out zones, p1 plan_status).
const DEFAULTS = FULL.replace('locale: es\n', '').replace(/^artifacts:\n(?: {2}.*\n)+/m, '').replace(/^versions:\n(?: {2}.*\n)+/m, '');

describe('planLite (I-13)', () => {
  it('reads a valid plan as parsePlan does: every field the band reads, and the rest', () => {
    for (const text of [FIXTURE, FULL, DEFAULTS]) expect(planLite(text)).toEqual(parsePlan(text));
    // m-4: the replan's history and retired ids too (FULL has both).
    expect(planLite(FULL)).toMatchObject({ retired: ['T0'], history: [{ at: '2026-10-22T10:00:00.000Z', why: 'la revisión de p1', changes: ['T2: p1 → p2', '−T0 (ya no hace falta)'] }] });
  });
  it('fills in the defaults of the schema as parsePlan does', () => {
    expect(DEFAULTS).not.toMatch(/^(?:locale|artifacts|versions):/m);
    expect(planLite(DEFAULTS)).toMatchObject({ locale: 'en', artifacts: {}, versions: [] });
  });
  it('an invalid plan the CLI rejects may still read: the band shows it, the CLI validates', () => {
    const bad = FULL.replace('done_when: hecho, depends_on', 'depends_on');
    expect(() => parsePlan(bad)).toThrow();
    expect(planLite(bad)?.tasks.map(t => t.id)).toEqual(['T1', 'T2']);
  });
  it('keeps only the tracks, phases and tasks whose id is a plan id, and only plan ids in depends_on and a version\'s phases (M1)', () => {
    const c = (n: number) => String.fromCharCode(n);
    const dirty = `T9${c(0x202e)}${c(10)}rm`;
    const text = stringify({
      project: 'p',
      versions: [{ id: 'v1', phases: ['p1', `p${c(0x202e)}2`, '..'] }],
      tracks: [{ id: 'core', name: 'Core', color: 'blue' }, { id: 'a b', name: 'Bad' }, { id: 'x'.repeat(65), name: 'Long' }],
      phases: [{ id: 'p1', name: 'Base' }, { id: '..', name: 'Dots' }, { id: `p${c(0x202e)}2`, name: 'Bidi' }],
      tasks: [
        { id: 'T1', title: 'Uno', track: 'core', phase: 'p1', done_when: 'x', depends_on: [dirty, 'T2', '.', 'a/b'] },
        { id: dirty, title: 'Mala', track: 'core', phase: 'p1', done_when: 'x' },
        { id: 'T2', title: 'Dos', track: 'core', phase: 'p1', done_when: 'x' },
      ],
    });
    const p = planLite(text)!;
    expect(p.tracks.map(t => t.id)).toEqual(['core']);
    expect(p.phases.map(x => x.id)).toEqual(['p1']);
    expect(p.tasks.map(t => t.id)).toEqual(['T1', 'T2']);
    expect(p.tasks[0].depends_on).toEqual(['T2']);
    expect(p.versions).toEqual([{ id: 'v1', phases: ['p1'] }]);
    // A plan whose every task breaks the rule has no task: it is no plan.
    const tasks = [dirty, '..'].map(id => ({ id, title: 'Mala', track: 'core', phase: 'p1' }));
    expect(planLite(stringify({ project: 'p', tracks: [{ id: 'core' }], phases: [{ id: 'p1' }], tasks }))).toBeNull();
  });
  it('is null for what is not a plan, and never throws', () => {
    for (const text of ['', 'not: [yaml', 'project: x', '- a\n- b', 'project: x\ntracks: []\nphases: []\ntasks: []']) expect(planLite(text), text).toBeNull();
  });
});
