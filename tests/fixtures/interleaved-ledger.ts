// The key ledger of wave 3 (spec §6): three tasks interleaved, two of the plan shop and a loose one.
import type { LedgerEvent } from '../../src/forge/ledger.js';

export const INTERLEAVED_AT = (min: number): string => new Date(Date.parse('2026-10-16T10:00:00.000Z') + min * 60_000).toISOString();
const at = INTERLEAVED_AT;

export const INTERLEAVED: LedgerEvent[] = [
  { ts: at(0), kind: 'triage', task: 'T001', path: 'medium', project: 'shop', reasons: ['size'] },
  { ts: at(1), kind: 'triage', task: 'T002', path: 'small', project: 'shop', reasons: [] },
  { ts: at(2), kind: 'phase', task: 'T001', phase: 'implement' },
  { ts: at(3), kind: 'agent', task: 'T001-1', agent: 'forge-impl' },
  { ts: at(4), kind: 'triage', task: 'T003', path: 'medium', reasons: [] },
  { ts: at(5), kind: 'phase', task: 'T002', phase: 'implement' },
  { ts: at(6), kind: 'validate', task: 'T001-1', ok: true, cached: true, results: [{ validator: 'test', ok: true, cached: true }] },
  { ts: at(7), kind: 'phase', task: 'T003', phase: 'implement' },
  { ts: at(8), kind: 'phase', task: 'T001', phase: 'review', reviewers: ['correctness', 'security'] },
  { ts: at(9), kind: 'verify', task: 'T002', result: 'pass', passed: 2, total: 2 },
  { ts: at(10), kind: 'verdict', task: 'T001-1', action: 'accept', score: 0.9 },
  { ts: at(11), kind: 'agent', task: 'T003-1', agent: 'forge-impl-high' },
];
