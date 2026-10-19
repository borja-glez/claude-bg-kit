import type { Command } from '../context.js';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NAME } from '../../config.js';
import { UsageError } from '../errors.js';
import { readLocal, updateLocal, readLearned, mainCheckout } from '../../local.js';
import { readSurfaces, detectDrafts, draftHeader, surfaceFile, learnedNotes, LEARNED_HEADINGS } from '../../surfaces.js';
import { readExecution } from '../../execution.js';
import { readEvents } from '../../ledger.js';
import { readWorkDir } from '../../task-ref.js';
import { flowDirs, runStart } from '../../flow.js';
import { digest, digestSay, verifyFilesOf, ENTRIES_MAX } from '../../verify-digest.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { planLocale } from '../../../lib/locale.js';
import { defaultGit, repoReader } from '../exec.js';
import { learnSurface } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, ok, json } = ctx;
  const [sub] = args;
  if (sub === undefined || sub.startsWith('--')) {
    const surfaces = readSurfaces(io.cwd, readLearned(io.cwd));
    const local = readLocal(io.cwd);
    const drafts = detectDrafts(repoReader(repoDir)).filter(d => !surfaces.some(s => s.name === d.name) && !local.proposed.includes(d.name))
      .map(d => ({ ...d, header: draftHeader(d) }));
    return json({ surfaces, drafts });
  }
  if (sub === 'digest') {
    // K2-11: what the run's verifications learned, by surface, shown once at the end of the run.
    const runId = flag('run');
    if (!runId || !isSafeId(runId)) throw new UsageError('surfaces digest: --run <runId> is required');
    const loc = flag('locale');
    if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('surfaces digest: --locale must be es|en');
    const main = mainCheckout(io.cwd);
    const es = (loc ?? planLocale(io.cwd)) === 'es';
    const e = readExecution(main);
    // The end of a run never fails here: no execution state (cleared, or never written) is an empty digest.
    if (!e) {
      const say = es ? `No hay estado de la ejecución ${runId}: nada que resumir.` : `There is no state for the run ${runId}: nothing to digest.`;
      return json({ runId, surfaces: [], dropped: 0, unread: 0, say });
    }
    if (e.runId !== runId) throw new UsageError(`surfaces digest: ${runId} is not the execution of this checkout`);
    const events = readEvents(main);
    const project = e.kind === 'plan' ? e.project : null;
    const dirs = [
      ...Object.keys(e.tasks).filter(isSafeId).map(task => ({ task, dir: readWorkDir(main, { project, task }, events) })),
      ...flowDirs(main, runId).map(dir => ({ task: path.basename(dir), dir })),
    ];
    const since = Date.parse(e.startedAt);
    // Only the first ENTRIES_MAX files are read; the others are counted.
    const files = dirs.flatMap(({ task, dir }) => verifyFilesOf(dir, since).map(file => ({ task, file })));
    const entries = files.slice(0, ENTRIES_MAX).map(({ task, file }) => ({ task, text: readFileSync(file, 'utf8') }));
    // What a surface already held is read as the run started it (the run's notes are in the working file by now: the
    // tasks' merges brought them). Without a start (nothing integrated, no git) it is the working file; with a start
    // but no file in it, the surface was born during the run and held nothing.
    const git = io.git ?? defaultGit(main);
    const start = runStart(e, git);
    const held = (surface: string): string[] => {
      if (!NAME.test(surface)) return [];
      try {
        if (start) return learnedNotes(git(['show', `${start}:${surfaceFile(surface)}`]) ?? '');
        return learnedNotes(readFileSync(path.join(main, surfaceFile(surface)), 'utf8'));
      } catch { return []; }
    };
    const { surfaces, dropped, moreSurfaces } = digest(entries, held);
    return json({ runId, surfaces, dropped, unread: files.length - entries.length, moreSurfaces, say: digestSay(surfaces, runId, es) });
  }
  const name = flag('name');
  if (!name || !NAME.test(name)) throw new UsageError(`surfaces ${sub}: --name must match ${NAME}`);
  if (sub === 'proposed') { updateLocal(io.cwd, s => ({ ...s, proposed: [...new Set([...s.proposed, name])] })); return ok('ok'); }
  if (sub === 'learn') {
    // K2-06: the surface of the code checked (--cwd: the task's worktree), the file the task commits.
    const file = path.join(repoDir, surfaceFile(name));
    if (!existsSync(file)) throw new UsageError(`surfaces learn: ${surfaceFile(name)} does not exist`);
    if (lstatSync(file).isSymbolicLink()) throw new UsageError(`surfaces learn: ${surfaceFile(name)} is a symlink`);
    let notes: unknown;
    try { notes = JSON.parse(readFileSync(path.resolve(io.cwd, flag('notes-file') ?? ''), 'utf8')); } catch { throw new UsageError('surfaces learn: --notes-file must be a JSON array of strings'); }
    if (!Array.isArray(notes) || !notes.every(n => typeof n === 'string' && n.trim())) throw new UsageError('surfaces learn: --notes-file must be a JSON array of strings');
    // Only the headings permissionHash knows: another one would make the notes unknown text.
    const heading = flag('heading') ?? 'Learned';
    if (!(LEARNED_HEADINGS as readonly string[]).includes(heading)) throw new UsageError(`surfaces learn: --heading must be ${LEARNED_HEADINGS.join('|')}`);
    const task = flag('task');
    if (has('task') && (!task || !isSafeId(task))) throw new UsageError('surfaces learn: --task must be a task id');
    const r = learnSurface(io, repoDir, name, notes as string[], heading, task ?? null);
    if ('reason' in r) throw new UsageError(`surfaces learn: ${r.reason}`);
    return json({ name, count: r.count, skipped: r.skipped });
  }
  throw new UsageError('usage: forge surfaces [learn --name N --notes-file F [--heading H] [--task id] | proposed --name N | digest --run <runId> [--locale es|en]]');
};
