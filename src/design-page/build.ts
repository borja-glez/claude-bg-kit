import { changedSections, designBody, parseDesign, sectionsOf, wordCount, type DesignMeta, type Section } from '../lib/design.js';
import { entryKind, type ChangelogEntry, type EntryKind } from '../lib/history.js';
import { renderMarkdown } from '../lib/markdown.js';
import { clean } from '../lib/decisions.js';
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

/**
 * A heading of a version: its level, text and slug; its words (a `##` counts its `###` too); for a `##`, the first
 * sentence of its text (`lead`); and whether this version added it or changed it against the one before (`change`).
 */
export interface TocEntry { level: 2 | 3; heading: string; slug: string; words: number; lead?: string; change?: 'changed' | 'added' }

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
  versions: { version: number; date: string; note: string; words: number; kind: EntryKind | null; html: string; toc: TocEntry[]; diff: VersionDiff | null }[];
  /** A-24: the changelog entries before the embedded versions: their date, note, words and kind only. */
  earlier?: { version: number; date: string; note: string; words: number; kind: EntryKind | null }[];
}

const LEAD_MAX = 180;

/**
 * The first sentence of a section's own prose, as plain text of LEAD_MAX characters at most; '' when it has none. Code,
 * tables, quotes and callouts are skipped; a sentence that ends in a colon goes on into the list after it («La escalera
 * pasa a cinco peldaños: mech → …»).
 */
export function leadOf(text: string): string {
  let fence = false;
  let lead = '';
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(`{3,}|~{3,})/.test(raw)) { if (lead) break; fence = !fence; continue; }
    const l = raw.trim();
    if (fence || /^(\||#|<|>|!\[|---|\*\*\*)/.test(l)) continue;
    if (!l) { if (lead && !lead.endsWith(':')) break; continue; }
    // One clean line (no control or bidi characters), without its list marker, link targets and emphasis.
    const t = clean(l, Number.MAX_SAFE_INTEGER).replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
    if (!t) continue;
    lead = lead ? `${lead} ${t}` : t;
    const end = /[.!?](\s|$)/.exec(lead);
    if (end) { lead = lead.slice(0, end.index + 1); break; }
    if (Array.from(lead).length >= LEAD_MAX) break;
  }
  const chars = Array.from(lead);
  return chars.length > LEAD_MAX ? `${chars.slice(0, LEAD_MAX - 1).join('').trimEnd()}…` : lead;
}

/** K3-09 and the page's map: every heading with its words, lead and what this version did to it. */
export function tocOf(sections: Section[], marks: Map<string, 'changed' | 'added'>): TocEntry[] {
  return sections.map((s, i) => {
    let words = wordCount(s.text);
    let lead = '';
    if (s.level === 2) {
      lead = leadOf(s.text);
      for (let j = i + 1; j < sections.length && sections[j].level === 3; j++) {
        words += wordCount(sections[j].text);
        if (!lead) lead = leadOf(sections[j].text);
      }
    }
    const change = marks.get(s.slug);
    return { level: s.level, heading: s.heading, slug: s.slug, words, ...(lead ? { lead } : {}), ...(change ? { change } : {}) };
  });
}

/** What a version added and changed against the one before it, by slug (the intro apart). */
function marksOf(prev: string | undefined, next: string): Map<string, 'changed' | 'added'> {
  if (prev === undefined) return new Map();
  const before = designBody(prev);
  const was = new Set(sectionsOf(before).map(s => s.slug));
  return new Map(changedSections(before, designBody(next)).changed.filter(s => s !== '_intro').map(s => [s, was.has(s) ? 'changed' : 'added'] as const));
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
    const prev = i === 0 ? undefined : texts[numbers[i - 1]];
    return {
      version: n,
      date: entry?.date ?? '',
      note: entry?.note ?? '',
      words: d.words,
      kind: entry ? entryKind(entry) : null,
      html: renderMarkdown(d.body, { locale: cur.meta.locale }),
      toc: tocOf(d.sections, marksOf(prev, texts[n])),
      diff: prev === undefined ? null : { ...versionDiff(prev, texts[n]), ...(numbers[i - 1] !== n - 1 ? { against: numbers[i - 1] } : {}) },
    };
  });
  const earlier = input.changelog.filter(c => c.version < (numbers[from] ?? Infinity))
    .sort((a, b) => a.version - b.version).map(e => ({ version: e.version, date: e.date, note: e.note, words: e.words, kind: entryKind(e) }));
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
