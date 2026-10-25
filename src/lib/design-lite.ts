import { parse } from 'yaml';
import { DESIGN_STATUSES, frontMatterOf, type DesignMeta } from './design.js';
import { ENTRY_KINDS, normalizeApplied, normalizeResolved, type ChangelogEntry, type EntryKind } from './history.js';
import { THREAD_ID } from './design-comments.js';
import { CATEGORIES, SEVERITIES, VERDICTS, verdictOf, type Critique, type Proposal } from './critique.js';

// I-13: what the design band reads, without zod. These modules build their zod schemas on first use, so importing the
// constants and helpers above leaves zod out of the mods' bundles. Pure and without Node imports.
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const posInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0;

/**
 * The front matter of design.md with the schema's defaults, by hand. A valid design reads the same as
 * parseDesign(text).meta; an invalid one may still read, and the band shows it. Null without front matter, without a
 * project, or with a status the schema does not know.
 */
export function designMetaLite(text: string): DesignMeta | null {
  const m = frontMatterOf(text);
  if (!m) return null;
  let raw: unknown;
  try { raw = parse(m[1] ?? ''); } catch { return null; }
  const o: Obj = isObj(raw) ? raw : {};
  if (!isStr(o.project)) return null;
  const status = o.status === undefined ? 'draft' : o.status;
  if (!(DESIGN_STATUSES as readonly unknown[]).includes(status)) return null;
  return {
    title: isStr(o.title) ? o.title : '',
    project: o.project,
    locale: nonEmpty(o.locale) ? o.locale : 'en',
    summary: isStr(o.summary) ? o.summary : '',
    pillars: (Array.isArray(o.pillars) ? o.pillars : []).filter(isObj).filter(p => nonEmpty(p.title) && nonEmpty(p.text))
      .map(p => ({ title: p.title as string, text: p.text as string })),
    start_prompt: nonEmpty(o.start_prompt) ? o.start_prompt : '/waypoint:work <track>',
    status: status as DesignMeta['status'],
    ...(isStr(o.artifact) ? { artifact: o.artifact } : {}),
    ...(isStr(o.source) ? { source: o.source } : {}),
  };
}

/** design/changelog.json as parseChangelog reads it, with the same checks: [] for an empty text, null where it throws. */
export function changelogLite(text: string | null): ChangelogEntry[] | null {
  if (!text || !text.trim()) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const out: ChangelogEntry[] = [];
  for (const e of raw as unknown[]) {
    if (!isObj(e) || typeof e.version !== 'number' || typeof e.date !== 'string' || typeof e.note !== 'string'
      || typeof e.words !== 'number' || typeof e.round !== 'number') return null;
    const applied = normalizeApplied(e.applied);
    const resolved = normalizeResolved(e.resolved);
    const kind = typeof e.kind === 'string' && (ENTRY_KINDS as readonly string[]).includes(e.kind) ? (e.kind as EntryKind) : null;
    out.push({
      version: e.version, date: e.date, note: e.note, words: e.words, round: e.round,
      ...(applied ? { applied } : {}), ...(e.rewrite === true ? { rewrite: true as const } : {}), ...(resolved ? { resolved } : {}), ...(kind ? { kind } : {}),
    });
  }
  return out;
}

/** A critique as parseCritique reads it (the same checks, numbering 1..K and verdict): null where it throws. */
export function critiqueLite(text: string): Critique | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObj(raw) || !posInt(raw.round) || !posInt(raw.version) || (raw.scope !== 'full' && raw.scope !== 'changed') || !Array.isArray(raw.proposals)) return null;
  if (raw.verdict !== undefined && !(VERDICTS as readonly unknown[]).includes(raw.verdict)) return null;
  const proposals: Proposal[] = [];
  for (const [i, p] of (raw.proposals as unknown[]).entries()) {
    if (!isObj(p) || p.n !== i + 1 || !(CATEGORIES as readonly unknown[]).includes(p.category) || !(SEVERITIES as readonly unknown[]).includes(p.severity)
      || !nonEmpty(p.section) || !nonEmpty(p.problem) || !nonEmpty(p.change)) return null;
    // w7 A2: the threads a proposal takes up, read as ProposalSchema does: absent stays absent, anything but a short list of thread ids is a failure.
    if (p.threads !== undefined && !(Array.isArray(p.threads) && p.threads.length <= 20 && p.threads.every(t => isStr(t) && THREAD_ID.test(t)))) return null;
    proposals.push({
      n: i + 1, category: p.category as Proposal['category'], severity: p.severity as Proposal['severity'], section: p.section, problem: p.problem, change: p.change,
      ...(p.threads === undefined ? {} : { threads: p.threads as string[] }),
    });
  }
  const verdict = verdictOf({ proposals });
  if (raw.verdict !== undefined && raw.verdict !== verdict) return null;
  return { round: raw.round as number, version: raw.version as number, scope: raw.scope as Critique['scope'], proposals, verdict };
}
