import type { Command } from '../context.js';
import { appendEvent, retireForgeIgnore } from '../../ledger.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { loadConfig } from '../../config.js';
import { workRel } from '../../task-ref.js';
import { readLocal, updateLocal } from '../../local.js';
import { noteOnce, trustFor, trustOutput } from '../../trust.js';
import { defaultGit } from '../exec.js';
import { triageCore } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, json, ts } = ctx;
  const t = triageCore(io, args);
  // `known` mirrors what exists now: new names are added, vanished ones dropped silently.
  const known = readLocal(io.cwd).known;
  if (t.fresh.length || known.some(n => !t.names.includes(n))) updateLocal(io.cwd, s => ({ ...s, known: t.names }));
  appendEvent(io.cwd, { ts: ts(), kind: 'triage', ...(t.task ? { task: t.task } : {}), ...(t.project !== null ? { project: t.project } : {}), ...t.result, ...t.auto,
    ...(t.diff ? { diff: { base: t.diff.base, files: t.diff.stat.files.length, lines: t.diff.stat.lines } } : {}), review: t.review,
    ...(t.kind === 'bug' ? { bug: true } : {}) });
  // w8 FR5: forgeDir keeps forge's files out of git through info/exclude; a .forge/.gitignore an earlier forge left
  // (or forgeDir outside git) is named while git lists it as untracked and not ignored (a repository that ignores
  // .forge/ has opted out), so the session can tell the person. Asked after the writes. Fix round 1: one with exactly
  // forge's rules moves to info/exclude instead (retireForgeIgnore), and nothing is named.
  const git = io.git ?? defaultGit(io.cwd);
  const listed = (git(['ls-files', '--others', '--exclude-standard', '--', '.forge/.gitignore']) ?? '').trim() !== '';
  const untracked = listed && !retireForgeIgnore(io.cwd) ? { untracked: ['.forge/.gitignore'] } : {};
  // D-08: the task's work folder, by project for a plan task (.forge/work/<project>/<id>).
  const work = t.task && isSafeId(t.task) ? { work: workRel({ project: t.project, task: t.task }) } : {};
  // I-03: the commands of the config (of the code checked, --cwd) need the person's trust before forge runs them:
  // `trust`, with its question in the announcement's language and `note` the first time this hash is asked. 6b-2: inside
  // an active autonomous run, the run trusts its own (trustFor); a set its guard refused is `blocked`, with no note: nobody
  // is asked, the run rewrites it from FORGE blocked list (H-4).
  const trust = trustFor(repoDir, loadConfig(repoDir), ts());
  const asked = trust.state === 'ask' || trust.state === 'changed'
    ? { trust: trustOutput(trust, t.locale === 'es', repoDir, trust.blocked ? false : noteOnce(repoDir, trust.hash!)) } : {};
  return json({ ...t.output, ...work, ...untracked, ...asked });
};
