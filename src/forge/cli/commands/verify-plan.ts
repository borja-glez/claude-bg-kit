import type { Command } from '../context.js';
import { lstatSync, rmSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '../../ledger.js';
import { planLocale } from '../../../lib/locale.js';
import { PATH_ORDER } from '../../triage.js';
import { UsageError } from '../errors.js';
import { onPath } from '../../validators.js';
import { toolGaps } from '../../tools.js';
import { verifyPlan, askFor, capLines, relabelDiff, type PlanSurface } from '../../verify.js';
import { readLocal, readLearned, surfacePermissions, type SurfacePermission } from '../../local.js';
import { readSurfaces, detectDrafts, surfaceFile, type Surface } from '../../surfaces.js';
import { defaultGit, repoReader } from '../exec.js';
import { mcpOf, surfaceBlob } from '../shared.js';

// The whole diff of a surface whose question shows it capped, in <root>/.forge/work/surfaces/<name>-<hash 16>.diff
// (written to a new file, then renamed into place): its absolute path, or null when it cannot be written or a
// directory on the way is a link (a commit can ship .forge/work as one, to make forge write elsewhere).
function writeFullDiff(root: string, name: string, hash: string, diff: string): string | null {
  let dir = root;
  for (const part of ['.forge', 'work', 'surfaces']) {
    dir = path.join(dir, part);
    try { if (lstatSync(dir).isSymbolicLink()) return null; } catch { /* missing: made below */ }
  }
  const file = path.join(dir, `${name}-${hash.slice(0, 16)}.diff`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, diff, { flag: 'wx' });
    renameSync(tmp, file);
    return file;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* leave it */ }
    return null;
  }
}

// What the question about a surface that is not allowed shows: for a changed one, the diff from the blob allowed to the
// file now (its header naming the file, capped; null without a stored blob, when git cannot, or when nothing differs)
// and the commits since the allowance (the last 3 of the file when its commit is unknown), then the question with its
// three answers. A capped diff says so (diffTruncated) and leaves the whole one in diffFile (null when it could not be
// written), so a line pushed past the cap is still shown. Every git call ignores replace refs, which anyone who can
// write the repository's refs could use to show another content than the one allowed. `dir`: where the surface was
// read; `work`: the caller's directory, which holds forge's own files.
function surfaceQuestion(p: PlanSurface, s: Surface, perm: SurfacePermission | undefined, git: (args: string[]) => string | null, dir: string, work: string, es: boolean): PlanSurface {
  if (p.permission === 'allowed') return p;
  if (p.permission === 'ask') return { ...p, ask: askFor(s, 'ask', es) };
  const lines = (out: string | null) => (out ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  let diff: string | null = null;
  let cut: Pick<PlanSurface, 'diffTruncated' | 'diffFile'> = {};
  if (perm?.blob) {
    const now = surfaceBlob(dir, s.file);
    const d = now ? git(['--no-replace-objects', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', perm.blob, now]) : null;
    if (d && now) {
      const full = relabelDiff(d, perm.blob, now, s.file);
      diff = capLines(full, 120, es);
      if (diff !== full) cut = { diffTruncated: true, diffFile: writeFullDiff(work, s.name, p.hash, full) };
    }
  }
  const since = perm?.commit ? git(['--no-replace-objects', 'log', '--oneline', '-n', '10', `${perm.commit}..HEAD`, '--', s.file]) : null;
  const commits = lines(since ?? git(['--no-replace-objects', 'log', '--oneline', '-n', '3', '--', s.file]));
  return { ...p, diff, ...cut, commits, ask: askFor(s, 'changed', es) };
}

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, ts } = ctx;
  const task = flag('task'), p = flag('path'), base = flag('base');
  if (!task || !p || !base) throw new UsageError('verify-plan: --task, --path and --base are required');
  if (!(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`verify-plan: --path must be one of ${PATH_ORDER.join('|')}`);
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-plan: --locale must be es|en');
  // I2: --dir <review dir> (reviews-<n>-<round>): swarm step waits there for the verify agent of the surfaces it chose.
  const dirArg = flag('dir');
  const roundDir = dirArg === undefined ? null : path.resolve(io.cwd, dirArg);
  const roundOf = roundDir ? /^reviews-(\d+)-(\d+)$/.exec(path.basename(roundDir)) : null;
  if (has('dir') && !roundOf) throw new UsageError('verify-plan: --dir must be a review dir, .forge/work/<project>/<T>/reviews-<n>-<round> (a loose task: .forge/work/<id>/reviews-<n>-<round>)');
  const es = (loc ?? planLocale(io.cwd)) === 'es';
  const git = io.git ?? defaultGit(io.cwd);
  const diff = git(['diff', '--name-only', `${base}..HEAD`]);
  // The surfaces of the code checked (--cwd: a task's worktree), the permissions of this machine.
  const surfaces = readSurfaces(repoDir, readLearned(io.cwd));
  // A local.yaml git tracks grants no surface (final-carries 7).
  const read = readLocal(io.cwd);
  const local = { ...read, surfaces: surfacePermissions(io.cwd, read) };
  let inventory: Set<string> | null = null;
  const plan = verifyPlan({
    path: p, asked: has('asked'),
    changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean),
    surfaces, drafts: detectDrafts(repoReader(repoDir)), local,
    tools: s => (s.tools.length ? toolGaps(s.tools, { onPath, inventory: inventory ??= mcpOf(io, repoDir) }) : { missing: [], unknown: [] }),
  });
  appendEvent(io.cwd, { ts: ts(), kind: 'verify', task, planned: plan.eligible, surfaces: plan.surfaces.filter(s => s.permission === 'allowed').map(s => s.name) });
  if (roundDir && roundOf) {
    // verify-pending.json: the surfaces it can verify (allowed now) and what a verify agent needs to be spawned
    // again. A surface the coordinator decides not to verify is logged as a verify-skip; with none, no marker.
    const pending = path.join(roundDir, 'verify-pending.json');
    const chosen = plan.surfaces.filter(s => s.permission === 'allowed');
    const rel = (f: string) => path.relative(io.cwd, f).split(path.sep).join('/');
    const work = path.dirname(roundDir);
    const [, n, round] = roundOf;
    if (plan.eligible && chosen.length) {
      mkdirSync(roundDir, { recursive: true });
      writeFileSync(pending, JSON.stringify({
        task, at: ts(), surfaces: chosen.map(s => ({ name: s.name, file: surfaceFile(s.name), depth: s.depth, missing: s.missing, unknown: s.unknown })),
        brief: rel(path.join(work, `brief-${n}.md`)), diff: rel(path.join(work, `diff-${n}.patch`)), dir: rel(roundDir), evidence: rel(path.join(work, 'evidence', `${n}-${round}`)),
      }, null, 2) + '\n');
    } else rmSync(pending, { force: true });
  }
  return json({ ...plan, surfaces: plan.surfaces.map(ps => surfaceQuestion(ps, surfaces.find(s => s.name === ps.name)!, local.surfaces[ps.name], git, repoDir, io.cwd, es)) });
};
