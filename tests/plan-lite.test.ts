import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
`;

describe('planLite (I-13)', () => {
  it('reads a valid plan as parsePlan does: every field the band reads, and the rest', () => {
    for (const text of [FIXTURE, FULL]) expect(planLite(text)).toEqual(parsePlan(text));
  });
  it('an invalid plan the CLI rejects may still read: the band shows it, the CLI validates', () => {
    const bad = FULL.replace('done_when: hecho, depends_on', 'depends_on');
    expect(() => parsePlan(bad)).toThrow();
    expect(planLite(bad)?.tasks.map(t => t.id)).toEqual(['T1', 'T2']);
  });
  it('is null for what is not a plan, and never throws', () => {
    for (const text of ['', 'not: [yaml', 'project: x', '- a\n- b', 'project: x\ntracks: []\nphases: []\ntasks: []']) expect(planLite(text), text).toBeNull();
  });
});
