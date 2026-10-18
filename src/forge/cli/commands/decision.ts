import type { Command } from '../context.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readExecution } from '../../execution.js';
import { UsageError } from '../errors.js';
import { mainCheckout } from '../../local.js';
import { addDecision, allDecisions, listDecisions, renderDecisionsMd, decisionNoteId, decisionWrites, NOTE_ID, DecisionInputError } from '../../decisions.js';
import { normalizeNote } from '../../../lib/notes.js';
import { TASK_ID, decisionScope, scopeFileName } from '../../../lib/decisions.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, ts } = ctx;
  const [sub, arg] = args;
  // One record per repository: a run member in its task worktree writes and reads the main checkout's ledger,
  // where the coordinator's reports, lens, the band and /forge:decisions look.
  const root = mainCheckout(io.cwd);
  if (sub === 'add') {
    const file = flag('data-file');
    if (!file) throw new UsageError('decision add: --data-file is required');
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, file), 'utf8')); } catch { throw new UsageError('decision add: --data-file must be a JSON object'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('decision add: --data-file must be a JSON object');
    // H-17: `--session` (this session's waypoint id) makes it print the roadmap writes; `resolves` (the question note
    // the decision answers) is not part of the decision itself.
    const session = flag('session');
    if (has('session') && (!session || !/^[A-Za-z0-9_\-.~:@+]{1,80}$/.test(session))) throw new UsageError('decision add: --session needs the waypoint session id');
    const { resolves, ...decision } = raw as Record<string, unknown>;
    if (resolves !== undefined && (typeof resolves !== 'string' || !NOTE_ID.test(resolves))) throw new UsageError('decision add: resolves must be the id of a note');
    // Carry 6: only --session prints the update that closes the question; without it nothing would close it.
    if (resolves !== undefined && !session) throw new UsageError('decision add: resolves needs --session, which prints the update that closes the question');
    const task = flag('task');
    if (task !== undefined && (!TASK_ID.test(task) || task === '.' || task === '..')) throw new UsageError(`decision add: invalid --task ${task}`);
    // Carry 6: with --db (the listed cache), a question someone already answered is not answered again.
    const dbArg = flag('db');
    if (has('db') && !dbArg) throw new UsageError('decision add: --db needs the listed cache directory');
    let resolvesRefused: string | null = null;
    if (typeof resolves === 'string' && dbArg) {
      try {
        const q = normalizeNote(JSON.parse(readFileSync(path.resolve(io.cwd, dbArg, 'notes', `${resolves}.json`), 'utf8')));
        if (q?.answer) resolvesRefused = `${resolves} is already answered${q.answeredBy ? ` by ${q.answeredBy}` : ''}: it is left as it is`;
      } catch { /* not listed: nothing to judge */ }
    }
    // An active execution names the run the decision belongs to (its scope), unless the data names one.
    const exec = readExecution(root);
    try {
      const { n, event } = addDecision(root, decision, { ts: ts(), ...(task ? { task } : {}), runId: exec?.active ? exec.runId : null });
      const closes = typeof resolves === 'string' && !resolvesRefused ? resolves : null;
      const publish = session ? decisionWrites({ event, session, eid: decisionNoteId(event, session), resolves: closes }) : null;
      return json({ n, ...event, ...(publish ? { publish } : {}), ...(resolvesRefused ? { resolvesRefused } : {}) });
    } catch (e) {
      if (e instanceof DecisionInputError) throw new UsageError(`decision add: ${e.message}`);
      throw e;
    }
  }
  if (sub === 'list') {
    const since = flag('since');
    if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new UsageError(`decision list: --since must be a date, got ${since}`);
    // Carry 4: --task is that task of its project (--project, else the ledger's), never another plan's of the same id.
    return json(listDecisions(root, { task: flag('task'), ...(flag('project') !== undefined ? { project: flag('project') } : {}), run: flag('run'), since, all: has('all'), auto: has('auto') }));
  }
  if (sub === 'show') {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1) throw new UsageError('decision show: <n> must be a positive integer');
    const d = allDecisions(root).find(x => x.n === n);
    if (!d) throw new UsageError(`decision show: there is no decision ${n}`);
    return json(d);
  }
  if (sub === 'md') {
    const scope = flag('scope');
    if (!scope) throw new UsageError('decision md: --scope is required');
    const outFlag = flag('out');
    // The file is project content (it goes to git with the work): by default under the code's directory.
    const out = outFlag !== undefined ? path.resolve(io.cwd, outFlag) : path.join(repoDir, 'docs', 'forge', 'decisions', `${scopeFileName(scope)}.md`);
    if (!out.endsWith('.md')) throw new UsageError('decision md: --out must be a .md file');
    const list = allDecisions(root).filter(d => d.by !== 'user' && (decisionScope(d) ?? 'forge') === scope);
    if (!list.length) return json({ written: false, scope, count: 0 });
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, renderDecisionsMd(list, scope, flag('locale') ?? 'en'));
    return json({ written: true, scope, count: list.length, path: out });
  }
  throw new UsageError('usage: forge decision add --data-file f [--task id] [--session SID] | list [--task id] [--run id] [--since iso] [--all] [--auto] | show <n> | md --scope s [--out f] [--locale es|en]');
};
