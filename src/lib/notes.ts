import type { NoteDecision, NoteDoc, NoteSource, NoteType } from './types.js';
import { DECISION_POINTS, LIMITS, clean, normalizeAlternative, type Alternative, type DecisionPoint } from './decisions.js';

/** The types the page's composer offers. */
export const NOTE_TYPES: NoteType[] = ['decision', 'idea', 'debt', 'question'];
/** 6b-3: every type a note can have, the ones normalizeNote accepts: the composer's and forge's `market`. */
export const NOTE_KINDS: NoteType[] = [...NOTE_TYPES, 'market'];
export const MAX_NOTE = 2000;
/** 6b-3: the most sources a market note keeps; a source's URL and title are cut at MAX_URL and MAX_SOURCE_TITLE. */
export const MAX_SOURCES = 20;
const MAX_URL = 2000;
const MAX_SOURCE_TITLE = 200;
const MAX_NAME = 80;
/** The longest note or answer text a `say` line quotes. */
export const SAY_MAX = 200;

type Note = NoteDoc & { id: string };
export type NoteFilter = 'all' | NoteType | 'mine' | 'open';

const str = (x: unknown): x is string => typeof x === 'string';
/** H-17: a note id of the roadmap (an event id, or the page's own id): no `/`, at most 160 characters. The one rule
 *  (carry 6) for `answeredByNote` here and for forge's `resolves`. */
export const NOTE_ID = /^[A-Za-z0-9_.:~@+-]{1,160}$/;
/** At most `max` code points: a clip never splits a surrogate pair (carry 6). */
const clipPoints = (s: string, max: number): string => (s.length <= max ? s : Array.from(s).slice(0, max).join(''));

/** The href of `url` when a source can keep it: an http: or https: URL that `new URL` reads, of at most MAX_URL characters,
 *  with no space, control or bidi character (clean leaves it as it is), so the text kept is the link it opens, and no user or
 *  password part (`https://trusted@evil/` shows one host and opens another); else null. */
function webHref(url: string): string | null {
  if (!url || url.length > MAX_URL || /\s/.test(url) || clean(url, MAX_URL) !== url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

/**
 * 6b-3: the sources of a market note (or of a market report's finding) from untrusted JSON: each `{ title, url }` whose URL
 * webHref keeps, once per URL (the first wins), its title cleaned and cut to MAX_SOURCE_TITLE (the URL when it has none); at
 * most MAX_SOURCES. Anything else is left out.
 */
export function normalizeSources(x: unknown): NoteSource[] {
  if (!Array.isArray(x)) return [];
  const out: NoteSource[] = [];
  const seen = new Set<string>();
  for (const s of x) {
    if (out.length >= MAX_SOURCES) break;
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    const url = str(o.url) ? o.url.trim() : '';
    const href = webHref(url);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ title: (str(o.title) ? clean(o.title, MAX_SOURCE_TITLE) : '') || clean(url, MAX_SOURCE_TITLE), url });
  }
  return out;
}

/** Strict normalizer for shared (untrusted) note docs. A missing ts becomes '' (treated as old). */
export function normalizeNote(x: unknown): NoteDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!str(o.type) || !(NOTE_KINDS as string[]).includes(o.type)) return null;
  if (!str(o.author) || !str(o.text)) return null;
  const out: NoteDoc = { ts: str(o.ts) ? o.ts : '', type: o.type as NoteType, author: o.author, text: clipPoints(o.text, MAX_NOTE) };
  if (str(o.taskId)) out.taskId = o.taskId;
  if (str(o.answer)) out.answer = clipPoints(o.answer, MAX_NOTE);
  if (str(o.answeredBy)) out.answeredBy = o.answeredBy;
  if (str(o.answeredAt)) out.answeredAt = o.answeredAt;
  // H-17: the decision note that closed this question; an id, never a path.
  if (str(o.answeredByNote) && NOTE_ID.test(o.answeredByNote)) out.answeredByNote = o.answeredByNote;
  // Optional display names a writer may store next to the user:<id>; never required.
  if (str(o.authorName) && o.authorName.trim()) out.authorName = clean(o.authorName, MAX_NAME);
  if (str(o.answeredByName) && o.answeredByName.trim()) out.answeredByName = clean(o.answeredByName, MAX_NAME);
  if (str(o.proposalId) && o.proposalId && !o.proposalId.includes('/')) out.proposalId = o.proposalId;
  const decision = normalizeNoteDecision(o.decision);
  if (decision) out.decision = decision;
  // 6b-3 L-14: only a market note keeps sources, so no one can hang links on another note.
  const sources = out.type === 'market' ? normalizeSources(o.sources) : [];
  if (sources.length) out.sources = sources;
  return out;
}

/** The decision part of a shared (untrusted) note: null unless its point is known and what, chosen and why are usable. */
export function normalizeNoteDecision(x: unknown): NoteDecision | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!str(o.point) || !(DECISION_POINTS as readonly string[]).includes(o.point)) return null;
  const line = (v: unknown, max: number) => (str(v) ? clean(v, max) : '');
  const what = line(o.what, LIMITS.what);
  const chosen = line(o.chosen, LIMITS.chosen);
  const why = line(o.why, LIMITS.why);
  if (!what || !chosen || !why) return null;
  const out: NoteDecision = { point: o.point as DecisionPoint, what, chosen, why, auto: o.auto === true };
  const alternatives = Array.isArray(o.alternatives)
    ? o.alternatives.map(normalizeAlternative).filter((a): a is Alternative => a !== null).slice(0, LIMITS.alternatives) : [];
  if (alternatives.length) out.alternatives = alternatives;
  const tradeoffs = line(o.tradeoffs, LIMITS.tradeoffs);
  if (tradeoffs) out.tradeoffs = tradeoffs;
  const revert = line(o.revert, LIMITS.revert);
  if (revert) out.revert = revert;
  return out;
}

const time = (s: string | undefined): number => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};
const isOpen = (n: NoteDoc) => n.type === 'question' && !n.answer;

export function filterNotes(notes: Note[], filter: NoteFilter, me: string | null): Note[] {
  const kept = notes.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'mine') return me !== null && n.author === me;
    if (filter === 'open') return isOpen(n);
    return n.type === filter;
  });
  // Stable sort: newest first, notes without a valid ts last.
  return kept.map((n, i) => ({ n, i })).sort((a, b) => {
    const ta = time(a.n.ts);
    const tb = time(b.n.ts);
    if (ta === tb) return a.i - b.i;
    return tb > ta ? 1 : -1;
  }).map(x => x.n);
}

/** New user notes since `since`, plus questions (any author) answered since. Ascending; no-ts notes count as old. */
export function notesSince(notes: Note[], since: string | null): Note[] {
  const s = since ? Date.parse(since) : NaN;
  const valid = !Number.isNaN(s);
  const kept = notes.filter(n => {
    if (!valid) return n.author.startsWith('user:');
    if (n.author.startsWith('user:') && time(n.ts) > s) return true;
    return n.type === 'question' && !!n.answer && time(n.answeredAt) > s;
  });
  // Order by when the note last changed (an answer counts as a change).
  const key = (n: Note) => Math.max(time(n.ts), time(n.answeredAt));
  return kept.map((n, i) => ({ n, i })).sort((a, b) => {
    const ta = key(a.n);
    const tb = key(b.n);
    if (ta === tb) return a.i - b.i;
    return ta > tb ? 1 : -1;
  }).map(x => x.n);
}

const SAY = {
  es: {
    note: (who: string | undefined, text: string) => `Nota de ${who ?? 'una persona'} en el roadmap: «${text}»`,
    answer: (who: string | undefined, text: string) => `Respuesta de ${who ?? 'una persona'} en el roadmap: «${text}»`,
  },
  en: {
    note: (who: string | undefined, text: string) => `${who ? `${who}'s` : "Someone's"} note on the roadmap: "${text}"`,
    answer: (who: string | undefined, text: string) => `${who ? `${who}'s` : "Someone's"} answer on the roadmap: "${text}"`,
  },
};

/** One line, at most SAY_MAX characters (the last one an ellipsis when clipped). */
function sayText(s: string): string {
  const chars = Array.from(s.replace(/\s+/g, ' ').trim());
  return chars.length <= SAY_MAX ? chars.join('') : chars.slice(0, SAY_MAX - 1).join('') + '…';
}

/**
 * The lines a session tells the person about the notes `notesSince` returned: one per note a person wrote and one per
 * answer a person gave (each only when it is the part newer than `since`), in the locale, with the plan task ids each
 * line names (`taskIds` empty when the plan is unknown).
 */
export function noteLines(notes: NoteDoc[], since: string | null, locale: 'es' | 'en', taskIds: ReadonlySet<string>): { say: string[]; mentions: string[][] } {
  const s = since ? Date.parse(since) : NaN;
  const fresh = (ts: string | undefined) => Number.isNaN(s) || time(ts) > s;
  const say: string[] = [];
  const mentions: string[][] = [];
  const add = (line: string, text: string) => {
    say.push(line);
    mentions.push([...new Set([...text.matchAll(/\bT\d{3,}\b/g)].map(m => m[0]))].filter(id => taskIds.has(id)));
  };
  for (const n of notes) {
    if (n.author.startsWith('user:') && fresh(n.ts)) add(SAY[locale].note(n.authorName, sayText(n.text)), n.text);
    if (n.answer && n.answeredBy?.startsWith('user:') && fresh(n.answeredAt)) add(SAY[locale].answer(n.answeredByName, sayText(n.answer)), n.answer);
  }
  return { say, mentions };
}

export function counts(notes: NoteDoc[]): Record<NoteType | 'open', number> {
  const c: Record<NoteType | 'open', number> = { decision: 0, idea: 0, debt: 0, question: 0, market: 0, open: 0 };
  for (const n of notes) {
    c[n.type]++;
    if (isOpen(n)) c.open++;
  }
  return c;
}
