import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, statSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parsePlan, PlanError, isPlanId } from '../lib/plan.js';
import { buildDocs, buildSyncWrites, planHash, planViewFromDocs, type Known } from '../lib/sync.js';
import { normalizeMeta, normalizePhase } from '../page/normalize.js';
import { availableTasks, commitShas } from '../lib/deps.js';
import { pickTask, conflictsFor, recoverableTasks, inboxFor, escalationCandidates, IDLE_MINUTES } from '../lib/coordination.js';
import { parseDesign, changedSections, DesignError } from '../lib/design.js';
import { listVersions, nextVersion, parseChangelog, appendChangelog } from '../lib/history.js';
import { parseCritique, selectProposals, formatProposals, CritiqueError } from '../lib/critique.js';
import { buildDesignPageData } from '../design-page/build.js';
import { eventId, sessionIdFrom } from '../lib/ids.js';
import { computeMetrics } from '../lib/metrics.js';
import { normalizeNote, notesSince } from '../lib/notes.js';
import { pickProject } from '../mod/model.js';
import { BRANCH_RE, mainWorktreeFrom } from '../lib/worktree.js';
import { planLocale, replyIn } from '../lib/locale.js';
import { launchRun, type Launcher } from '../lib/launcher.js';
import type { MessageDoc, NoteDoc, PhaseDoc, PlanView, SessionDoc, TaskState } from '../lib/types.js';

export interface Io { cwd: string; now: () => Date; rand?: () => number; assetsDir: string; stdin?: string; env?: Record<string, string | undefined> }
type Result = { code: number; stdout: string; stderr: string };

const USAGE = `usage: waypoint <validate|hash|clean-cache|page|sync|next|conflicts|recover|notes|inbox|escalations|launch|status|session-id|event-id|now|commit-info|design-validate|design-snapshot|design-changed|critique-check|critique-select|design-page|hook> ...`;

export function run(argv: string[], io: Io): Result {
  const [cmd, ...args] = argv;
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const abs = (p: string) => path.resolve(io.cwd, p);
  const ok = (stdout: string): Result => ({ code: 0, stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n`, stderr: '' });
  const fail = (stderr: string, code = 1): Result => ({ code, stdout: '', stderr: `${stderr}\n` });
  const loadPlan = () => parsePlan(readFileSync(abs(args[0]), 'utf8'));
  const docs = <T>(name: string) => readDocs<T>(flag(name) && abs(flag(name)!));
  // An optional --sessions listing that is given but missing would make every owner look idle.
  const optSessions = () => {
    if (!flag('sessions')) return undefined;
    if (!existsSync(abs(flag('sessions')!))) throw new CacheError(`${cmd}: --sessions cache missing — list it first`);
    return docs<SessionDoc>('sessions');
  };
  // The runtime plan: the db plan cache (--db <dbcache dir>) when given, else the plan file.
  const loadView = (): { view: PlanView; project: string; version: string } => {
    const p = loadPlan();
    const db = flag('db');
    if (!db) return { view: p, project: p.project, version: p.version };
    const metaFile = path.join(abs(db), 'meta', 'project.json');
    const phases = Object.values(readDocs<unknown>(path.join(abs(db), 'plan'))).map(normalizePhase).filter((x): x is PhaseDoc => !!x);
    const meta = existsSync(metaFile) ? normalizeMeta(JSON.parse(readFileSync(metaFile, 'utf8'))) : null;
    if (!meta || !phases.length) throw new CacheError('db plan cache missing — list meta and plan first');
    return { view: planViewFromDocs(meta, phases), project: p.project, version: meta.version || p.version };
  };

  try {
    switch (cmd) {
      case 'validate': {
        const p = loadPlan();
        return ok(`ok: ${p.tasks.length} tasks, ${p.phases.length} phases, ${p.tracks.length} tracks`);
      }
      case 'clean-cache': {
        const p = loadPlan();
        const collection = args[1] ?? '';
        if (!/^[a-z_]{1,32}$/.test(collection)) return fail('clean-cache: <collection> must match ^[a-z_]{1,32}$', 2);
        const root = path.join(io.cwd, '.waypoint');
        const target = path.resolve(root, p.project, 'dbcache', collection);
        if (!target.startsWith(root + path.sep)) return fail('clean-cache: path escapes .waypoint', 2);
        rmSync(target, { recursive: true, force: true });
        return ok(target);
      }
      case 'hash':
        return ok(planHash(loadPlan()));
      case 'page': {
        const p = loadPlan();
        const out = abs(flag('out') ?? '.waypoint/roadmap.html');
        const snapshot = buildDocs(p, io.now().toISOString());
        const tpl = readFileSync(path.join(io.assetsDir, 'roadmap.template.html'), 'utf8');
        const html = tpl
          .replace('__TITLE__', () => `${p.project} Roadmap`)
          .replace('__SNAPSHOT__', () => JSON.stringify(snapshot).replace(/</g, '\\u003c'));
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, html);
        return ok(out);
      }
      case 'sync': {
        const p = loadPlan();
        const knownPath = flag('known');
        const known: Known = knownPath && existsSync(abs(knownPath)) ? JSON.parse(readFileSync(abs(knownPath), 'utf8')) : {};
        const session = flag('session') ?? 'main';
        const now = io.now();
        const outDir = abs(flag('out') ?? '.waypoint/sync');
        const { files, batches } = buildSyncWrites(p, known, outDir, {
          nowIso: now.toISOString(),
          sessionId: session,
          eventId: eventId(now, session, io.rand),
          states: readDocs<TaskState>(flag('states') && abs(flag('states')!)),
        });
        mkdirSync(outDir, { recursive: true });
        for (const [file, body] of Object.entries(files)) writeFileSync(file, JSON.stringify(body, null, 2));
        return ok(JSON.stringify({ batches }));
      }
      case 'next': {
        const session = flag('session');
        if (!session) return fail('next: --session is required', 2);
        const hasBase = args.includes('--base');
        const base = flag('base');
        if (hasBase && (!base || !BRANCH_RE.test(base))) return fail('next: --base needs a branch name', 2);
        const { view } = loadView();
        const sessions = optSessions();
        const states = docs<TaskState>('states');
        const integrated = base ? integratedShas(view, states, base, io.cwd) : undefined;
        const r = pickTask(view, states, { sessionId: session, track: flag('track'), sessions, now: io.now().getTime(), integrated });
        // unblock is only reported when true, as before
        const { unblock, ...rest } = r;
        return ok(JSON.stringify(unblock ? r : rest));
      }
      case 'conflicts': {
        const session = flag('session');
        const task = flag('task');
        if (!session || !task) return fail('conflicts: --session and --task are required', 2);
        const { view } = loadView();
        const sessions = optSessions();
        return ok(JSON.stringify(conflictsFor(view, docs<TaskState>('states'), task, session, sessions, io.now().getTime())));
      }
      case 'recover': {
        // Missing listings would make every owner look idle: refuse instead of guessing.
        for (const f of ['states', 'sessions']) {
          if (!flag(f) || !existsSync(abs(flag(f)!))) return fail(`recover: --${f} cache missing — list it first`);
        }
        const { view } = loadView();
        const minutes = Number(flag('minutes') ?? IDLE_MINUTES);
        return ok(JSON.stringify(recoverableTasks(
          view,
          docs<TaskState>('states'),
          docs<SessionDoc>('sessions'),
          io.now().getTime(),
          Number.isFinite(minutes) ? minutes : IDLE_MINUTES,
        )));
      }
      case 'notes': {
        const dir = flag('notes');
        if (!dir) return fail('notes cache missing — list notes first');
        // No notes directory yet means nobody has written a note: not an error.
        if (!existsSync(abs(dir))) return ok(JSON.stringify({ notes: [], latest: null }));
        if (!statSync(abs(dir)).isDirectory()) return fail('notes cache missing — list notes first');
        const all: (NoteDoc & { id: string })[] = [];
        for (const f of readdirSync(abs(dir)).filter(x => x.endsWith('.json')).sort()) {
          try {
            const n = normalizeNote(JSON.parse(readFileSync(path.join(abs(dir), f), 'utf8')));
            if (n) all.push({ ...n, id: f.slice(0, -5) });
          } catch { /* corrupt note file: ignore */ }
        }
        const stamps = all.flatMap(n => [Date.parse(n.ts), Date.parse(n.answeredAt ?? '')]).filter(t => !Number.isNaN(t));
        const latest = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
        return ok(JSON.stringify({ notes: notesSince(all, flag('since') ?? null), latest }));
      }
      case 'inbox': {
        const session = flag('session');
        if (!session) return fail('inbox: --session is required', 2);
        return ok(JSON.stringify(inboxFor(readDocs<MessageDoc>(flag('messages') && abs(flag('messages')!)), session)));
      }
      case 'escalations':
        return ok(JSON.stringify(escalationCandidates(readDocs<MessageDoc>(flag('messages') && abs(flag('messages')!)))));
      case 'launch': {
        const p = loadPlan();
        const track = args[1];
        const taskMode = args.includes('--task');
        if (taskMode) {
          if (!track || !isPlanId(track) || !p.tasks.some(t => t.id === track)) return fail(`launch: unknown task ${track ?? ''}`);
        } else if (!p.tracks.some(t => t.id === track)) return fail(`launch: unknown track ${track ?? ''}`);
        const SAFE_ID = /^[A-Za-z0-9_.~:@+][A-Za-z0-9_\-.~:@+]{0,79}$/;
        const val = (f: string) => { const i = args.indexOf(f); const v = i >= 0 ? args[i + 1] : undefined; return v && !v.startsWith('--') ? v : undefined; };
        if (taskMode) {
          const runId = val('--run'), coordinator = val('--coordinator'), taskBase = val('--base');
          if (!runId || !SAFE_ID.test(runId)) return fail('launch --task: --run needs the execution id', 2);
          if (!coordinator || !SAFE_ID.test(coordinator)) return fail('launch --task: --coordinator needs the coordinator session id', 2);
          if (!taskBase || !BRANCH_RE.test(taskBase)) return fail('launch --task: --base needs the run branch', 2);
          if (args.includes('--merge') || args.includes('--swarm')) return fail('launch --task: the coordinator integrates; --merge and --swarm do not apply', 2);
        }
        const launcherAt = args.indexOf('--launcher');
        const launcher = launcherAt >= 0 ? args[launcherAt + 1] : 'bg';
        if (launcher !== 'bg' && launcher !== 'herdr') return fail('launch: --launcher must be bg or herdr', 2);
        const swarmAt = args.indexOf('--swarm');
        const swarm = swarmAt >= 0 ? args[swarmAt + 1] : undefined;
        if (swarmAt >= 0 && (!swarm || !SAFE_ID.test(swarm))) return fail('launch: --swarm needs the coordinator session id', 2);
        if (swarm && args.includes('--merge')) return fail('launch: --swarm and --merge cannot be combined: the swarm coordinator integrates', 2);
        const baseAt = args.indexOf('--base');
        const base = baseAt >= 0 ? args[baseAt + 1] : undefined;
        if (baseAt >= 0 && (!base || !BRANCH_RE.test(base))) return fail('launch: --base needs a branch name', 2);
        if (swarm && !base) return fail('launch: --swarm needs --base <the swarm base branch>', 2);
        const git = (...a: string[]) => execFileSync('git', a, { cwd: io.cwd, encoding: 'utf8' }).trim();
        // Worktrees always live under the main checkout, even when this runs inside another worktree.
        const root = mainWorktreeFrom(git('worktree', 'list', '--porcelain')) ?? git('rev-parse', '--show-toplevel');
        if (taskMode) {
          // Same worktree and branch names as `forge swarm worktree <T>`: every execution mode shares the work of a task.
          const taskWt = path.join(root, '.claude', 'worktrees', `task-${track}`);
          const taskBranch = `task/${track}`;
          if (!existsSync(taskWt)) {
            const exists = git('branch', '--list', taskBranch) !== '';
            git('worktree', 'add', taskWt, ...(exists ? [taskBranch] : ['-b', taskBranch, base!]));
          }
          const taskName = `wp-${p.project}-${track}`;
          const taskPrompt = `/forge:run --plan ${args[0]} --task ${track} — run member of ${val('--coordinator')}: work only ${track}, then stop`;
          const taskCommand = `claude --bg --name ${taskName} "${taskPrompt}"`;
          const taskRun = launchRun(launcher as Launcher, { name: taskName, prompt: taskPrompt, worktree: taskWt });
          if (taskRun === null) return fail('launch: herdr cannot open panes from the command line; use launcher bg', 2);
          return ok(JSON.stringify({ worktree: taskWt, branch: taskBranch, name: taskName, prompt: taskPrompt, command: taskCommand, run: taskRun, runId: val('--run'), task: track }));
        }
        const worktree = path.join(root, '.claude', 'worktrees', track!);
        const branch = `track/${track}`;
        if (!existsSync(worktree)) {
          const exists = git('branch', '--list', branch) !== '';
          git('worktree', 'add', worktree, ...(exists ? [branch] : ['-b', branch, ...(base ? [base] : [])]));
        }
        const name = `wp-${p.project}-${track}`;
        const FORGE_MARK = 'forge drives this session';
        let forge = args.includes('--forge') || !!swarm;
        if (!forge && !args.includes('--no-forge')) {
          const designFile = path.join(path.dirname(abs(args[0])), 'design.md');
          if (existsSync(designFile)) {
            try { forge = parseDesign(readFileSync(designFile, 'utf8')).meta.start_prompt.includes(FORGE_MARK); } catch (e) { if (!(e instanceof DesignError)) throw e; }
          }
        }
        const prompt = `/waypoint:work ${track}`
          + (forge ? ` — ${FORGE_MARK} (forge:run Large loop)` : '')
          + (args.includes('--merge') ? ` — the user authorizes merging ${branch} into main at phase close` : '')
          + (swarm ? ` — swarm member of ${swarm}: do not merge into the base branch; keep taking tasks of your track and stop when it has no next task` : '');
        const command = `claude --bg --name ${name} "${prompt}"`;
        // `run` starts it from any directory without moving the caller's shell: a cd outside a subshell would
        // leave a coordinator working in the worktree. Single quotes, with any quote in the path escaped.
        const inWorktree = launchRun(launcher as Launcher, { name, prompt, worktree });
        if (inWorktree === null) return fail('launch: herdr cannot open panes from the command line; use launcher bg', 2);
        return ok(JSON.stringify({ worktree, branch, name, prompt, command, run: inWorktree }));
      }
      case 'status': {
        const { view: p, project, version } = loadView();
        const states = docs<TaskState>('states');
        const m = computeMetrics(p, states, io.now().getTime());
        const title = (id: string) => `${id} ${p.tasks.find(t => t.id === id)?.title ?? ''}`;
        const lines = [
          `${project} · v${version} · ${m.percent}% (${m.done}/${m.total}) · phases ${m.phasesDone}/${m.phaseCount}`,
          ...m.inProgress.map(id => `in progress: ${title(id)}`),
          ...m.blocked.map(id => `blocked: ${title(id)}`),
        ];
        const next = availableTasks(p, states)[0];
        if (next) lines.push(`next: ${title(next.id)}`);
        if (m.paceMin != null) lines.push(`pace: ${m.paceMin} min/task · eta: ${m.etaIso ?? '-'}`);
        return ok(lines.join('\n'));
      }
      case 'session-id':
        return ok(sessionIdFrom(args.join(' ')));
      case 'event-id':
        return ok(eventId(io.now(), args[0] ?? 'main', io.rand));
      case 'now':
        return ok(io.now().toISOString());
      case 'commit-info': {
        const rev = args[0] ?? 'HEAD';
        const git = (...a: string[]) => execFileSync('git', a, { cwd: io.cwd, encoding: 'utf8' });
        const [sha, ts, ...title] = git('log', '-1', '--format=%H%x09%cI%x09%s', rev).trim().split('\t');
        const stat = git('show', '--shortstat', '--format=', rev);
        const num = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0);
        return ok(JSON.stringify({ sha, ts: new Date(ts).toISOString(), title: title.join('\t'), add: num(/(\d+) insertion/), del: num(/(\d+) deletion/) }));
      }
      case 'design-validate': {
        const d = parseDesign(readFileSync(abs(args[0]), 'utf8'));
        const log = readChangelog(path.dirname(abs(args[0])));
        const sections = d.sections.length;
        return ok(`ok: ${d.words} words, ${sections} sections, v${log[log.length - 1]?.version ?? 0}`);
      }
      case 'design-snapshot': {
        const file = abs(args[0]);
        const note = flag('note');
        if (!note) return fail('design-snapshot: --note is required', 2);
        const text = readFileSync(file, 'utf8');
        const d = parseDesign(text);
        const base = path.join(path.dirname(file), 'design');
        const histDir = path.join(base, 'history');
        const log = readChangelog(path.dirname(file));
        const version = nextVersion(existsSync(histDir) ? readdirSync(histDir) : []);
        const roundFlag = flag('round');
        const round = roundFlag !== undefined ? Number(roundFlag) : (log[log.length - 1]?.round ?? 0);
        if (!Number.isInteger(round) || round < 0) return fail('design-snapshot: --round must be a non-negative integer', 2);
        // Pure check first so a stale changelog fails before anything is written.
        const next = appendChangelog(log, { version, date: io.now().toISOString().slice(0, 10), note, words: d.words, round });
        mkdirSync(histDir, { recursive: true });
        const dest = path.join(histDir, `v${version}.md`);
        try { writeFileSync(dest, text, { flag: 'wx' }); } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EEXIST') return fail(`design-snapshot: ${dest} already exists; history is immutable`);
          throw e;
        }
        writeFileSync(path.join(base, 'changelog.json'), JSON.stringify(next, null, 2) + '\n');
        return ok(JSON.stringify({ version, path: dest }));
      }
      case 'design-changed': {
        const file = abs(args[0]);
        const text = readFileSync(file, 'utf8');
        const d = parseDesign(text);
        const histDir = path.join(path.dirname(file), 'design', 'history');
        const versions = listVersions(existsSync(histDir) ? readdirSync(histDir) : []);
        const sinceFlag = flag('since');
        const since = sinceFlag !== undefined ? Number(sinceFlag) : versions[versions.length - 1];
        const prevFile = since !== undefined ? path.join(histDir, `v${since}.md`) : undefined;
        if (since === undefined || !prevFile || !existsSync(prevFile)) {
          if (sinceFlag !== undefined) return fail(`design-changed: no history for v${sinceFlag}`);
          return ok(JSON.stringify({ since: 0, changed: d.sections.map(s => s.slug), scope: 'full' }));
        }
        const changed = changedSections(readFileSync(prevFile, 'utf8'), text);
        const total = d.sections.length;
        const count = changed.filter(s => s !== '_intro').length;
        return ok(JSON.stringify({ since, changed, scope: total === 0 || count * 2 > total ? 'full' : 'changed' }));
      }
      case 'critique-check': {
        const c = parseCritique(readFileSync(abs(args[0]), 'utf8'));
        const issues: string[] = [];
        for (const name of ['round', 'version'] as const) {
          const given = flag(name);
          if (given === undefined) continue;
          if (!/^[1-9]\d*$/.test(given)) return fail(`critique-check: --${name} must be a positive integer`, 2);
          if (c[name] !== Number(given)) issues.push(`${name} is ${c[name]} but this review is ${name} ${given}`);
        }
        const designFlag = flag('design');
        const headings: Record<string, string> = {};
        if (designFlag !== undefined) {
          const sections = parseDesign(readFileSync(abs(designFlag), 'utf8')).sections;
          for (const s of sections) headings[s.slug] = s.heading;
          const slugs = new Set(['_intro', ...sections.map(s => s.slug)]);
          for (const p of c.proposals) if (!slugs.has(p.section)) issues.push(`proposal ${p.n}: section "${p.section}" is not a section slug of the design`);
        }
        if (issues.length) throw new CritiqueError(issues);
        return ok(formatProposals(c, flag('locale') ?? 'en', headings));
      }
      case 'critique-select': {
        const c = parseCritique(readFileSync(abs(args[0]), 'utf8'));
        if (!args[1]) return fail('critique-select: <spec> is required', 2);
        return ok(JSON.stringify(selectProposals(c, args[1])));
      }
      case 'design-page': {
        const file = abs(args[0]);
        const out = flag('out');
        if (!out) return fail('design-page: --out is required', 2);
        const dirPath = path.dirname(file);
        const histDir = path.join(dirPath, 'design', 'history');
        const history: Record<number, string> = {};
        for (const v of listVersions(existsSync(histDir) ? readdirSync(histDir) : [])) history[v] = readFileSync(path.join(histDir, `v${v}.md`), 'utf8');
        const current = readFileSync(file, 'utf8');
        let source = `docs/waypoint/${parseDesign(current).meta.project}/`;
        try {
          const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          const rel = path.relative(path.resolve(root), dirPath).split(path.sep).join('/');
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) source = rel ? `${rel}/` : '';
        } catch { /* not a git repo: keep the docs/waypoint/<project>/ fallback */ }
        const data = buildDesignPageData({ current, history, changelog: readChangelog(dirPath), source });
        const tpl = readFileSync(path.join(io.assetsDir, 'design.template.html'), 'utf8');
        const title = `${data.meta.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} · Design`;
        const json = JSON.stringify(data).replace(/</g, '\\u003c');
        // One pass: a title or text containing a placeholder is never re-substituted.
        const html = tpl.replace(/__TITLE__|__DATA__/g, m => (m === '__TITLE__' ? title : json));
        const target = abs(out);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, html);
        return ok(target);
      }
      case 'hook': {
        try { const out = runHook(args[0], io); return out ? ok(out) : { code: 0, stdout: '', stderr: '' }; } catch { return { code: 0, stdout: '', stderr: '' }; }
      }
      default:
        return fail(USAGE, 2);
    }
  } catch (e) {
    if (e instanceof DesignError || e instanceof CritiqueError) return fail(e.message);
    if (e instanceof PlanError || e instanceof CacheError) return fail(e.message);
    return fail(`error: ${(e as Error).message}`);
  }
}

class CacheError extends Error {}

const SHA_RE = /^[0-9a-f]{7,64}$/;

/** The commits of done tasks that other tracks depend on and that are already in `base`, as `forge swarm tick` computes them. */
function integratedShas(plan: PlanView, states: Record<string, TaskState>, base: string, cwd: string): Set<string> {
  const trackOf = new Map(plan.tasks.map(t => [t.id, t.track]));
  const deps = new Set(plan.tasks.flatMap(t => t.depends_on.filter(d => trackOf.has(d) && trackOf.get(d) !== t.track)));
  const out = new Set<string>();
  for (const id of deps) {
    if (states[id]?.status !== 'done') continue;
    for (const sha of commitShas(states, id)) {
      if (!SHA_RE.test(sha)) continue;
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', sha, base], { cwd, stdio: 'ignore' });
        out.add(sha);
      } catch { /* not an ancestor, or unknown: not integrated */ }
    }
  }
  return out;
}

// `git [global options] commit`, at the start of the command, after a separator or an opening parenthesis.
const COMMIT_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*commit(?![\w-])/;

export function isCommitCommand(cmd: string): boolean {
  return COMMIT_RE.test(cmd) && !/(^|\s)--dry-run(?![\w-])/.test(cmd);
}

function lines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l.trim()) : [];
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

// Classic hooks: any failure yields empty output so a broken hook never disturbs the session.
function runHook(sub: string | undefined, io: Io): string {
  let input: { cwd?: unknown; stop_hook_active?: boolean; tool_input?: { command?: unknown } } = {};
  try { const v = JSON.parse(io.stdin ?? ''); if (v && typeof v === 'object') input = v; else return ''; } catch { return ''; /* unreadable input: say nothing (never risk a stop loop) */ }
  // Cheap check first: most Bash calls are not commits and must not pay for project discovery.
  const cmd = input.tool_input?.command;
  if (sub === 'post-commit' && (typeof cmd !== 'string' || !isCommitCommand(cmd))) return '';
  const root = nonEmpty(io.env?.CLAUDE_PROJECT_DIR) ?? nonEmpty(input.cwd) ?? io.cwd;
  const base = path.join(root, 'docs', 'waypoint');
  const entries = existsSync(base)
    ? readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d => {
        const files = ['plan.yaml', 'design.md'].map(n => path.join(base, d.name, n)).filter(existsSync);
        if (!files.length) return [];
        return [{ name: d.name, hasSession: existsSync(path.join(root, '.waypoint', d.name, 'session.json')), mtimeMs: Math.max(...files.map(f => statSync(f).mtimeMs)) }];
      })
    : [];
  const project = pickProject(entries);
  if (!project) return '';
  const wp = path.join(root, '.waypoint', project);
  const docDir = path.join(base, project);
  const session = (): { sessionId?: string; track?: string; currentTask?: string } => {
    try { return JSON.parse(readFileSync(path.join(wp, 'session.json'), 'utf8')) ?? {}; } catch { return {}; }
  };
  // The session's task: session.json's currentTask, else the one it owns in the state cache.
  const currentTask = (s: { sessionId?: string; currentTask?: string }): string | null => {
    if (s.currentTask) return s.currentTask;
    if (!s.sessionId) return null;
    try {
      const states = readDocs<TaskState>(path.join(wp, 'dbcache', 'state'));
      return Object.entries(states).find(([, st]) => (st.status === 'in_progress' || st.status === 'claimed') && st.owner === s.sessionId)?.[0] ?? null;
    } catch { return null; }
  };
  const head = (): string => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const headFile = path.join(wp, 'last-head');
  switch (sub) {
    case 'session-start': {
      // The baseline post-commit compares against; no repository (or no commit yet) leaves it as it was.
      try { const h = head(); mkdirSync(wp, { recursive: true }); writeFileSync(headFile, h + '\n'); } catch { /* not a git repo */ }
      const planFile = path.join(docDir, 'plan.yaml');
      let text: string | null = null;
      if (existsSync(planFile)) {
        try {
          const plan = parsePlan(readFileSync(planFile, 'utf8'));
          const s = session();
          const taskId = currentTask(s);
          const cur = taskId ? plan.tasks.find(t => t.id === taskId) : undefined;
          let open = 0;
          try {
            if (s.sessionId) open = Object.values(readDocs<MessageDoc>(path.join(wp, 'dbcache', 'messages'))).filter(m => m.to === s.sessionId && m.status === 'open').length;
          } catch { open = 0; }
          text = `waypoint: project ${project} has a live roadmap (${plan.artifacts.roadmap ?? 'not published'}). Session ${s.sessionId ?? 'none'} track ${s.track ?? '-'}. Current task: ${cur ? `${cur.id} ${cur.title}` : 'none'}. Open messages: ${open}. Use /waypoint:work to continue, /waypoint:status for progress.`;
        } catch { text = null; }
      }
      if (text === null && existsSync(path.join(docDir, 'design.md'))) {
        const d = parseDesign(readFileSync(path.join(docDir, 'design.md'), 'utf8'));
        if (d.meta.status === 'draft') {
          const log = readChangelog(docDir);
          text = `waypoint: design document ${project} v${log[log.length - 1]?.version ?? 0} (draft). Use /waypoint:design to continue the design loop.`;
        }
      }
      return text === null ? '' : JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
    }
    case 'post-commit': {
      const task = currentTask(session());
      if (!task) return '';
      // Only a commit that moved HEAD is recorded; a failed one (nothing to commit, a hook refused it) is not.
      const sha = head();
      const last = existsSync(headFile) ? readFileSync(headFile, 'utf8').trim() : '';
      if (sha === last) return '';
      mkdirSync(wp, { recursive: true });
      writeFileSync(headFile, sha + '\n');
      appendFileSync(path.join(wp, 'pending-commits.jsonl'), JSON.stringify({ ts: io.now().toISOString(), task, sha, command: (cmd as string).slice(0, 200) }) + '\n');
      return '';
    }
    case 'stop': {
      if (input.stop_hook_active === true) return '';
      const commits = lines(path.join(wp, 'pending-commits.jsonl'));
      const queued = lines(path.join(wp, 'queue.jsonl'));
      if (!commits.length && !queued.length) return '';
      // One reminder per distinct pending set: stopping again with nothing new goes through.
      const hash = createHash('sha256').update(JSON.stringify([commits, queued])).digest('hex');
      const ackFile = path.join(wp, 'stop-ack');
      if (existsSync(ackFile) && readFileSync(ackFile, 'utf8').trim() === hash) return '';
      writeFileSync(ackFile, hash + '\n');
      return JSON.stringify({ decision: 'block', reason: `waypoint: ${commits.length} commit(s) / ${queued.length} queued roadmap update(s) are not in the live roadmap yet. Record them (work skill: a \`commit\` event for intermediate commits, or the task's completion), or flush the queue, then remove those lines from .waypoint/${project}/pending-commits.jsonl. You can also stop now; this reminder shows once per change.${replyIn(planLocale(root, project))}` });
    }
    default:
      return '';
  }
}

function readDocs<T = unknown>(dir: string | undefined): Record<string, T> {
  if (!dir || !existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => [f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T]),
  );
}

function readChangelog(designDir: string) {
  const f = path.join(designDir, 'design', 'changelog.json');
  return parseChangelog(existsSync(f) ? readFileSync(f, 'utf8') : null);
}
