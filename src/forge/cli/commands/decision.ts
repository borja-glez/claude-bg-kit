import type { Command } from '../context.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readExecution } from '../../execution.js';
import { UsageError } from '../errors.js';
import { mainCheckout } from '../../local.js';
import {
  addDecision, allDecisions, listDecisions, renderDecisionsMd, decisionNoteId, decisionWrites, markPublished, publishedNs, shasOutside, shaCommits, NOTE_ID, DecisionInputError,
} from '../../decisions.js';
import { readEvents } from '../../ledger.js';
import { defaultGit } from '../exec.js';
import { normalizeNote } from '../../../lib/notes.js';
import { RUN_ID, SHA, TASK_ID, decisionScope, scopeFileName } from '../../../lib/decisions.js';

const SESSION = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;

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
    if (has('session') && (!session || !SESSION.test(session))) throw new UsageError('decision add: --session needs the waypoint session id');
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
    // K2-19: a revert names exactly the commits the decision made: each sha must be a commit of base..head.
    const undo = (raw as { undo?: Record<string, unknown> }).undo;
    if (undo && undo.type === 'git-revert' && Array.isArray(undo.shas) && typeof undo.base === 'string' && typeof undo.head === 'string'
      && SHA.test(undo.base) && SHA.test(undo.head)) {
      // The undo's cwd is relative to the main checkout and must stay inside it: git never runs anywhere else.
      const real = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
      const at = typeof undo.cwd === 'string' && undo.cwd.trim() ? path.resolve(root, undo.cwd.trim()) : null;
      if (at && !existsSync(at)) throw new UsageError(`decision add: undo.cwd ${undo.cwd} does not exist`);
      const rel = at ? path.relative(real(root), real(at)) : '';
      if (at && (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) throw new UsageError('decision add: undo.cwd must be inside the main checkout');
      const git = at ? defaultGit(at) : (io.git ?? defaultGit(repoDir));
      const list = git(['rev-list', `${undo.base}..${undo.head}`]);
      if (list === null) throw new UsageError(`decision add: undo: cannot list the commits of ${undo.base}..${undo.head}`);
      const range = list.split('\n').map(s => s.trim()).filter(Boolean);
      const named = undo.shas.filter((s): s is string => typeof s === 'string');
      const outside = shasOutside(named, range);
      if (outside.length) throw new UsageError(`decision add: undo.shas: ${outside.join(', ')} not in ${undo.base}..${undo.head}`);
      if (new Set(shaCommits(named, range)).size < named.length) throw new UsageError('decision add: undo.shas names one commit twice (a full sha and its short form)');
    }
    // An active execution names the run the decision belongs to (its scope), unless the data names one.
    const exec = readExecution(root);
    try {
      const { n, event } = addDecision(root, decision, { ts: ts(), ...(task ? { task } : {}), runId: exec?.active ? exec.runId : null });
      const closes = typeof resolves === 'string' && !resolvesRefused ? resolves : null;
      const publish = session ? decisionWrites({ event, session, eid: decisionNoteId(event, session), resolves: closes }) : null;
      // 6b-2: the note it prints is this decision's publication: decision publish does not print it again.
      if (publish) markPublished(root, [n]);
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
  if (sub === 'publish') {
    // 6b-2: the roadmap notes of the decisions forge took on its own (by !== user) since --since that no command published
    // yet, in order, for the skill to send in one batch; they count as published once printed. M-8: --run keeps that run's.
    const session = flag('session');
    if (!session || !SESSION.test(session)) throw new UsageError('decision publish: --session needs the waypoint session id');
    const since = flag('since');
    if (since === undefined || !Number.isFinite(Date.parse(since))) throw new UsageError(`decision publish: --since must be a date, got ${since ?? 'nothing'}`);
    const runId = flag('run');
    if (has('run') && (!runId || !RUN_ID.test(runId) || runId === '.' || runId === '..')) throw new UsageError('decision publish: --run needs a run id');
    const done = publishedNs(root);
    const todo = listDecisions(root, { since, ...(runId ? { run: runId } : {}), auto: true }).filter(d => !done.has(d.n));
    // n is the decision's position among the ledger's decision events (1-based), and the ledger only grows.
    const events = readEvents(root).filter(e => e.kind === 'decision');
    const publish = todo.flatMap(d => decisionWrites({ event: events[d.n - 1], session, eid: decisionNoteId(events[d.n - 1], session) }));
    if (todo.length) markPublished(root, todo.map(d => d.n));
    return json({ published: todo.length, publish });
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
  throw new UsageError('usage: forge decision add --data-file f [--task id] [--session SID] | list [--task id] [--run id] [--since iso] [--all] [--auto] | publish --session SID --since iso [--run id] | show <n> | md --scope s [--out f] [--locale es|en]');
};
