// 6b-2, spec «Ideas de la persona»: the person's ideas enter through one door. An `idea` note of the roadmap without a
// proposal, or an idea the person writes in the conversation, becomes a `source: user` proposal (`proposals add --from-note`
// | `--from-chat`), and a note does so once: the ledger remembers which note each proposal came from, or which open proposal
// a note joined because it said the same (I-2). T6B2-SOURCE-USER: any `source: user` proposal is a person's idea, whatever
// flag added it, and waits for the owner unless its add event says it is the owner's. Only the roadmap
// owner's ideas take the autonomous path, and forge knows the owner only from approvals/owner, which the page writes and only
// the owner can write (`proposals pull --approvals` keeps it in .forge/roadmap-owner.json). Everything here is of `root`,
// the checkout whose proposals these are (an autonomous run's worktree, T6B2-ROOTS).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir, readEvents, type LedgerEvent } from './ledger.js';
import { loadProposal } from './proposals.js';
import { normalizeNote, NOTE_ID } from '../lib/notes.js';
import { readDocs } from '../lib/read-docs.js';
import type { NoteDoc } from '../lib/types.js';
import type { Write } from '../lib/sync.js';

/** A roadmap user as the page names one: `user:<id>`. */
export const OWNER_USER = /^user:[A-Za-z0-9_.:@+-]{1,120}$/;
export interface RoadmapOwner { user: string; decidedAt: string }

/** An ISO time as Date#toISOString writes it. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** approvals/owner as the page writes it, `{ user, decidedAt }`, or null: a user of OWNER_USER and a real ISO time. */
export function normalizeOwner(x: unknown): RoadmapOwner | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.user !== 'string' || !OWNER_USER.test(o.user)) return null;
  if (typeof o.decidedAt !== 'string' || !ISO_TIME.test(o.decidedAt) || !Number.isFinite(Date.parse(o.decidedAt))) return null;
  return { user: o.user, decidedAt: o.decidedAt };
}

/** The local copy of approvals/owner, which the last `proposals pull --approvals` read. */
export const ownerFile = (root: string): string => path.join(root, '.forge', 'roadmap-owner.json');

/** The roadmap's owner (`user:<id>`), or null when no pull learned it. */
export function roadmapOwner(root: string): string | null {
  try { return normalizeOwner(JSON.parse(readFileSync(ownerFile(root), 'utf8')))?.user ?? null; } catch { return null; }
}

/** Keeps the owner a pull read; null forgets it (the roadmap has none, or no owner rule). */
export function saveOwner(root: string, owner: RoadmapOwner | null): void {
  if (!owner) { rmSync(ownerFile(root), { force: true }); return; }
  forgeDir(root);
  writeFileSync(ownerFile(root), JSON.stringify({ user: owner.user, decidedAt: owner.decidedAt }) + '\n');
}

const FROM_NOTE = 'note:';
/** I-2: the ledger action of a note that joined the open proposal it says the same as. */
export const IDEA_MERGED = 'idea-merged';

/** The proposal each note became (`add`) or joined (`idea-merged`), by the ledger's events with `from: 'note:<id>'`: the
 *  first one counts (a v2 of it carries its original's `from`, L-15). */
function conversions(events: readonly LedgerEvent[]): Map<string, { pid: string; merged: boolean }> {
  const out = new Map<string, { pid: string; merged: boolean }>();
  for (const e of events) {
    if (e.kind !== 'proposal' || (e.action !== 'add' && e.action !== IDEA_MERGED)) continue;
    if (typeof e.id !== 'string' || typeof e.from !== 'string' || !e.from.startsWith(FROM_NOTE)) continue;
    const note = e.from.slice(FROM_NOTE.length);
    if (!out.has(note)) out.set(note, { pid: e.id, merged: e.action === IDEA_MERGED });
  }
  return out;
}

/** The proposal that already came from note `noteId`, or that it joined, or null. */
export function convertedFrom(root: string, noteId: string): string | null {
  return conversions(readEvents(root)).get(noteId)?.pid ?? null;
}

/** A person's idea that has no proposal yet: an `idea` note without proposalId, by an author that is no session (the notes
 *  forge writes in a thread are `session:` ones). */
const personsIdea = (n: NoteDoc): boolean => n.type === 'idea' && !n.proposalId && !n.author.startsWith('session:');

/** The notes of the roadmap's listing `<db>/notes`, by id (their file names), each a note id of the roadmap. */
function notesOf(root: string, db: string): Map<string, NoteDoc> {
  return new Map(Object.entries(readDocs(path.resolve(root, db, 'notes'), normalizeNote).docs).filter(([id]) => NOTE_ID.test(id)));
}

/** Note `noteId` of `<db>/notes`, whatever it is, or null. */
export function noteOf(root: string, db: string, noteId: string): NoteDoc | null {
  return notesOf(root, db).get(noteId) ?? null;
}

/** Note `noteId` of `<db>/notes` when it is a person's idea without a proposal, else null. */
export function ideaNote(root: string, db: string, noteId: string): NoteDoc | null {
  const n = noteOf(root, db, noteId);
  return n && personsIdea(n) ? n : null;
}

/** An idea waiting to become a proposal; with `proposal` and `link` when it already became one here, but the roadmap lost the
 *  note's link (m-3): only the link is to be sent again. */
export interface PendingIdea { note: string; author: string; text: string; ts: string; owner: boolean; proposal?: string; link?: Write }

const time = (s: string): number => { const t = Date.parse(s); return Number.isNaN(t) ? -Infinity : t; };

/**
 * The ideas of `<db>/notes` that wait: a person's idea notes without a proposal, oldest first (a note without a time first of
 * all), a tie by note id (L-11). `owner`: its author is the roadmap's owner. One that the ledger says became a proposal this
 * checkout still has comes with that proposal and the link to send again (m-3); one whose proposal is gone, or that joined an
 * open proposal (I-2), is left out.
 */
export function pendingIdeas(root: string, db: string): PendingIdea[] {
  const owner = roadmapOwner(root);
  const done = conversions(readEvents(root));
  const out: PendingIdea[] = [];
  for (const [id, n] of notesOf(root, db)) {
    if (!personsIdea(n)) continue;
    const c = done.get(id);
    if (c && (c.merged || !loadProposal(root, c.pid))) continue;
    const pid = c?.pid;
    out.push({ note: id, author: n.author, text: n.text, ts: n.ts, owner: owner !== null && n.author === owner,
      ...(pid !== undefined ? { proposal: pid, link: ideaLink(id, pid) } : {}) });
  }
  return out.sort((a, b) => time(a.ts) - time(b.ts) || (a.note < b.note ? -1 : a.note > b.note ? 1 : 0));
}

/** The roadmap write that links note `noteId` to the proposal it became or joined. */
export const ideaLink = (noteId: string, pid: string): Write => ({ op: 'update', collection: 'notes', doc_id: noteId, data: { proposalId: pid } });

/** L-15: the origin of proposal `id` as its last `add` event logged it, its `from` and `owner`, each when it has one. */
export function ideaOrigin(root: string, id: string): { from?: string; owner?: boolean } {
  const add = [...readEvents(root)].reverse().find(e => e.kind === 'proposal' && e.action === 'add' && e.id === id);
  return { ...(typeof add?.from === 'string' ? { from: add.from } : {}), ...(typeof add?.owner === 'boolean' ? { owner: add.owner } : {}) };
}
