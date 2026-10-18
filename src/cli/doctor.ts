import { lstatSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { syncFiles } from '../lib/sync-files.js';
import type { Plan } from '../lib/types.js';

/** A-24: the collections of the roadmap's database; a dbcache/<name> of any other was left by an older waypoint. */
export const ROADMAP_COLLECTIONS = ['state', 'sessions', 'messages', 'notes', 'plan', 'meta', 'events', 'proposals', 'approvals', 'runs'] as const;

/** Something an older waypoint left that nothing reads any more: its path from the checkout (with /) and why. */
export interface Leftover { path: string; why: string }

/** The entries of `dir` when it is a real folder (never a link that could lead outside), else none. */
const entries = (dir: string): Dirent[] => {
  try { return lstatSync(dir).isDirectory() ? readdirSync(dir, { withFileTypes: true }) : []; } catch { return []; }
};
const isFile = (f: string): boolean => { try { return lstatSync(f).isFile(); } catch { return false; } };
const isFolder = (f: string): boolean => { try { return lstatSync(f).isDirectory(); } catch { return false; } };

/**
 * A-24: what older waypoints left under `.waypoint/<project>/` of `root` that nothing reads any more:
 * - `last-head` of the checkout's seat and of each seats/<sid>/ (now last-head.json, 2a);
 * - the files of sync/ that this plan's sync no longer writes;
 * - dbcache/<collection> of a collection the roadmap does not have.
 * known.json (sync --known) and stop-ack (the Stop hook, per seat) are still read. Only plain files and folders are
 * listed, never a link (nor anything under one), and never anything outside `.waypoint/<project>/`.
 */
export function leftoversOf(root: string, plan: Plan): Leftover[] {
  const top = path.join(root, '.waypoint');
  const wp = path.join(top, plan.project);
  if (!isFolder(top) || !isFolder(wp)) return [];
  const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');
  const out: Leftover[] = [];
  const seats = [wp, ...entries(path.join(wp, 'seats')).filter(d => d.isDirectory()).map(d => path.join(wp, 'seats', d.name))];
  for (const seat of seats) {
    const f = path.join(seat, 'last-head');
    if (isFile(f)) out.push({ path: rel(f), why: 'replaced by last-head.json' });
  }
  const keep = syncFiles(plan);
  for (const d of entries(path.join(wp, 'sync'))) {
    if (d.isFile() && d.name.endsWith('.json') && !keep.has(d.name)) out.push({ path: rel(path.join(wp, 'sync', d.name)), why: 'a batch this plan no longer writes' });
  }
  for (const d of entries(path.join(wp, 'dbcache'))) {
    if (d.isDirectory() && !(ROADMAP_COLLECTIONS as readonly string[]).includes(d.name)) {
      out.push({ path: rel(path.join(wp, 'dbcache', d.name)), why: 'a collection the roadmap does not have' });
    }
  }
  return out;
}
