import { describe, it, expect } from 'vitest';
import { MAX_NOTE, NOTE_TYPES, counts, filterNotes, normalizeNote, normalizeNoteDecision, notesSince } from '../src/lib/notes.js';
import type { NoteDoc } from '../src/lib/types.js';

type N = NoteDoc & { id: string };
const n = (id: string, o: Partial<NoteDoc> = {}): N => ({ id, ts: '2026-10-11T10:00:00Z', type: 'idea', author: 'user:u1', text: id, ...o });

describe('normalizeNote', () => {
  it('accepts a valid note and keeps optional fields', () => {
    const x = normalizeNote({ ts: 't', type: 'question', author: 'user:a', text: 'q', taskId: 'T1', answer: 'a', answeredBy: 'session:S', answeredAt: 'z' });
    expect(x).toEqual({ ts: 't', type: 'question', author: 'user:a', text: 'q', taskId: 'T1', answer: 'a', answeredBy: 'session:S', answeredAt: 'z' });
  });
  it('rejects non-objects, bad type and non-string required fields', () => {
    expect(NOTE_TYPES).toEqual(['decision', 'idea', 'debt', 'question']);
    for (const bad of [null, 3, 'x', [], { type: 'nope', author: 'a', text: 't' }, { type: 'idea', author: 1, text: 't' }, { type: 'idea', author: 'a', text: 5 }]) {
      expect(normalizeNote(bad)).toBeNull();
    }
  });
  it('tolerates a missing ts and drops non-string optionals', () => {
    const x = normalizeNote({ type: 'debt', author: 'user:a', text: 't', taskId: 7, answer: {} });
    expect(x).toEqual({ ts: '', type: 'debt', author: 'user:a', text: 't' });
  });
  it('truncates text and answer to MAX_NOTE', () => {
    expect(MAX_NOTE).toBe(2000);
    const x = normalizeNote({ ts: 't', type: 'idea', author: 'a', text: 'x'.repeat(3000), answer: 'y'.repeat(2500) })!;
    expect(x.text).toHaveLength(2000);
    expect(x.answer).toHaveLength(2000);
  });
  it('keeps answeredByNote, the decision that closed a question (H-17)', () => {
    const q = { ts: 't', type: 'question', author: 'user:1', text: 'q?', answer: 'a', answeredBy: 'session:main', answeredAt: 't' };
    expect(normalizeNote({ ...q, answeredByNote: 'e1' })?.answeredByNote).toBe('e1');
    expect(normalizeNote({ ...q, answeredByNote: 'a/b' })).not.toHaveProperty('answeredByNote');
    expect(normalizeNote({ ...q, answeredByNote: 7 })).not.toHaveProperty('answeredByNote');
  });
});

describe('normalizeNote · decision', () => {
  const DEC = { point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', alternatives: ['another round'], why: 'sin critical', revert: '/forge:decisions revert 7', auto: true };
  it('keeps a valid automatic decision, cleaned', () => {
    const x = normalizeNote({ ts: 't', type: 'decision', author: 'session:S', text: 'd', decision: { ...DEC, what: 'a\u0007b', auto: 'no' } });
    expect(x?.decision).toEqual({ ...DEC, alternatives: [{ option: 'another round' }], what: 'a b', auto: false });
  });
  it('keeps auto: true only when it is exactly true; any other decision is the person\'s (H-05)', () => {
    const autoOf = (auto: unknown) => normalizeNoteDecision({ ...DEC, auto })?.auto;
    expect(autoOf(true)).toBe(true);
    expect(autoOf(false)).toBe(false);
    expect(autoOf(undefined)).toBe(false);
    expect(autoOf('yes')).toBe(false);
  });
  it('drops an unusable decision and keeps the note', () => {
    for (const bad of [null, 'x', [], { ...DEC, point: 'nope' }, { ...DEC, why: ' ' }, { ...DEC, chosen: 3 }]) {
      const x = normalizeNote({ ts: 't', type: 'decision', author: 'session:S', text: 'd', decision: bad });
      expect(x).toEqual({ ts: 't', type: 'decision', author: 'session:S', text: 'd' });
    }
  });
  it('caps alternatives and leaves out empty optionals', () => {
    const d = normalizeNoteDecision({ ...DEC, alternatives: [...Array(12).fill('x'), 7, ''], revert: '' })!;
    expect(d.alternatives).toHaveLength(10);
    expect(d).not.toHaveProperty('revert');
    expect(normalizeNoteDecision({ ...DEC, alternatives: [] })).not.toHaveProperty('alternatives');
  });
  it('accepts structured alternatives and the chosen trade-offs, and drops what is not one (6b-1)', () => {
    const d = normalizeNoteDecision({ ...DEC, alternatives: [{ option: 'redis', whyNot: 'one more service', tradeoffs: 'faster', extra: 1 }, { nope: 1 }, 'plain'], tradeoffs: 'simple' })!;
    expect(d.alternatives).toEqual([{ option: 'redis', whyNot: 'one more service', tradeoffs: 'faster' }, { option: 'plain' }]);
    expect(d.tradeoffs).toBe('simple');
    expect(normalizeNoteDecision({ ...DEC, tradeoffs: ' ' })).not.toHaveProperty('tradeoffs');
  });
});

describe('filterNotes', () => {
  const list = [
    n('old', { ts: '2026-10-01T00:00:00Z', type: 'decision', author: 'session:S1' }),
    n('new', { ts: '2026-10-05T00:00:00Z', type: 'question' }),
    n('nots', { ts: '', type: 'debt' }),
    n('ans', { ts: '2026-10-03T00:00:00Z', type: 'question', answer: 'done' }),
  ];
  it('all sorts by ts desc with no-ts last', () => {
    expect(filterNotes(list, 'all', null).map(x => x.id)).toEqual(['new', 'ans', 'old', 'nots']);
  });
  it('filters by type', () => {
    expect(filterNotes(list, 'decision', null).map(x => x.id)).toEqual(['old']);
  });
  it('open = unanswered questions', () => {
    expect(filterNotes(list, 'open', null).map(x => x.id)).toEqual(['new']);
  });
  it('mine matches author and is empty when me is null', () => {
    expect(filterNotes(list, 'mine', 'user:u1').map(x => x.id)).toEqual(['new', 'ans', 'nots']);
    expect(filterNotes(list, 'mine', null)).toEqual([]);
  });
  it('does not mutate the input', () => {
    const copy = list.map(x => x.id);
    filterNotes(list, 'all', null);
    expect(list.map(x => x.id)).toEqual(copy);
  });
});

describe('notesSince', () => {
  const list = [
    n('u-old', { ts: '2026-10-01T00:00:00Z' }),
    n('u-new', { ts: '2026-10-05T00:00:00Z' }),
    n('s-new', { ts: '2026-10-06T00:00:00Z', author: 'session:S' }),
    n('s-q-answered', { ts: '2026-10-01T00:00:00Z', author: 'session:S', type: 'question', answer: 'a', answeredAt: '2026-10-07T00:00:00Z' }),
    n('s-q-old-answer', { ts: '2026-10-01T00:00:00Z', author: 'session:S', type: 'question', answer: 'a', answeredAt: '2026-10-02T00:00:00Z' }),
    n('u-nots', { ts: '' }),
  ];
  it('returns new user notes plus questions answered after since, ascending', () => {
    expect(notesSince(list, '2026-10-03T00:00:00Z').map(x => x.id)).toEqual(['u-new', 's-q-answered']);
  });
  it('null or invalid since returns all user notes', () => {
    const all = ['u-nots', 'u-old', 'u-new'];
    expect(notesSince(list, null).map(x => x.id)).toEqual(all);
    expect(notesSince(list, 'garbage').map(x => x.id)).toEqual(all);
  });
  it('notes without ts count as old', () => {
    expect(notesSince(list, '2000-01-01T00:00:00Z').map(x => x.id)).not.toContain('u-nots');
  });
});

describe('counts', () => {
  it('counts per type and open questions', () => {
    const c = counts([n('a', { type: 'decision' }), n('b', { type: 'question' }), n('c', { type: 'question', answer: 'x' }), n('d', { type: 'debt' })]);
    expect(c).toEqual({ decision: 1, idea: 0, debt: 1, question: 2, open: 1 });
  });
});

describe('normalizeNote proposalId', () => {
  const b = { ts: 't', type: 'idea', author: 'user:1', text: 'x' };
  it('keeps a plain string proposalId', () => {
    expect(normalizeNote({ ...b, proposalId: 'p1' })).toMatchObject({ proposalId: 'p1' });
  });
  it('drops proposalId with a slash or a non-string', () => {
    expect(normalizeNote({ ...b, proposalId: 'a/b' })!.proposalId).toBeUndefined();
    expect(normalizeNote({ ...b, proposalId: 5 })!.proposalId).toBeUndefined();
  });
});
