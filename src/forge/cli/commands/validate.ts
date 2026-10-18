import type { Command } from '../context.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents } from '../../ledger.js';
import { runWorktree } from '../../execution.js';
import { samePath } from '../../../lib/worktree.js';
import { PATH_ORDER } from '../../triage.js';
import { UsageError } from '../errors.js';
import { restoringRegenerated } from '../swarm.js';
import { runWithCache, cacheGit, checkoutPrefix } from '../../validate-cache.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, runOptions, validateEvent, planAffected, type Scope, type Validator, type ValidatorResult } from '../../validators.js';
import { mainCheckout } from '../../local.js';
import { loadTrusted } from '../../trust.js';
import { noSlot } from '../../jobs.js';
import { defaultExec, defaultGit, repoReader } from '../exec.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, ts } = ctx;
  // I-03: the config's commands run only with the person's trust (exit 2 without it); denied: only the detected ones.
  const { config, state: trustState } = loadTrusted(repoDir);
  const denied = trustState === 'denied';
  const all = detectValidators(repoReader(repoDir), config);
  const p = flag('path');
  if (p !== undefined && !(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`validate: --path must be one of ${PATH_ORDER.join('|')}`);
  // --out belongs to run() (C-03), which takes one when the command comes first. One that reaches here (a flag before
  // the command, a second --out) would be ignored and its file never written.
  if (has('out')) throw new UsageError('validate: --out is taken once, with the command first: forge validate … --out <file> (--cwd after validate)');
  // --affected a,b names the files; bare (or followed by another flag) it takes those changed since --base (HEAD by
  // default; uncommitted changes included) and the untracked ones, read with -z so git quotes no name. Both relative
  // to the code's directory, as the validators see them (--relative: a project in a subdirectory).
  const affectedFiles = (): string[] => {
    const given = flag('affected');
    if (given !== undefined) return given.split(',').map(s => s.trim()).filter(Boolean);
    const git = io.git ?? defaultGit(repoDir);
    const base = flag('base') ?? 'HEAD';
    if (base.startsWith('-')) throw new UsageError('validate: --base must be a commit');
    const changed = git(['diff', '--name-only', '-z', '--relative', base, '--']);
    if (changed === null) throw new UsageError(`validate --affected: cannot diff against ${base}`);
    const others = git(['ls-files', '-z', '--others', '--exclude-standard']) ?? '';
    return [...new Set([...changed.split('\0'), ...others.split('\0')].filter(Boolean))];
  };
  let scope: Scope;
  if (has('final')) scope = { mode: 'final' };
  else if (!has('all') && has('affected')) scope = { mode: 'affected', files: affectedFiles() };
  else if (p === 'trivial' || p === 'small') scope = { mode: 'small' };
  else {
    const base = flag('base');
    const diff = base ? (io.git ?? defaultGit(io.cwd))(['diff', '--name-only', `${base}..HEAD`]) : null;
    scope = { mode: 'heavy', changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean) };
  }
  const list = selectValidators(all, scope);
  // --affected (C-02): a test validator runs only the tests related to the files (its affectedCmd); in full when a
  // path cannot go into a shell or there are too many; not at all (skipped: not-affected) when nothing relates.
  const plan = scope.mode === 'affected' ? planAffected(list, scope.files, process.platform, repoReader(repoDir).exists)
    : { run: list, skipped: new Map<string, ValidatorResult>(), notes: [] as string[] };
  const opts = runOptions(config, readEvents(io.cwd), io.now(), io.execMany);
  // --cwd the run worktree of this checkout (forge's own): what the validators regenerated there is put back.
  // Any other checkout: only the files the config's `generated` names (nothing when it names none).
  const restored: string[] = [];
  const inRun = io.workdir !== undefined && samePath(io.workdir, runWorktree(io.cwd));
  const restoreAt = { git: io.git ?? defaultGit(repoDir) };
  const runList = (misses: Validator[]) => {
    // C-03: with --out the validators wait for a slot (swarm.validateJobs); a list the cache answered whole does not.
    const go = () => (misses.length ? (io.slot ?? noSlot) : noSlot)(() => runValidators(misses, io.exec ?? defaultExec(io.cwd), config.validatorTimeoutSec, opts));
    return inRun ? restoringRegenerated(restoreAt, go, restored) : config.generated.length ? restoringRegenerated(restoreAt, go, restored, config.generated) : go();
  };
  // The tree cache (C6): an --affected pass and --no-cache never touch it; --final writes it but never reads it.
  // Its git runs at the root of the checkout being validated, never at a subdirectory: a change outside it counts;
  // the subdirectory the validators run in is part of the key (dir).
  const useCache = config.validate.cache && !has('no-cache') && scope.mode !== 'affected';
  const t0 = Date.now();
  const ran = runWithCache(plan.run, runList, {
    main: mainCheckout(io.cwd), git: useCache ? cacheGit(restoreAt.git) : restoreAt.git, dir: useCache ? checkoutPrefix(restoreAt.git) : null,
    repo: repoReader(repoDir), generated: config.generated,
    read: useCache && scope.mode !== 'final', write: useCache, now: io.now,
  });
  let k = 0;
  let results = list.map(v => plan.skipped.get(v.name) ?? ran[k++]);
  const durationMs = Date.now() - t0;
  if (has('baseline')) {
    if (flag('baseline') === undefined) throw new UsageError('validate: --baseline needs the JSON a validate run printed on the base commit');
    let baseline: unknown;
    try { baseline = JSON.parse(readFileSync(path.resolve(io.cwd, flag('baseline')!), 'utf8')); } catch { throw new UsageError('validate: --baseline must be the JSON written by forge validate'); }
    results = markPreexisting(results, baseline);
  }
  const allOk = results.every(r => !blocking(r));
  appendEvent(io.cwd, validateEvent(ts(), flag('task'), results, durationMs, scope.mode, has('base-run') ? { baseline: true } : {}));
  const out = json(results, allOk ? 0 : 1);
  if (!list.length) out.stderr = all.length ? 'no validators cover the affected paths\n' : 'no validators detected: add tests or list validators in .forge/config.yaml\n';
  out.stderr += plan.notes.map(n => `${n}\n`).join('');
  if (denied) out.stderr += 'configCommands: denied — only the validators forge detects ran\n';
  if (restored.length) out.stderr += `restored ${restored.length} tracked file(s) the validators regenerated: ${restored.join(', ')}\n`;
  return out;
};
