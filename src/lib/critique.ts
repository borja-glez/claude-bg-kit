import { z } from 'zod';

/** The highest round a critique can have: six digits, the bound of the critique file names below. */
export const ROUND_MAX = 999_999;
/**
 * K3-10: the critique file of round N: `r<N>.json` in docs/waypoint/<project>/design/critiques/, `critique-r<N>.json` in
 * .waypoint/<project>/ (before waypoint 0.27.0). N has no leading zero (so `r01.json` never collides with `r1.json`) and
 * goes from 1 to ROUND_MAX; a critique set aside as `r<N>.rejected.json` is no round. The CLI and the band read them alike.
 */
export const CRITIQUE_FILE = /^r([1-9]\d{0,5})\.json$/;
export const LEGACY_CRITIQUE_FILE = /^critique-r([1-9]\d{0,5})\.json$/;

export const CATEGORIES = ['scope', 'done_criteria', 'risk', 'contradiction', 'gap'] as const;
export const SEVERITIES = ['critical', 'major', 'minor'] as const;
/** K3-04: `ready` when nothing critical or major is left (zero proposals is a valid critique), `changes` otherwise. */
export const VERDICTS = ['ready', 'changes'] as const;
export type Verdict = (typeof VERDICTS)[number];

// I-13: the schemas are built on first use, inside a function, so a module that imports only what needs no zod (the
// band's mod: CATEGORIES, SEVERITIES, VERDICTS, verdictOf, ROUND_MAX) leaves zod out of its bundle.
function critiqueSchemas() {
  const ProposalSchema = z.object({
    n: z.number().int().positive(),
    category: z.enum(CATEGORIES),
    severity: z.enum(SEVERITIES),
    section: z.string().min(1),
    problem: z.string().min(1),
    change: z.string().min(1),
  });
  const CritiqueSchema = z.object({
    round: z.number().int().positive(),
    version: z.number().int().positive(),
    scope: z.enum(['full', 'changed']),
    // K3-04: optional, so the critiques written before it still read; parseCritique fills it in.
    verdict: z.enum(VERDICTS).optional(),
    proposals: z.array(ProposalSchema),
  });
  return { ProposalSchema, CritiqueSchema };
}
let critiqueBuilt: ReturnType<typeof critiqueSchemas> | undefined;
const schemas = () => (critiqueBuilt ??= critiqueSchemas());
export type Proposal = z.infer<ReturnType<typeof critiqueSchemas>['ProposalSchema']>;
export type Critique = z.infer<ReturnType<typeof critiqueSchemas>['CritiqueSchema']>;
export type Severity = Proposal['severity'];

export class CritiqueError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid critique:\n- ${issues.join('\n- ')}`);
    this.name = 'CritiqueError';
  }
}

/** The verdict a critique's proposals call for: `changes` with any critical or major proposal, else `ready`. */
export function verdictOf(c: { proposals: { severity: Severity }[] }): Verdict {
  return c.proposals.some(p => p.severity !== 'minor') ? 'changes' : 'ready';
}

/** A critique as read: valid, numbered 1..K, and with its verdict (written, and then matching its proposals, or deduced). */
export function parseCritique(text: string): Critique {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new CritiqueError(['critique is not valid JSON']); }
  const r = schemas().CritiqueSchema.safeParse(raw);
  const issues = r.success ? [] : r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const props = (raw as { proposals?: { n?: unknown }[] })?.proposals;
  if (Array.isArray(props)) {
    const ns = props.map(p => p?.n);
    if (!ns.every((n, i) => n === i + 1)) issues.push(`proposals must be numbered 1..${props.length} without gaps`);
  }
  if (issues.length || !r.success) throw new CritiqueError(issues);
  const expected = verdictOf(r.data);
  if (r.data.verdict !== undefined && r.data.verdict !== expected) {
    const serious = r.data.proposals.find(p => p.severity !== 'minor');
    throw new CritiqueError([serious
      ? `verdict is "${r.data.verdict}" but proposal ${serious.n} is ${serious.severity}`
      : `verdict is "${r.data.verdict}" but no proposal is critical or major`]);
  }
  return { ...r.data, verdict: r.data.verdict ?? expected };
}

/** K3-04: how many proposals the critique of a round may carry, and of which severities. */
export interface Budget { max: number; severities: Severity[] }

/**
 * Round 1: up to 12 proposals of any severity; round 2: up to 6, critical and major; from round 3, and in any
 * verification (`round --verify`), up to 3 critical ones. The first round after a reopen counts as round 1 again.
 * A round that is below 1 or not a number is clamped to round 1 on purpose, not left to fall through the comparisons.
 */
export function budgetFor(round: number, verify = false): Budget {
  const n = Number.isFinite(round) && round >= 1 ? Math.floor(round) : 1;
  if (verify || n >= 3) return { max: 3, severities: ['critical'] };
  if (n === 2) return { max: 6, severities: ['critical', 'major'] };
  return { max: 12, severities: ['critical', 'major', 'minor'] };
}

/** What a critique breaks of its budget, one line each; none when it fits. */
export function budgetIssues(c: Critique, b: Budget): string[] {
  const out: string[] = [];
  if (c.proposals.length > b.max) out.push(`${c.proposals.length} proposals, but this round allows at most ${b.max}`);
  for (const p of c.proposals) {
    if (!b.severities.includes(p.severity)) out.push(`proposal ${p.n} is ${p.severity}, but this round allows only ${b.severities.join(' and ')}`);
  }
  return out;
}

/**
 * K3-04: what a round reviews. `round` counts from the last reopen. Round 1 of a design reviews everything; round 2,
 * and the first round after a reopen, what changed, or everything when more than half of the sections changed
 * (`changed` counts the changed and the removed ones, `total` the sections of today); from round 3, and in a
 * verification, only what changed.
 */
export function scopeFor(o: { round: number; verify: boolean; reopened: boolean; changed: number; total: number }): 'full' | 'changed' {
  if (o.verify || o.round >= 3) return 'changed';
  if (o.round <= 1 && !o.reopened) return 'full';
  return o.total === 0 || o.changed * 2 > o.total ? 'full' : 'changed';
}

export function selectProposals(c: Critique, spec: string): Proposal[] {
  if (spec.trim().toLowerCase() === 'all') return c.proposals;
  const parts = spec.split(',').map(s => s.trim());
  if (parts.some(p => !/^[1-9]\d*$/.test(p))) throw new CritiqueError([`invalid selection "${spec}" (use "all" or numbers like 1,3,5)`]);
  const wanted = new Set(parts.map(Number));
  const missing = [...wanted].filter(n => !c.proposals.some(p => p.n === n));
  if (missing.length) throw new CritiqueError([`no such proposals: ${missing.join(', ')}`]);
  return c.proposals.filter(p => wanted.has(p.n));
}

const LABELS: Record<string, { cat: Record<string, string>; sev: Record<string, string>; intro: string; quote: (s: string) => string }> = {
  en: {
    cat: { scope: 'Scope', done_criteria: 'Done criteria', risk: 'Risk', contradiction: 'Contradiction', gap: 'Gap' },
    sev: { critical: 'critical', major: 'major', minor: 'minor' },
    intro: 'Intro', quote: s => `"${s}"`,
  },
  es: {
    cat: { scope: 'Alcance', done_criteria: 'Criterio de hecho', risk: 'Riesgo', contradiction: 'Contradicción', gap: 'Hueco' },
    sev: { critical: 'crítica', major: 'mayor', minor: 'menor' },
    intro: 'Introducción', quote: s => `«${s}»`,
  },
};

/**
 * One line per proposal, in the locale: `1. [Gap · major] "Risks" — problem → change`. The section is named by its
 * heading when `headings` (slug → heading, from the design) has it, the text before the first heading by a word for
 * "intro", and otherwise by its slug.
 */
export function formatProposals(c: Critique, locale = 'en', headings: Record<string, string> = {}): string {
  const key = locale.toLowerCase().split(/[-_]/)[0];
  const l = Object.hasOwn(LABELS, key) ? LABELS[key] : LABELS.en;
  const flat = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ');
  const name = (slug: string) => (slug === '_intro' ? l.intro : Object.hasOwn(headings, slug) ? flat(headings[slug]) : slug);
  return c.proposals.map(p => `${p.n}. [${l.cat[p.category]} · ${l.sev[p.severity]}] ${l.quote(name(p.section))} — ${flat(p.problem)} → ${flat(p.change)}`).join('\n');
}
