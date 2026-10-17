import { changedSections, designBody, parseDesign, sectionsOf, type DesignMeta } from '../lib/design.js';
import { entryKind, type ChangelogEntry } from '../lib/history.js';
import { renderMarkdown } from '../lib/markdown.js';
import { verdictOf, type Critique, type Proposal, type Verdict } from '../lib/critique.js';
import { appliedVersion, resolvedIn, rewroteRound, type Dismissed, type GateCritique } from '../lib/design-gate.js';

/** K3-09: what became of a proposal. */
export type Fate = 'applied' | 'resolved' | 'dismissed' | 'rewritten' | 'pending';
export interface PageProposal extends Proposal {
  fate: Fate;
  /** The person's reason, for a dismissed proposal that has one. */
  reason?: string;
  /** The version whose entry applied it. */
  appliedIn?: number;
}
export interface PageCritique { round: number; version: number; scope: Critique['scope']; verdict: Verdict; proposals: PageProposal[] }
/** K3-09: what a version changed against the one before it, by heading (`_intro`: the text before the first heading). */
export interface VersionDiff { changed: string[]; added: string[]; removed: string[] }

export interface DesignPageData {
  meta: DesignMeta;
  words: number;
  /** K3-09: the number of valid critiques. */
  rounds: number;
  source: string;
  current: number;
  status: DesignMeta['status'];
  /** An amendment came after the last approval. */
  amended: boolean;
  critiques: PageCritique[];
  versions: { version: number; date: string; note: string; words: number; html: string; toc: { level: 2 | 3; heading: string; slug: string }[]; diff: VersionDiff | null }[];
}

/** K3-09: applied (and in which version), resolved in an interview, dismissed (with its reason), folded in by a rewrite of its round, or pending. */
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
  const versions = numbers.map((n, i) => {
    const d = parseDesign(texts[n]);
    const entry = input.changelog.find(c => c.version === n);
    return {
      version: n,
      date: entry?.date ?? '',
      note: entry?.note ?? '',
      words: d.words,
      html: renderMarkdown(d.body),
      toc: sectionsOf(d.body).map(({ level, heading, slug }) => ({ level, heading, slug })),
      diff: i === 0 ? null : versionDiff(texts[numbers[i - 1]], texts[n]),
    };
  });
  const dismissed = input.dismissed ?? {};
  const critiques: PageCritique[] = [...(input.critiques ?? [])]
    .sort((a, b) => a.round - b.round)
    .flatMap(({ round, critique }) => (critique ? [{
      round, version: critique.version, scope: critique.scope, verdict: critique.verdict ?? verdictOf(critique),
      proposals: critique.proposals.map(p => ({ ...p, ...fateOf(input.changelog, dismissed, round, p.n) })),
    }] : []));
  const kinds = input.changelog.map(entryKind);
  return {
    meta: cur.meta,
    words: cur.words,
    rounds: critiques.length,
    source: input.source,
    current: currentNo,
    status: cur.meta.status,
    amended: cur.meta.status === 'approved' && kinds.lastIndexOf('amend') > kinds.lastIndexOf('approve'),
    critiques,
    versions,
  };
}
