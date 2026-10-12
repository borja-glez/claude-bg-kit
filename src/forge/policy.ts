import type { ProposalDoc } from '../lib/proposals.js';

const NEGATORS = new Set(['no', 'not', 'without', 'missing', 'lacks', 'nothing', 'zero', 'none', 'absent', 'untested', 'pending', 'would',
  'sin', 'falta', 'ningún', 'ningun']);
const WORDS_BEFORE = 3;
const WORDS_AFTER = 3;
const BENCH_WORD = /\bbenchmarks?\b/giu;
const BENCH_COLON = /\bbench:/giu;
const OPS = /ops\/s/giu;
const BEFORE_AFTER = /\d+(?:\.\d+)?\s*ms\s*(?:→|->)\s*\d+(?:\.\d+)?\s*ms/giu;
const TEST_WORD = /\b(?:tests?|tested|spec)\b/giu;

const wordsIn = (s: string): string[] => s.match(/[\p{L}\p{N}]+/gu) ?? [];

// True when the pattern matches somewhere without a negator among the 3 words before or the 3 words after it
// ("no tests", "nothing tested", "tests missing", "tests: none", "benchmarks would help").
function hasUnnegated(text: string, re: RegExp): boolean {
  for (const m of text.matchAll(re)) {
    const before = wordsIn(text.slice(0, m.index)).slice(-WORDS_BEFORE);
    const after = wordsIn(text.slice(m.index + m[0].length)).slice(0, WORDS_AFTER);
    if (![...before, ...after].some(w => NEGATORS.has(w.toLowerCase()))) return true;
  }
  return false;
}

// Only low-risk, verifiable work is approved without the user.
export function autoApprovable(p: ProposalDoc): boolean {
  if (p.risk !== 'low') return false;
  switch (p.category) {
    case 'tests': case 'quality': return true;
    case 'perf': return [BENCH_WORD, BENCH_COLON, OPS, BEFORE_AFTER].some(re => hasUnnegated(p.evidence, re));
    case 'security': return hasUnnegated(p.evidence, TEST_WORD);
    default: return false;
  }
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length >= 3));

const SIMILAR = 0.6;

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// Id of a rejected proposal that says the same thing without new evidence, else null.
// New evidence is simply evidence the rejected proposal did not contain, so no flag is needed.
export function similarRejected(p: Pick<ProposalDoc, 'title' | 'rationale' | 'evidence'>, rejected: (ProposalDoc & { id: string })[]): string | null {
  const mine = words(`${p.title} ${p.rationale}`);
  for (const r of rejected) {
    if (jaccard(mine, words(`${r.title} ${r.rationale}`)) >= SIMILAR && norm(r.evidence).includes(norm(p.evidence))) return r.id;
  }
  return null;
}

// Id of an open proposal (proposed, discussing, approved, auto_approved) that says the same thing, else null.
// Evidence does not matter here: the open one is still pending or being done.
export function similarOpen(p: Pick<ProposalDoc, 'title' | 'rationale'>, all: (ProposalDoc & { id: string })[]): string | null {
  const mine = words(`${p.title} ${p.rationale}`);
  for (const o of all) {
    if (o.status !== 'proposed' && o.status !== 'discussing' && o.status !== 'approved' && o.status !== 'auto_approved') continue;
    if (jaccard(mine, words(`${o.title} ${o.rationale}`)) >= SIMILAR) return o.id;
  }
  return null;
}

// The path if it is a plain relative path/glob made of safe characters; null otherwise.
export function safeZone(path: string | undefined): string | null {
  if (!path || !/^[A-Za-z0-9_./*-]+$/.test(path) || path.startsWith('-')) return null;
  if (path.startsWith('/') || path.split('/').includes('..')) return null;
  return path;
}
