// C7 (wave 4): FORGE roadmap-doc, the one generator of state/T's forge block (v2), its evidence and its exec. It reads
// what forge keeps (the task's status, its ledger events, the execution, its work folders) and writes the `data` of one
// `update state/T` to a file. The swarm commands that publish (J-15) call it in process through publishFor.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { readExecution, executionTaskFile } from './execution.js';
import { readEvents, readStatus, readStatuses } from './ledger.js';
import { mainCheckout } from './local.js';
import { eventsOf, projectOf, readWorkDir, type TaskRef } from './task-ref.js';
import { parseVerifyFile } from './verdict.js';
import { buildRoadmapData, type Asset, type ReviewDir, type VerifyRound } from './roadmap-doc.js';
import { FORGE_DOC_MAX, fitForgeDoc, parseForgeDocV2, type IntegrationV2 } from '../lib/roadmap-doc.js';
import { isSafeId, normalizePublicTask, type ExecTask, type ExecutionState } from '../lib/execution-state.js';
import { statusKey } from '../lib/forge-status.js';
import { samePath } from '../lib/worktree.js';

export class RoadmapDocError extends Error {
  constructor(readonly code: 2 | 3, message: string) { super(message); this.name = 'RoadmapDocError'; }
}
/** `roadmapFit`: a seam for tests, the fit that decides exit 3 (fitForgeDoc by default). */
export interface DocIo { cwd: string; workdir?: string; now: () => Date; roadmapFit?: typeof fitForgeDoc }
export interface GenerateOptions {
  project?: string | null; out?: string | null; assets?: string | null;
  /** Fields the command adds to the same update: the claim of a task, a task done with its commit. */
  extra?: Record<string, unknown>;
  /** The blocks to write (swarm merge: the forge block alone); all three by default. */
  only?: readonly ('forge' | 'evidence' | 'exec')[];
}
export type StateWrite = { op: 'update'; collection: 'state'; doc_id: string; file_path: string };
export interface Generated { task: string; project: string | null; bytes: number; file: string; write: StateWrite; dropped: string[]; data: Record<string, unknown> }

const ASSET_ID = /^[A-Za-z0-9_-]{1,100}$/;
// Asset urls from the roadmap's own store, as the page accepts them: the artifact asset host or a /_blob/<id> path.
const safeUrl = (u: unknown): u is string => typeof u === 'string' && (u.startsWith('https://claude.ai/') || /^\/_blob\/[\w-]+$/.test(u));
const slash = (p: string) => p.split(path.sep).join('/');
const readText = (f: string): string | null => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f: string): unknown => { const t = readText(f); if (t === null) return undefined; try { return JSON.parse(t); } catch { return undefined; } };
/** The mtime of a file or folder as an ISO time; null when it is not there. */
const mtimeOf = (f: string): string | null => { try { return statSync(f).mtime.toISOString(); } catch { return null; } };
function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}
const git = (dir: string, args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 }).trim(); } catch { return null; }
};
/** A path relative to `root` with `/`; never absolute (a folder on another drive keeps its part from `.forge/`). */
const relOf = (root: string, p: string): string => {
  const r = slash(path.relative(root, p));
  if (!path.isAbsolute(r) && !r.startsWith('..')) return r;
  const at = r.indexOf('.forge/');
  return at >= 0 ? r.slice(at) : path.basename(p);
};

/** The repository's default branch: origin's HEAD, else main or master; null when none. */
function defaultBranch(dir: string): string | null {
  const origin = git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '');
  if (origin) return origin;
  for (const b of ['main', 'master']) if (git(dir, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]) !== null) return b;
  return null;
}

/** G-06 outside an execution: the branch and HEAD of `dir`, and whether HEAD is in the default branch; null without commits. */
export function integrationAt(dir: string): IntegrationV2 | null {
  const sha = git(dir, ['rev-parse', 'HEAD']);
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const target = defaultBranch(dir);
  if (!sha || !branch || !target) return null;
  return { branch, sha, merged: git(dir, ['merge-base', '--is-ancestor', sha, target]) !== null, target };
}

/** G-06 in an execution: the run branch, the sha swarm integrate kept, and whether the run reached its base. */
function integrationInRun(main: string, e: ExecutionState, t: ExecTask): IntegrationV2 {
  const sha = t.sha ?? null;
  return { branch: e.branch, sha, merged: !!sha && git(main, ['merge-base', '--is-ancestor', sha, e.base]) !== null, target: e.base };
}

/**
 * The review dirs of the task in its work folders (the first folder that has one wins) and the verify.json of each.
 * Only `reviews-<b>-<n>` directly under the work folder: the `earlier-<runId>/` folders prep sets aside are never read.
 * `at` is the mtime of the review dir and of the verify.json.
 */
function readReviews(folders: readonly { root: string; dir: string }[]): { reviews: ReviewDir[]; verifies: VerifyRound[] } {
  const seen = new Set<string>();
  const verified = new Set<string>();
  const reviews: ReviewDir[] = [];
  const verifies: VerifyRound[] = [];
  for (const f of folders) {
    let names: string[] = [];
    try { names = readdirSync(f.dir); } catch { continue; }
    for (const name of names.sort()) {
      const m = /^reviews-(\d+)-(\d+)$/.exec(name);
      if (!m) continue;
      const brief = Number(m[1]), n = Number(m[2]);
      let files: string[] = [];
      try { files = readdirSync(path.join(f.dir, name)).sort(); } catch { files = []; }
      // A review dir is taken from the first folder that has it; its verify.json from the first one that has a valid one.
      if (!seen.has(name)) { seen.add(name); reviews.push({ brief, n, files, at: mtimeOf(path.join(f.dir, name)) }); }
      if (verified.has(name)) continue;
      const verifyFile = path.join(f.dir, name, 'verify.json');
      const file = files.includes('verify.json') ? parseVerifyFile(readText(verifyFile)) : null;
      if (!file) continue;
      verified.add(name);
      // forge-verify writes verify.json in the review dir and its screenshots in evidence/<brief>-<n>/.
      const evidence = path.join(f.dir, 'evidence', `${brief}-${n}`);
      verifies.push({ brief, n, file, local: relOf(f.root, evidence), shotPath: shot => path.resolve(evidence, shot), at: mtimeOf(verifyFile) });
    }
  }
  return { reviews, verifies };
}

const isAsset = (a: unknown): a is { path: string; id: string; url: string } =>
  !!a && typeof a === 'object' && typeof (a as Asset).path === 'string' && !!(a as Asset).path && typeof (a as Asset).id === 'string' && ASSET_ID.test((a as Asset).id) && safeUrl((a as Asset).url);

/** --assets: the uploads the skill wrote, `[{path, id, url}]`; an entry with an unsafe id or url, or without a path, is left out. */
function parseAssets(cwd: string, file: string): Asset[] {
  const raw = readJson(path.resolve(cwd, file));
  if (!Array.isArray(raw)) throw new RoadmapDocError(2, `roadmap-doc: --assets ${file} cannot be read as a JSON list of {path, id, url}`);
  return raw.filter(isAsset).map(a => ({ path: path.resolve(cwd, a.path), id: a.id, url: a.url }));
}
const readAssets = (file: string): Asset[] => { const raw = readJson(file); return Array.isArray(raw) ? raw.filter(isAsset) : []; };
const mergeAssets = (old: readonly Asset[], add: readonly Asset[]): Asset[] => [...old.filter(o => !add.some(a => samePath(a.path, o.path))), ...add];

/**
 * C7: the state/T write of one task. Reads, in this order: its status (C5; the alias status.json only when it names
 * this task), its events (C4: only those of (project, task)), the execution of the main checkout and its public file,
 * its work folders (where this runs, then the main checkout: review dirs, verify files, deferred.json) and the uploads
 * kept in <WORK>/assets.json. Writes `--out`, by default <WORK>/roadmap-doc.json where this runs. Exit 2 when forge
 * knows nothing of the task (no status, no event, no task in the run) or an argument is wrong; 3 when the block does
 * not validate or does not fit in 4096 bytes.
 */
export function generateRoadmapDoc(io: DocIo, task: string, opts: GenerateOptions = {}): Generated {
  if (!isSafeId(task)) throw new RoadmapDocError(2, `roadmap-doc: ${String(task).slice(0, 80)} is not a task id`);
  if (opts.project != null && !isSafeId(opts.project)) throw new RoadmapDocError(2, 'roadmap-doc: --project is not a project id');
  const main = mainCheckout(io.cwd);
  const here = io.workdir ?? io.cwd;
  const events = readEvents(io.cwd);
  const execution = readExecution(main);
  const inRun = !!execution?.tasks[task] && (execution.kind !== 'plan' || opts.project == null || opts.project === execution.project);
  const project = opts.project ?? (inRun && execution!.kind === 'plan' ? execution!.project : projectOf(events, task));
  const ref: TaskRef = { project, task };
  const mine = eventsOf(events, ref);
  const key = statusKey(task, project);
  const alias = readStatus(main);
  const status = (key ? readStatuses(main)[key] : undefined)
    ?? (alias && alias.task === task && (alias.project ?? null) === project ? alias : null);
  const execTask = inRun ? execution!.tasks[task] : null;
  let publicTask = inRun ? normalizePublicTask(readJson(executionTaskFile(main, task))) : null;
  if (publicTask && (publicTask.task !== task || publicTask.runId !== execution!.runId)) publicTask = null;
  if (!status && !mine.length && !execTask) throw new RoadmapDocError(2, `roadmap-doc: forge has no status, event or execution task of ${task}`);

  const roots = [...new Set([here, io.cwd, main].map(r => path.resolve(r)))];
  const folders = roots.map(root => ({ root, dir: readWorkDir(root, ref, events) })).filter(f => existsSync(f.dir));
  const { reviews, verifies } = readReviews(folders);
  const mainWork = readWorkDir(main, ref, events);
  const assetsFile = path.join(mainWork, 'assets.json');
  let assets = readAssets(assetsFile);
  // The uploads are kept (assetsFile) only once the block has validated: an exit 3 leaves nothing new on disk.
  const added = opts.assets ? parseAssets(io.cwd, opts.assets) : null;
  if (added) assets = mergeAssets(assets, added);
  const deferredFile = roots.map(r => path.join(readWorkDir(r, ref, events), 'deferred.json')).find(f => existsSync(f));
  let evidenceMode: 'upload' | 'local' = 'upload';
  try { evidenceMode = loadConfig(main).evidence === 'local' ? 'local' : 'upload'; } catch { /* the default */ }

  const built = buildRoadmapData({
    task, status, events: mine, execution: inRun ? execution : null, execTask, publicTask, reviews, verifies,
    deferred: deferredFile ? readJson(deferredFile) : null, deferredAt: deferredFile ? mtimeOf(deferredFile) : null,
    integration: execTask && execution ? integrationInRun(main, execution, execTask) : integrationAt(here),
    assets, evidenceMode, now: io.now(),
  });
  const fit = (io.roadmapFit ?? fitForgeDoc)(built.forge);
  let drops = 0;
  const parsed = parseForgeDocV2(fit.doc, () => { drops++; });
  if (!parsed || drops || !fit.fits || fit.bytes > FORGE_DOC_MAX) {
    throw new RoadmapDocError(3, `roadmap-doc: the forge block of ${task} does not validate or is over ${FORGE_DOC_MAX} bytes (${fit.bytes})`);
  }
  if (added) writeJsonAtomic(assetsFile, assets);
  const only = opts.only ?? ['forge', 'evidence', 'exec'];
  const data: Record<string, unknown> = { ...(opts.extra ?? {}) };
  if (only.includes('forge')) data.forge = fit.doc;
  if (only.includes('evidence') && built.evidence) data.evidence = built.evidence;
  if (only.includes('exec') && built.exec) data.exec = built.exec;
  const file = path.resolve(io.cwd, opts.out ?? path.join(readWorkDir(io.cwd, ref, events), 'roadmap-doc.json'));
  writeJsonAtomic(file, data);
  return { task, project, bytes: fit.bytes, file, write: { op: 'update', collection: 'state', doc_id: task, file_path: file }, dropped: fit.dropped, data };
}

/** J-15: the `publish` of a swarm command, or null with the reason; the command's own work stands either way. */
export function publishFor(io: DocIo, task: string, opts: GenerateOptions = {}): { publish: StateWrite | null; publishError?: string } {
  try { return { publish: generateRoadmapDoc(io, task, opts).write }; }
  catch (e) { return { publish: null, publishError: (e instanceof Error ? e.message : String(e)).slice(0, 300) }; }
}
