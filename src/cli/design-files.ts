// K3-10: where a design's critiques live. They are versioned with the design in docs/waypoint/<project>/design/critiques/
// (r<N>.json and dismissed.json); the ones written before waypoint 0.27.0 stay in the repository's .waypoint/<project>/
// (critique-r<N>.json and dismissed.json) and are still read. Every path comes from the design file, never from the
// working directory, so a session in a worktree or in another folder finds the same files.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCritique, type Critique } from '../lib/critique.js';
import { parseDismissed, type Dismissed, type GateCritique } from '../lib/design-gate.js';
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

/** Every round's critique, from both places, by round: docs/ wins a round both have; a broken file is a null critique. */
export function readCritiques(f: DesignFiles): CritiqueFile[] {
  const found = new Map<number, string>();
  const scan = (dir: string, re: RegExp) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const m = re.exec(name);
      if (m && Number(m[1]) > 0) found.set(Number(m[1]), path.join(dir, name));
    }
  };
  scan(f.legacy, /^critique-r(\d+)\.json$/);
  scan(f.critiques, /^r(\d+)\.json$/);
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([round, file]) => {
    let critique: Critique | null = null;
    try { critique = parseCritique(readFileSync(file, 'utf8')); } catch { critique = null; }
    return { round, critique, file };
  });
}

/** dismissed.json: the one in docs/ when it exists, else the one in .waypoint/ (missing or junk: nothing dismissed). */
export function readDismissedOf(f: DesignFiles): Dismissed {
  for (const p of [path.join(f.critiques, 'dismissed.json'), path.join(f.legacy, 'dismissed.json')]) {
    if (existsSync(p)) return parseDismissed(readFileSync(p, 'utf8'));
  }
  return {};
}

/** Writes dismissed.json in docs/ atomically (a temp file, then a rename), without empty rounds, and returns its path. What came from .waypoint/ is in `d`. */
export function writeDismissed(f: DesignFiles, d: Dismissed): string {
  const p = path.join(f.critiques, 'dismissed.json');
  const kept = Object.fromEntries(Object.entries(d).filter(([, items]) => items.length));
  writeAtomic(p, `${JSON.stringify(kept, null, 2)}\n`);
  return p;
}

/** The design's history: version → the text of design/history/v<N>.md. */
export function readHistory(dir: string): Record<number, string> {
  const hist = path.join(dir, 'design', 'history');
  const out: Record<number, string> = {};
  for (const v of listVersions(existsSync(hist) ? readdirSync(hist) : [])) out[v] = readFileSync(path.join(hist, `v${v}.md`), 'utf8');
  return out;
}
