// K3-10: where a design's critiques live. They are versioned with the design in docs/waypoint/<project>/design/critiques/
// (r<N>.json and dismissed.json); the ones written before waypoint 0.27.0 stay in the repository's .waypoint/<project>/
// (critique-r<N>.json and dismissed.json) and are still read. Every path comes from the design file, never from the
// working directory, so a session in a worktree or in another folder finds the same files.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CRITIQUE_FILE, LEGACY_CRITIQUE_FILE, parseCritique, type Critique } from '../lib/critique.js';
import { DISMISSED_MAX_CHARS, parseDismissed, unionDismissed, type Dismissed, type GateCritique } from '../lib/design-gate.js';
import { COMMENTS_MAX_BYTES, parseCommentsSeen, type CommentsSeen } from '../lib/design-comments.js';
import { listVersions } from '../lib/history.js';
import { writeAtomic } from '../lib/bound-fs.js';

export interface DesignFiles {
  /** The design file, absolute. */
  file: string;
  /** Its folder: docs/waypoint/<project>/. */
  dir: string;
  /** <folder>/design/critiques/: r<N>.json and dismissed.json, committed with the design. */
  critiques: string;
  /** <repository>/.waypoint/<project>/: critique-r<N>.json and dismissed.json from before waypoint 0.27.0. */
  legacy: string;
}

/** The repository of a design folder: <root> for <root>/docs/waypoint/<name>/, else git's top level, else the folder itself. */
export function repoRootOf(dir: string): string {
  const parts = path.resolve(dir).split(path.sep);
  if (parts.length >= 4 && parts[parts.length - 3] === 'docs' && parts[parts.length - 2] === 'waypoint') return path.resolve(dir, '..', '..', '..');
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top ? path.resolve(top) : dir;
  } catch {
    return dir;
  }
}

export function designFilesOf(file: string, project: string): DesignFiles {
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  return { file: abs, dir, critiques: path.join(dir, 'design', 'critiques'), legacy: path.join(repoRootOf(dir), '.waypoint', project) };
}

/** The critique of a round, with the file it came from. */
export interface CritiqueFile extends GateCritique { file: string }

/**
 * Every round's critique, from both places, by round: docs/ wins a round both have; a broken file is a null critique.
 * Only the round files of CRITIQUE_FILE count (no `r01.json`, no `r0.json`, no `r<N>.rejected.json`).
 */
export function readCritiques(f: DesignFiles): CritiqueFile[] {
  const found = new Map<number, string>();
  const scan = (dir: string, re: RegExp) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const m = re.exec(name);
      if (m) found.set(Number(m[1]), path.join(dir, name));
    }
  };
  scan(f.legacy, LEGACY_CRITIQUE_FILE);
  scan(f.critiques, CRITIQUE_FILE);
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([round, file]) => {
    let critique: Critique | null = null;
    try { critique = parseCritique(readFileSync(file, 'utf8')); } catch { critique = null; }
    return { round, critique, file };
  });
}

/**
 * dismissed.json of both places, merged (carry 5): .waypoint/ first, then docs/, whose reasons win (unionDismissed). Each
 * is read tolerantly: missing, unreadable (a folder), over DISMISSED_MAX_CHARS bytes or junk, it dismisses nothing and
 * hides nothing of the other.
 */
export function readDismissedOf(f: DesignFiles): Dismissed {
  const read = (p: string): Dismissed => {
    try {
      if (statSync(p).size > DISMISSED_MAX_CHARS) return {};
      return parseDismissed(readFileSync(p, 'utf8'));
    } catch { return {}; }
  };
  return unionDismissed(read(path.join(f.legacy, 'dismissed.json')), read(path.join(f.critiques, 'dismissed.json')));
}

/** Writes dismissed.json in docs/ atomically (a temp file, then a rename), without empty rounds, and returns its path. What came from .waypoint/ is in `d`. */
export function writeDismissed(f: DesignFiles, d: Dismissed): string {
  const p = path.join(f.critiques, 'dismissed.json');
  const kept = Object.fromEntries(Object.entries(d).filter(([, items]) => items.length));
  writeAtomic(p, `${JSON.stringify(kept, null, 2)}\n`);
  return p;
}

/** design/critiques/comments.json: missing, unreadable, over COMMENTS_MAX_BYTES or junk, it is {}. Only this place, never .waypoint/. */
export function readCommentsSeen(f: DesignFiles): CommentsSeen {
  const p = path.join(f.critiques, 'comments.json');
  try {
    if (statSync(p).size > COMMENTS_MAX_BYTES) return {};
    return parseCommentsSeen(readFileSync(p, 'utf8'));
  } catch { return {}; }
}

/** Writes comments.json atomically, keys in sorted order, and returns its path. */
export function writeCommentsSeen(f: DesignFiles, s: CommentsSeen): string {
  const p = path.join(f.critiques, 'comments.json');
  const sorted = Object.fromEntries(Object.entries(s).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeAtomic(p, `${JSON.stringify(sorted, null, 2)}\n`);
  return p;
}

/** The design's history: version →the text of design/history/v<N>.md. */
export function readHistory(dir: string): Record<number, string> {
  const hist = path.join(dir, 'design', 'history');
  const out: Record<number, string> = {};
  for (const v of listVersions(existsSync(hist) ? readdirSync(hist) : [])) out[v] = readFileSync(path.join(hist, `v${v}.md`), 'utf8');
  return out;
}
