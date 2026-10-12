// The local copy of the roadmap database (.waypoint/<project>/dbcache) follows the session's own writes: when an
// ArtifactData write to the project's roadmap succeeds, the same change is applied to the cached documents, so the
// band and lens see a claim, a block or a finished task at once instead of at the next listing.
// Pure: the mod reads and writes the files.

// Only the collections the band and lens read from the cache.
export const MIRRORED = new Set(['state', 'sessions', 'messages']);
const SEGMENT = /^[A-Za-z0-9_.~:@+-]{1,128}$/;
const MAX_WRITES = 50;

export type MirrorWrite =
  | { op: 'set' | 'update'; collection: string; docId: string; data: Record<string, unknown> }
  | { op: 'delete'; collection: string; docId: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

// The artifact id at the end of a claude.ai artifact URL, so two spellings of one URL compare equal.
export function artifactId(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /\/artifact\/([A-Za-z0-9_-]{6,})\/?(?:[?#].*)?$/.exec(url.trim());
  return m ? m[1] : null;
}

function one(op: unknown, collection: unknown, docId: unknown, data: unknown): MirrorWrite | null {
  if (typeof collection !== 'string' || !MIRRORED.has(collection)) return null;
  if (typeof docId !== 'string' || !SEGMENT.test(docId) || docId === '.' || docId === '..') return null;
  if (op === 'delete') return { op, collection, docId };
  // A write sent from a file (file_path) is not mirrored: its content is not in the call.
  if ((op === 'set' || op === 'update') && isObj(data)) return { op, collection, docId, data };
  return null;
}

/** The mirrored writes of an ArtifactData call's input: a single set/update/delete, or a batch's entries. */
export function writesOf(input: unknown): MirrorWrite[] {
  if (!isObj(input)) return [];
  const a = input.action;
  if (a === 'set' || a === 'update' || a === 'delete') {
    const w = one(a, input.collection, input.doc_id, input.data);
    return w ? [w] : [];
  }
  if (a !== 'batch') return [];
  const list = Array.isArray(input.writes) ? input.writes : Array.isArray(input.batch) ? input.batch : [];
  return list.slice(0, MAX_WRITES).flatMap(x => {
    if (!isObj(x)) return [];
    const w = one(x.op, x.collection, x.doc_id, x.data);
    return w ? [w] : [];
  });
}

/** The cached document after the write: its JSON text, or null when the write deletes it. */
export function applyWrite(prev: string | undefined, w: MirrorWrite): string | null {
  if (w.op === 'delete') return null;
  let base: Record<string, unknown> = {};
  if (w.op === 'update' && prev !== undefined) {
    try { const p = JSON.parse(prev); if (isObj(p)) base = p; } catch { /* a corrupt copy is replaced */ }
  }
  const out: Record<string, unknown> = w.op === 'set' ? {} : { ...base };
  for (const [k, v] of Object.entries(w.data)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (isObj(v) && v.__delete__ === true && Object.keys(v).length === 1) delete out[k];
    else out[k] = v;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Whether a tool result says the write did not go through, though the tool reported no error. */
export const writeFailed = (text: unknown): boolean =>
  typeof text === 'string' && /version_mismatch|not committed|nothing (?:was )?written|refused|denied/i.test(text);
