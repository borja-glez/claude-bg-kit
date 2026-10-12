import { z } from 'zod';

export const CATEGORIES = ['scope', 'done_criteria', 'risk', 'contradiction', 'gap'] as const;
export const SEVERITIES = ['critical', 'major', 'minor'] as const;

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
  proposals: z.array(ProposalSchema),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export type Critique = z.infer<typeof CritiqueSchema>;

export class CritiqueError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid critique:\n- ${issues.join('\n- ')}`);
    this.name = 'CritiqueError';
  }
}

export function parseCritique(text: string): Critique {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new CritiqueError(['critique is not valid JSON']); }
  const r = CritiqueSchema.safeParse(raw);
  const issues = r.success ? [] : r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const props = (raw as { proposals?: { n?: unknown }[] })?.proposals;
  if (Array.isArray(props)) {
    const ns = props.map(p => p?.n);
    if (!ns.every((n, i) => n === i + 1)) issues.push(`proposals must be numbered 1..${props.length} without gaps`);
  }
  if (issues.length || !r.success) throw new CritiqueError(issues);
  return r.data;
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
