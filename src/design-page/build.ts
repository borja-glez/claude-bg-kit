import { changedSections, designBody, parseDesign, sectionsOf, type DesignMeta } from '../lib/design.js';
import { entryKind, type ChangelogEntry } from '../lib/history.js';
import { renderMarkdown } from '../lib/markdown.js';
import { verdictOf, type Critique, type Proposal, type Verdict } from '../lib/critique.js';
import { appliedVersion, pendingProposals, resolvedIn, rewroteRound, line, GATE_LIST_MAX, type Dismissed, type GateCritique } from '../lib/design-gate.js';

/** A-24: the page embeds the HTML of this many versions, the newest; the earlier ones stay as their changelog notes. */
export const VERSIONS_EMBEDDED = 5;

/** K3-09: what became of a proposal. */
export type Fate = 'applied' | 'resolved' | 'dismissed' | 'rewritten' | 'pending';
export interface PageProposal extends Proposal {
  fate: Fate;
  /** The person's reason, for a dismissed proposal that has one. */
  reason?: string;
  /** The version whose entry applied it. */
  appliedIn?: number;
}
export interface PageCritique {
  round: number; version: number; scope: Critique['scope']; verdict: Verdict; proposals: PageProposal[];
  /** How many older proposals `proposals` left out (the newest GATE_LIST_MAX are kept); present only when not 0. */
  proposalsMore?: number;
  /** Carry 9: the critique names a version the changelog does not have; present only then. */
  unknownVersion?: true;
}
/**
 * K3-09: what a version changed against the one before it, by heading (`_intro`: the text before the first heading).
 * Carry 9: when the history lacks the version right before it, the diff is against the earlier one it has, `against`.
 */
export interface VersionDiff { changed: string[]; added: string[]; removed: string[]; against?: number }

export interface DesignPageData {
  meta: DesignMeta;
  words: number;
  /** K3-09: the number of valid critiques. */
  rounds: number;
  /** Carry 9: the proposals of every round still pending, as the gate counts them (never capped). */
  pending: number;
  source: string;
  current: number;
  status: DesignMeta['status'];
  /** An amendment came after the last approval. */
  amended: boolean;
  /** The newest GATE_LIST_MAX valid critiques, by round; the texts are clean lines (HTML escaping is the page's job). */
  critiques: PageCritique[];
  /** How many older critiques `critiques` left out; present only when not 0. */
  critiquesMore?: number;
  versions: { version: number; date: string; note: string; words: number; html: string; toc: { level: 2 | 3; heading: string; slug: string }[]; diff: VersionDiff | null }[];
  /** A-24: the changelog entries before the embedded versions: their date and note only. */
  earlier?: { version: number; date: string; note: string }[];
}

/**
 * K3-09: applied (and in which version), resolved in an interview, dismissed (with its reason), folded in by a rewrite of
 * its round, or pending. The gate lists a proposal in every list it belongs to; the page shows one fate, in this order of
 * precedence: applied, resolved, dismissed, rewritten, pending.
 */
export function fateOf(changelog: ChangelogEntry[], dismissed: Dismissed, round: number, n: number): Pick<PageProposal, 'fate' | 'reason' | 'appliedIn'> {
  const at = appliedVersion(changelog, round, n);
  if (at !== null) return { fate: 'applied', appliedIn: at };
  if (resolvedIn(changelog, round).has(n)) return { fate: 'resolved' };
  const set = (dismissed[round] ?? []).find(x => x.n === n);
  if (set) return { fate: 'dismissed', ...(set.reason ? { reason: set.reason } : {}) };
  if (rewroteRound(changelog, round)) return { fate: 'rewritten' };
  return { fate: 'pending' };
}

/** K3-09: the sections a version changed, added and removed against the one before it, by heading; front matter apart. */
export function versionDiff(prev: string, next: string): VersionDiff {
  const before = designBody(prev);
  const after = designBody(next);
  const { changed, removed } = changedSections(before, after);
  const was = new Map(sectionsOf(before).map(s => [s.slug, s.heading] as const));
  const now = new Map(sectionsOf(after).map(s => [s.slug, s.heading] as const));
  const name = (m: Map<string, string>, slug: string) => (slug === '_intro' ? '_intro' : m.get(slug) ?? slug);
  const added = changed.filter(s => s !== '_intro' && !was.has(s));
  return {
    changed: changed.filter(s => !added.includes(s)).map(s => name(now, s)),
    added: added.map(s => name(now, s)),
    removed: removed.map(s => name(was, s)),
  };
}

export function buildDesignPageData(input: {
  current: string; history: Record<number, string>; changelog: ChangelogEntry[]; source: string;
  critiques?: GateCritique[]; dismissed?: Dismissed;
}): DesignPageData {
  const cur = parseDesign(input.current);
  const last = input.changelog[input.changelog.length - 1];
  const currentNo = last?.version ?? 1;
  const texts: Record<number, string> = { ...input.history, [currentNo]: input.current };
  const numbers = [...new Set([...Object.keys(texts).map(Number), ...input.changelog.map(c => c.version)])]
    .filter(n => texts[n] !== undefined)
    .sort((a, b) => a - b);
  const from = Math.max(0, numbers.length - VERSIONS_EMBEDDED);
  const versions = numbers.slice(from).map((n, j) => {
    const i = from + j;
    const d = parseDesign(texts[n]);
    const entry = input.changelog.find(c => c.version === n);
    return {
      version: n,
      date: entry?.date ?? '',
      note: entry?.note ?? '',
      words: d.words,
      html: renderMarkdown(d.body),
      toc: sectionsOf(d.body).map(({ level, heading, slug }) => ({ level, heading, slug })),
      diff: i === 0 ? null : { ...versionDiff(texts[numbers[i - 1]], texts[n]), ...(numbers[i - 1] !== n - 1 ? { against: numbers[i - 1] } : {}) },
    };
  });
  const earlier = input.changelog.filter(c => c.version < (numbers[from] ?? Infinity))
    .sort((a, b) => a.version - b.version).map(({ version, date, note }) => ({ version, date, note }));
  const dismissed = input.dismissed ?? {};
  const known = new Set([...input.changelog.map(e => e.version), currentNo]);
  // The page data stays bounded and clean like the gate's lists: the newest GATE_LIST_MAX rounds and, in each, the newest
  // GATE_LIST_MAX proposals, with their texts as one clean line of 300 code points at most; the rest is counted.
  const valid = [...(input.critiques ?? [])]
    .sort((a, b) => a.round - b.round)
    .flatMap(({ round, critique }) => (critique ? [{ round, critique }] : []));
  const critiques: PageCritique[] = valid.slice(-GATE_LIST_MAX).map(({ round, critique }) => {
    const more = Math.max(0, critique.proposals.length - GATE_LIST_MAX);
    return {
      round, version: critique.version, scope: critique.scope, verdict: critique.verdict ?? verdictOf(critique),
      proposals: critique.proposals.slice(-GATE_LIST_MAX).map(p => ({
        ...p, section: line(p.section), problem: line(p.problem), change: line(p.change), ...fateOf(input.changelog, dismissed, round, p.n),
      })),
      ...(more ? { proposalsMore: more } : {}),
      ...(known.has(critique.version) ? {} : { unknownVersion: true as const }),
    };
  });
  const critiquesMore = valid.length - critiques.length;
  const kinds = input.changelog.map(entryKind);
  return {
    meta: cur.meta,
    words: cur.words,
    rounds: valid.length,
    pending: pendingProposals(input.changelog, input.critiques ?? [], dismissed).length,
    source: input.source,
    current: currentNo,
    status: cur.meta.status,
    amended: cur.meta.status === 'approved' && kinds.lastIndexOf('amend') > kinds.lastIndexOf('approve'),
    critiques,
    ...(critiquesMore ? { critiquesMore } : {}),
    versions,
    earlier,
  };
}
