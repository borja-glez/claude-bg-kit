import type { NoteDoc, NoteType } from './types.js';

export const NOTE_TYPES: NoteType[] = ['decision', 'idea', 'debt', 'question'];
export const MAX_NOTE = 2000;

type Note = NoteDoc & { id: string };
export type NoteFilter = 'all' | NoteType | 'mine' | 'open';

const str = (x: unknown): x is string => typeof x === 'string';

/** Strict normalizer for shared (untrusted) note docs. A missing ts becomes '' (treated as old). */
export function normalizeNote(x: unknown): NoteDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!str(o.type) || !(NOTE_TYPES as string[]).includes(o.type)) return null;
  if (!str(o.author) || !str(o.text)) return null;
  const out: NoteDoc = { ts: str(o.ts) ? o.ts : '', type: o.type as NoteType, author: o.author, text: o.text.slice(0, MAX_NOTE) };
  if (str(o.taskId)) out.taskId = o.taskId;
  if (str(o.answer)) out.answer = o.answer.slice(0, MAX_NOTE);
  if (str(o.answeredBy)) out.answeredBy = o.answeredBy;
  if (str(o.answeredAt)) out.answeredAt = o.answeredAt;
  if (str(o.proposalId) && o.proposalId && !o.proposalId.includes('/')) out.proposalId = o.proposalId;
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

export function counts(notes: NoteDoc[]): Record<NoteType | 'open', number> {
  const c: Record<NoteType | 'open', number> = { decision: 0, idea: 0, debt: 0, question: 0, open: 0 };
  for (const n of notes) {
    c[n.type]++;
    if (isOpen(n)) c.open++;
  }
  return c;
}
