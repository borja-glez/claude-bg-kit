import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A-06, I-14: the JSON documents of a listing directory (an ArtifactData `list` with out_dir), by id (the file name
 * without .json), in file-name order. A file that does not parse, null, or what `normalize` rejects (null) goes to
 * `skipped` by its file name and never stops the rest; a file that is not .json is not a document. A directory that does
 * not exist reads as empty: whether that is an error is the caller's call. Node only: the CLIs use it, never a mod.
 */
export function readDocs<T>(dir: string, normalize?: (x: unknown) => T | null): { docs: Record<string, T>; skipped: string[] } {
  const docs: Record<string, T> = {};
  const skipped: string[] = [];
  let names: string[];
  try { names = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return { docs, skipped }; }
  for (const f of names) {
    const id = f.slice(0, -5);
    let value: unknown;
    try { value = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { skipped.push(f); continue; }
    const doc = value === null ? null : normalize ? normalize(value) : (value as T);
    // A file named __proto__.json would set the prototype of the result instead of a key.
    if (doc === null || doc === undefined || id === '__proto__') { skipped.push(f); continue; }
    docs[id] = doc;
  }
  return { docs, skipped };
}
