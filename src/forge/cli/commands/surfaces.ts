import type { Command } from '../context.js';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NAME } from '../../config.js';
import { UsageError } from '../errors.js';
import { readLocal, updateLocal, readLearned } from '../../local.js';
import { readSurfaces, detectDrafts, surfaceFile, LEARNED_HEADINGS } from '../../surfaces.js';
import { repoReader } from '../exec.js';
import { learnSurface } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, ok, json } = ctx;
  const [sub] = args;
  if (sub === undefined || sub.startsWith('--')) {
    const surfaces = readSurfaces(io.cwd, readLearned(io.cwd));
    const local = readLocal(io.cwd);
    const drafts = detectDrafts(repoReader(repoDir)).filter(d => !surfaces.some(s => s.name === d.name) && !local.proposed.includes(d.name));
    return json({ surfaces, drafts });
  }
  const name = flag('name');
  if (!name || !NAME.test(name)) throw new UsageError(`surfaces ${sub}: --name must match ${NAME}`);
  if (sub === 'proposed') { updateLocal(io.cwd, s => ({ ...s, proposed: [...new Set([...s.proposed, name])] })); return ok('ok'); }
  if (sub === 'learn') {
    const file = path.join(io.cwd, surfaceFile(name));
    if (!existsSync(file)) throw new UsageError(`surfaces learn: ${surfaceFile(name)} does not exist`);
    if (lstatSync(file).isSymbolicLink()) throw new UsageError(`surfaces learn: ${surfaceFile(name)} is a symlink`);
    let notes: unknown;
    try { notes = JSON.parse(readFileSync(path.resolve(io.cwd, flag('notes-file') ?? ''), 'utf8')); } catch { throw new UsageError('surfaces learn: --notes-file must be a JSON array of strings'); }
    if (!Array.isArray(notes) || !notes.every(n => typeof n === 'string' && n.trim())) throw new UsageError('surfaces learn: --notes-file must be a JSON array of strings');
    // Only the headings permissionHash knows: another one would make the notes unknown text.
    const heading = flag('heading') ?? 'Learned';
    if (!(LEARNED_HEADINGS as readonly string[]).includes(heading)) throw new UsageError(`surfaces learn: --heading must be ${LEARNED_HEADINGS.join('|')}`);
    const r = learnSurface(io, io.cwd, name, notes as string[], heading);
    if ('reason' in r) throw new UsageError(`surfaces learn: ${r.reason}`);
    return json({ name, count: r.count });
  }
  throw new UsageError('usage: forge surfaces [learn --name N --notes-file F [--heading H] | proposed --name N]');
};
