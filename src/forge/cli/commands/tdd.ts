import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command, Ctx } from '../context.js';
import { UsageError } from '../errors.js';
import { TASK_N } from '../review.js';
import { defaultExec, defaultGit, repoReader } from '../exec.js';
import { tddFor } from '../shared.js';
import { loadTrustedConfig } from '../../trust.js';
import { detectValidators } from '../../validators.js';
import { sayTdd, tddForBrief } from '../../tdd.js';

/**
 * `FORGE tdd check --task <id>-<n> --base <sha> --dir <dir> [--baseline <f>] [--locale es|en]`: the Small path's TDD
 * check (it has no review-prep): runs the brief's new tests on BASE, writes `<dir>/tdd-<n>.json` and prints the row with
 * `file`, `reused` and, with --locale, `say`. Every refusal (exit 2) comes before anything is written.
 */
function tddCheck(args: string[], ctx: Ctx) {
  const { io, repoDir, flag, has, json } = ctx;
  const task = flag('task'), given = flag('base'), dirFlag = flag('dir');
  if (!task || !given || !dirFlag) throw new UsageError('tdd check: --task <id>-<n>, --base and --dir are required');
  const m = TASK_N.exec(task);
  if (!m) throw new UsageError('tdd check: --task must be <id>-<n>');
  const locale = flag('locale');
  if (has('locale') && locale !== 'es' && locale !== 'en') throw new UsageError('tdd check: --locale must be es or en');
  const config = loadTrustedConfig(repoDir);
  if (config.tdd !== 'verified') throw new UsageError(`tdd check: needs tdd: verified in .forge/config.yaml (it is ${config.tdd})`);
  const git = io.git ?? defaultGit(repoDir);
  const sha = (git(['rev-parse', '--verify', '-q', `${given}^{commit}`]) ?? '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(sha) || git(['merge-base', '--is-ancestor', sha, 'HEAD']) === null) {
    throw new UsageError(`tdd check: --base ${given.slice(0, 80)} is not HEAD or a commit below it`);
  }
  let baseline: unknown = null;
  if (has('baseline')) {
    const f = flag('baseline');
    try { baseline = JSON.parse(readFileSync(path.resolve(io.cwd, f ?? ''), 'utf8')); } catch { throw new UsageError('tdd check: --baseline must be the JSON written by forge validate'); }
  }
  const repo = repoReader(repoDir);
  const dir = path.resolve(io.cwd, dirFlag);
  const { check, row, file, reused } = tddForBrief({
    repoDir, git, execAt: defaultExec, timeoutSec: config.validatorTimeoutSec, baseline, validators: detectValidators(repo, config), repo, base: sha, dir, n: m[2],
  });
  const shown = path.relative(io.cwd, file).split(path.sep).join('/');
  return json({ ...row.tdd, file: shown, reused, ...(locale ? { say: sayTdd(check, locale as 'es' | 'en') } : {}) });
}

export const command: Command = (args, ctx) => {
  if (args[0] === 'check') return tddCheck(args.slice(1), ctx);
  const { io, repoDir, json } = ctx;
  return json(tddFor(io, repoDir));
};
