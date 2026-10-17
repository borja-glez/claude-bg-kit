// C7 (wave 4): the forge block of state/T, version 2, and its evidence, as FORGE roadmap-doc writes them and the
// roadmap page reads them. Pure and without Node imports: the page bundles it (normalizeForge) and forge checks what it
// writes with the same parser. A v2 block keeps every v1 field (path, phase, agent, validators with a boolean ok,
// verdict, round, cap), so a page published before wave 4 still reads it.
import { STAGES, type Stage } from './types.js';

/** The largest forge block: the UTF-8 bytes of its JSON. */
export const FORGE_DOC_MAX = 4096;
export const ROUNDS_MAX = 6;
export const VALIDATORS_MAX = 10;
export const DEFERRED_MAX = 10;
export const NOTE_MAX = 120;
export const PROBLEM_MAX = 160;
export const SHOTS_MAX = 30;
export const UNCHECKED_MAX = 10;
const TEXT_MAX = 200;
const NAME_MAX = 80;
const REVIEWER_MAX = 40;
const REVIEWERS_MAX = 6;
const COUNT_MAX = 999;

export type DocPath = 'trivial' | 'small' | 'medium' | 'large';
export const DOC_PATHS: readonly DocPath[] = ['trivial', 'small', 'medium', 'large'];
export type DocStage = Stage | 'triage' | 'done' | 'blocked' | 'stopped';
export const DOC_STAGES: readonly DocStage[] = [...STAGES, 'triage', 'done', 'blocked', 'stopped'];
export type DocAction = 'accept' | 'fix' | 'redo';
const ACTIONS: readonly DocAction[] = ['accept', 'fix', 'redo'];
/** The keys of `stages`: forge's stages and the triage before the first one. */
export const STAGE_KEYS: readonly string[] = [...STAGES, 'triage'];

export interface ValidatorV2 { name: string; ok: boolean; flaky?: true; skipped?: string; preexisting?: true; ms?: number; cached?: true; failing?: number }
export interface Findings4 { critical: number; important: number; minor: number; deferred: number }
export interface RoundV2 { brief: number; n: number; action: DocAction; note: string; findings: Findings4; reviewers: string[]; at: string }
export interface VerifyV2 { planned: boolean; result: 'pass' | 'fail' | 'blocked' | null; passed: number | null; total: number | null; skipped: string | null; surfaces: string[] }
export interface IntegrationV2 { branch: string; sha: string | null; merged: boolean; target: string }
export interface DeferredV2 { file?: string; line?: number; problem: string }
export interface ForgeDocV2 {
  v: 2;
  // The v1 fields, the ones a page published before wave 4 reads. agent and verdict are left out when there is none.
  path: DocPath; phase: string; agent?: string; validators: ValidatorV2[];
  verdict?: { action: DocAction; score: number | null };
  round?: number;                     // reviews.n: the review of the brief in progress, from 1
  cap?: number;                       // reviews.max: the most reviews of the path (4 on Medium, 5 on Large)
  // New in v2.
  brief: number; stage: DocStage; rounds: RoundV2[]; verify: VerifyV2 | null; stages: Record<string, number>;
  integration: IntegrationV2 | null; deferred: DeferredV2[]; acceptedRound: number | null; overCap: boolean; updatedAt: string;
}
export interface ShotV2 { surface: string; check: string; ok: boolean; expected?: string; observed?: string; round: number; url?: string; id?: string }
export interface EvidenceV2 {
  v: 2; surfaces: string[]; result: 'pass' | 'fail' | 'blocked'; passed: number; total: number;
  reason?: string; unchecked?: string[]; local: string; pending?: true; shots: ShotV2[];
}
/** What a parser dropped or coerced, as the page's ?debug=1 lists it (H-04). */
export type DocReport = (field: string, action: 'dropped' | 'coerced', detail: string) => void;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const isAction = (v: unknown): v is DocAction => (ACTIONS as readonly unknown[]).includes(v);
// Bidi controls reorder what a reader sees: built from their code points, so none is written in this file.
const BIDI = new RegExp(`[${[0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map(c => String.fromCharCode(c)).join('')}]`, 'g');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** At most `max` code points, so a clip never splits a surrogate pair. */
const clip = (v: string, max: number): string => (v.length <= max ? v : Array.from(v).slice(0, max).join(''));
/** One line of text: control characters as spaces, without bidi characters, trimmed, at most `max` characters. */
const line = (v: string, max: number): string => clip(v.replace(CONTROL, ' ').replace(BIDI, '').trim(), max);

/** The UTF-8 size of a text, which the 4 KB budget counts. */
export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

function validatorOf(v: unknown): ValidatorV2 | null {
  if (!isObj(v) || typeof v.name !== 'string' || !v.name.trim() || typeof v.ok !== 'boolean') return null;
  const out: ValidatorV2 = { name: line(v.name, NAME_MAX), ok: v.ok };
  if (v.flaky === true) out.flaky = true;
  if (typeof v.skipped === 'string' && v.skipped.trim()) out.skipped = line(v.skipped, NAME_MAX);
  if (v.preexisting === true) out.preexisting = true;
  if (int(v.ms, 0, 86_400_000)) out.ms = v.ms;
  if (v.cached === true) out.cached = true;
  if (int(v.failing, 0, 100_000)) out.failing = v.failing;
  return out;
}

function roundOf(r: unknown): RoundV2 | null {
  if (!isObj(r) || !int(r.brief, 1, 9999) || !int(r.n, 1, 99) || !isAction(r.action) || typeof r.note !== 'string' || !iso(r.at)) return null;
  const f = isObj(r.findings) ? r.findings : {};
  const c = (k: keyof Findings4): number | null => (int(f[k], 0, COUNT_MAX) ? (f[k] as number) : null);
  const findings = { critical: c('critical'), important: c('important'), minor: c('minor'), deferred: c('deferred') };
  if (Object.values(findings).some(x => x === null)) return null;
  const reviewers = (Array.isArray(r.reviewers) ? r.reviewers : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => line(x, REVIEWER_MAX)).slice(0, REVIEWERS_MAX);
  return { brief: r.brief, n: r.n, action: r.action, note: line(r.note, NOTE_MAX), findings: findings as Findings4, reviewers, at: r.at };
}

function deferredOf(d: unknown): DeferredV2 | null {
  if (!isObj(d) || typeof d.problem !== 'string' || !d.problem.trim()) return null;
  const out: DeferredV2 = { problem: line(d.problem, PROBLEM_MAX) };
  if (typeof d.file === 'string' && d.file.trim()) out.file = line(d.file, TEXT_MAX);
  if (int(d.line, 1, 10_000_000)) out.line = d.line;
  return out;
}

function verifyOf(v: Obj, report?: DocReport): VerifyV2 | null {
  if (typeof v.planned !== 'boolean') { report?.('forge.verify', 'coerced', 'planned'); return null; }
  return {
    planned: v.planned,
    result: v.result === 'pass' || v.result === 'fail' || v.result === 'blocked' ? v.result : null,
    passed: int(v.passed, 0, 1000) ? v.passed : null,
    total: int(v.total, 0, 1000) ? v.total : null,
    skipped: typeof v.skipped === 'string' && v.skipped.trim() ? line(v.skipped, TEXT_MAX) : null,
    surfaces: (Array.isArray(v.surfaces) ? v.surfaces : []).filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => line(s, NAME_MAX)).slice(0, 10),
  };
}

const SHA = /^[0-9a-f]{7,40}$/i;
function integrationOf(v: Obj, report?: DocReport): IntegrationV2 | null {
  if (typeof v.branch !== 'string' || !v.branch.trim() || typeof v.target !== 'string' || !v.target.trim() || typeof v.merged !== 'boolean') {
    report?.('forge.integration', 'coerced', 'branch, target or merged');
    return null;
  }
  return { branch: line(v.branch, TEXT_MAX), sha: typeof v.sha === 'string' && SHA.test(v.sha) ? v.sha : null, merged: v.merged, target: line(v.target, TEXT_MAX) };
}

function stagesOf(x: Obj): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of STAGE_KEYS) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.round(v);
  }
  return out;
}

/**
 * C7: a forge block v2, checked field by field. Null (and reported as `forge.v`) when it is not one: no `v: 2`, or a
 * required field missing or of the wrong type; an item of a list that does not validate is dropped and reported alone.
 * Text is one line, without control or bidi characters, clipped to its limit.
 */
export function parseForgeDocV2(x: unknown, report?: DocReport): ForgeDocV2 | null {
  const bad = (why: string): null => { report?.('forge.v', 'dropped', why); return null; };
  if (!isObj(x)) return bad(kindOf(x));
  if (x.v !== 2) return bad('no v: 2');
  if (!(DOC_PATHS as readonly unknown[]).includes(x.path)) return bad('path');
  if (!(DOC_STAGES as readonly unknown[]).includes(x.stage)) return bad('stage');
  if (typeof x.phase !== 'string') return bad('phase');
  if (!int(x.brief, 1, 9999)) return bad('brief');
  if (!Array.isArray(x.rounds) || !Array.isArray(x.validators) || !Array.isArray(x.deferred) || !isObj(x.stages)) return bad('rounds, validators, deferred or stages');
  if (x.verify !== null && !isObj(x.verify)) return bad('verify');
  if (x.integration !== null && !isObj(x.integration)) return bad('integration');
  if (x.acceptedRound !== null && !int(x.acceptedRound, 1, 99)) return bad('acceptedRound');
  if (typeof x.overCap !== 'boolean' || !iso(x.updatedAt)) return bad('overCap or updatedAt');
  const keep = <T>(list: unknown[], of: (v: unknown) => T | null, field: string, max: number, newest = false): T[] => {
    const out: T[] = [];
    list.forEach((v, i) => { const o = of(v); if (o) out.push(o); else report?.(`forge.${field}[${i}]`, 'dropped', kindOf(v)); });
    return newest ? out.slice(-max) : out.slice(0, max);
  };
  const doc: ForgeDocV2 = {
    v: 2, path: x.path as DocPath, phase: line(x.phase, 40),
    validators: keep(x.validators, validatorOf, 'validators', VALIDATORS_MAX),
    brief: x.brief, stage: x.stage as DocStage,
    rounds: keep(x.rounds, roundOf, 'rounds', ROUNDS_MAX, true),
    verify: x.verify === null ? null : verifyOf(x.verify as Obj, report),
    stages: stagesOf(x.stages),
    integration: x.integration === null ? null : integrationOf(x.integration as Obj, report),
    deferred: keep(x.deferred, deferredOf, 'deferred', DEFERRED_MAX),
    acceptedRound: x.acceptedRound as number | null, overCap: x.overCap, updatedAt: x.updatedAt,
  };
  // The optional v1 fields: left out when absent; one that is there and invalid is left out and reported.
  const coerced = (field: string, v: unknown): void => report?.(`forge.${field}`, 'coerced', kindOf(v));
  if (typeof x.agent === 'string' && x.agent.trim()) doc.agent = line(x.agent, NAME_MAX);
  else if (x.agent !== undefined) coerced('agent', x.agent);
  if (isObj(x.verdict) && isAction(x.verdict.action)) {
    doc.verdict = { action: x.verdict.action, score: typeof x.verdict.score === 'number' && Number.isFinite(x.verdict.score) ? x.verdict.score : null };
    if (doc.verdict.score === null && x.verdict.score !== null) coerced('verdict', x.verdict.score);
  } else if (x.verdict !== undefined) coerced('verdict', x.verdict);
  if (int(x.round, 1, 99)) doc.round = x.round;
  else if (x.round !== undefined) coerced('round', x.round);
  if (int(x.cap, 1, 99)) doc.cap = x.cap;
  else if (x.cap !== undefined) coerced('cap', x.cap);
  // round is reviews.n and cap is reviews.max: a review past the cap is a real state (a fifth review of a Medium after the
  // breaker, r5/4), which the block says with overCap. The round stays, and nothing is reported.
  if (doc.round !== undefined && doc.cap !== undefined && doc.round > doc.cap) doc.overCap = true;
  return doc;
}

type Step = [label: string, cut: (d: ForgeDocV2) => ForgeDocV2 | null];
// C7: what is cut, in this order, until the block fits; each step that applies is named in `dropped`.
const STEPS: readonly Step[] = [
  ['deferred>5', d => (d.deferred.length > 5 ? { ...d, deferred: d.deferred.slice(0, 5) } : null)],
  ['rounds:earlier-briefs', d => (d.rounds.some(r => r.brief !== d.brief) ? { ...d, rounds: d.rounds.filter(r => r.brief === d.brief) } : null)],
  ['validators.failing', d => (d.validators.some(v => v.failing !== undefined) ? { ...d, validators: d.validators.map(({ failing: _f, ...v }) => v) } : null)],
  ['rounds.note:60', d => (d.rounds.some(r => r.note.length > 60) ? { ...d, rounds: d.rounds.map(r => ({ ...r, note: clip(r.note, 60) })) } : null)],
  ['deferred.problem:80', d => (d.deferred.some(x => x.problem.length > 80) ? { ...d, deferred: d.deferred.map(x => ({ ...x, problem: clip(x.problem, 80) })) } : null)],
  // The last resort, so the cap is a guarantee: the v1 core and the v2 scalars. Every v2 list goes (rounds, deferred
  // findings, reviewers, the verification and the integration), and of the validators only the ones that failed stay.
  ['core', d => ({ ...d, validators: d.validators.filter(v => !v.ok).map(v => ({ name: v.name, ok: v.ok })), rounds: [], verify: null, integration: null, deferred: [] })],
];

/**
 * C7: the block cut in a fixed order until its JSON measures at most `max` UTF-8 bytes. The last step reduces it to its
 * core, so `fits` is false only when even that exceeds `max` (the caller then refuses to write it).
 */
export function fitForgeDoc(doc: ForgeDocV2, max = FORGE_DOC_MAX): { doc: ForgeDocV2; dropped: string[]; bytes: number; fits: boolean } {
  let cur = doc;
  const dropped: string[] = [];
  for (const [label, cut] of STEPS) {
    if (byteLength(JSON.stringify(cur)) <= max) break;
    const next = cut(cur);
    if (next) { cur = next; dropped.push(label); }
  }
  const bytes = byteLength(JSON.stringify(cur));
  return { doc: cur, dropped, bytes, fits: bytes <= max };
}
