// waypoint's classic hooks: SessionStart, SessionEnd, PostToolUse (Bash) and Stop. Each first works out what the
// session that runs it is to the checkout's roadmap (describeViewer, C3) and acts only as that role allows: nothing of
// a seat reaches another conversation (A-02, B-01, B-05). Any failure yields empty output, so a broken hook never
// disturbs the session. waypoint never imports forge: what forge does is read from its files.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parsePlan } from '../lib/plan.js';
import { parseDesign } from '../lib/design.js';
import { parseChangelog } from '../lib/history.js';
import { planLocale, replyIn } from '../lib/locale.js';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { isSafeId, normalizeLive, parseExecution, type ExecutionState } from '../lib/execution-state.js';
import { parseRun, type RunState } from '../lib/forge-run.js';
import { forgeRoleOf, MAX_MEMBER_FILES } from '../lib/forge-activity.js';
import { normalizeMember, type MemberDoc } from '../lib/member-doc.js';
import { endReasonOf, parseBound, type BoundDoc } from '../lib/bound.js';
import { describeViewer, type Viewer } from '../lib/viewer-role.js';
import { boundFile, headOf, openTasksOf, pidFromEnv, readLastHead, readSeats, recordBase, settleBinding, writeBinding, writeLastHead, type Seat } from '../lib/bound-fs.js';
import { pickProject, type ProjectEntry } from '../mod/model.js';
import type { MessageDoc, Plan } from '../lib/types.js';
import type { Io } from './run.js';

const SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'] as const;
type Source = (typeof SOURCES)[number];
/** At most this many project folders of .waypoint/ are scanned for a binding. */
const MAX_PROJECTS = 50;
/** The owner's own hooks renew its binding at most once a minute (until the band renews it, wave 2b). */
const RENEW_MS = 60_000;
/** post-commit records at most this many commits per call, and checks at most this many lines after a rewrite. */
const MAX_COMMITS = 20;
const SHA = /^[0-9a-f]{7,64}$/;

interface HookInput {
  session_id?: unknown; source?: unknown; reason?: unknown; seconds_since_last_response?: unknown;
  cwd?: unknown; stop_hook_active?: unknown; tool_input?: { command?: unknown };
}

// `git [global options] commit`, at the start of the command, after a separator or an opening parenthesis.
const COMMIT_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*commit(?![\w-])/;

export function isCommitCommand(cmd: string): boolean {
  return COMMIT_RE.test(cmd) && !/(^|\s)--dry-run(?![\w-])/.test(cmd);
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const read = (f: string): string | null => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const lines = (file: string): string[] => (read(file) ?? '').split('\n').filter(l => l.trim());
const field = (l: string, k: 'sha' | 'task'): string | null => {
  try { const o = JSON.parse(l) as Record<string, unknown> | null; const v = o?.[k]; return typeof v === 'string' ? v : null; } catch { return null; }
};
/** The session's project directory: CLAUDE_PROJECT_DIR, else the input's cwd, else the process's. */
const rootOf = (io: Io, input: HookInput): string => nonEmpty(io.env?.CLAUDE_PROJECT_DIR) ?? nonEmpty(input.cwd) ?? io.cwd;
const projectDirs = (root: string): string[] => {
  try { return readdirSync(path.join(root, '.waypoint'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).slice(0, MAX_PROJECTS); } catch { return []; }
};

interface ForgeFiles {
  /** The execution this roadmap is about: the project's plan run, or forge's ephemeral one; null otherwise. */
  exec: ExecutionState | null;
  /** Whatever execution.json holds (A-07 looks at any active one). */
  any: ExecutionState | null;
  members: MemberDoc[];
  infinite: RunState | null;
  /** The coordinator's live signal says its conversation ended. */
  coordinatorEnded: boolean;
}

/** What forge does in the main checkout, read as files: execution.json, the members, run.json and the coordinator's signal. */
function readForge(root: string, project: string, now: number): ForgeFiles {
  const main = mainCheckoutFrom(root, read(path.join(root, '.git')));
  const dir = path.join(main, '.forge');
  const any = parseExecution(read(path.join(dir, 'execution.json')), now);
  const exec = any && (any.kind === 'ephemeral' || any.project === project) ? any : null;
  let names: string[] = [];
  try { names = readdirSync(path.join(dir, 'members')).filter(f => f.endsWith('.json')).slice(0, MAX_MEMBER_FILES); } catch { names = []; }
  const members = names.flatMap(n => {
    try { const m = normalizeMember(JSON.parse(read(path.join(dir, 'members', n)) ?? 'null')); return m ? [m] : []; } catch { return []; }
  });
  let coordinatorEnded = false;
  if (exec && isSafeId(exec.hookSession)) {
    try { coordinatorEnded = normalizeLive(JSON.parse(read(path.join(dir, 'live', `${exec.hookSession}.json`)) ?? 'null'))?.ended === true; } catch { coordinatorEnded = false; }
  }
  return { exec, any, members, infinite: parseRun(read(path.join(dir, 'run.json'))), coordinatorEnded };
}

interface Ctx { root: string; project: string; wp: string; docDir: string; now: number; sid: string | null; seats: Seat[]; viewer: Viewer; forge: ForgeFiles }

/** §4.3, the common preamble: the projects with their bindings, the one of this session, forge's files, the seats'
 *  tasks in progress, and the role. Null without a project. */
function contextOf(io: Io, input: HookInput): Ctx | null {
  const root = rootOf(io, input);
  const now = io.now().getTime();
  const sid = isSafeId(input.session_id) ? input.session_id : null;
  const base = path.join(root, 'docs', 'waypoint');
  if (!existsSync(base)) return null;
  const seatsOf = new Map<string, Seat[]>();
  const entries: ProjectEntry[] = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d => {
    const files = ['plan.yaml', 'design.md'].map(n => path.join(base, d.name, n)).filter(f => existsSync(f));
    if (!files.length) return [];
    // A binding live by its lease whose process is gone reads as ended (settleBinding); nothing is written back.
    const seats = readSeats(path.join(root, '.waypoint', d.name), now).map(s => (s.bound ? { ...s, bound: settleBinding(s.bound, now) } : s));
    seatsOf.set(d.name, seats);
    return [{ name: d.name, bindings: seats.flatMap(s => (s.bound ? [s.bound] : [])), mtimeMs: Math.max(...files.map(f => statSync(f).mtimeMs)) }];
  });
  const project = pickProject(entries, sid);
  if (!project) return null;
  const wp = path.join(root, '.waypoint', project);
  const seats = seatsOf.get(project) ?? [];
  const forge = readForge(root, project, now);
  const run = forge.exec;
  const viewer = describeViewer({
    bound: seats.flatMap(s => (s.bound ? [s.bound] : [])),
    execution: run,
    members: run ? forge.members.filter(m => m.runId === run.runId) : [],
    sessionId: sid, now, coordinatorEnded: forge.coordinatorEnded, openTasks: openTasksOf(wp),
  });
  return { root, project, wp, docDir: path.join(base, project), now, sid, seats, viewer, forge };
}

/** The seat and binding through which the session owns the roadmap (rule 3); an owner by forge has none. */
function ownSeat(ctx: Ctx): { seat: Seat; bound: BoundDoc } | null {
  const v = ctx.viewer;
  const b = v.role === 'owner' && v.subject === 'binding' ? v.binding : null;
  const seat = b ? ctx.seats.find(s => s.sid === b.sid) : undefined;
  return b && seat ? { seat, bound: b } : null;
}

/**
 * Until the band renews it (wave 2b), the owner's own hooks keep its binding alive: seenAt moves at most once a minute,
 * re-read first so a takeover written meanwhile is never undone. `reopen` (a resumed or compacted conversation, §4.1)
 * also clears its end and records this process's pid, unless the end was a release: that one is deliberate, and no
 * SessionEnd comes before a compact, so only a new bind undoes it. A renewal that cannot be written is left for the
 * next hook: it never stops what the hook records.
 */
function touch(seat: Seat, claude: string, now: Date, reopen: boolean, env: Io['env']): void {
  try {
    const cur = parseBound(read(boundFile(seat.dir)), now.getTime());
    if (!cur || cur.sid !== seat.sid || cur.claude !== claude) return;
    const again = reopen && cur.endReason !== 'released';
    if (!again && (cur.endedAt !== null || now.getTime() - Date.parse(cur.seenAt) < RENEW_MS)) return;
    writeBinding(boundFile(seat.dir), { ...cur, seenAt: now.toISOString(), ...(again ? { endedAt: null, endReason: null, pid: pidFromEnv(env) } : {}) });
  } catch { /* the binding keeps its last renewal */ }
}

function readPlan(docDir: string): Plan | null {
  try { return parsePlan(readFileSync(path.join(docDir, 'plan.yaml'), 'utf8')); } catch { return null; }
}
/** The design's version while it is a draft; null without a design, or once approved or parked (K3-13). */
function draftVersion(docDir: string): number | null {
  try {
    if (parseDesign(readFileSync(path.join(docDir, 'design.md'), 'utf8')).meta.status !== 'draft') return null;
    const log = parseChangelog(read(path.join(docDir, 'design', 'changelog.json')));
    return log[log.length - 1]?.version ?? 0;
  } catch { return null; }
}
const agoText = (ms: number): string => (ms < 60_000 ? 'just now' : ms < 3600_000 ? `${Math.floor(ms / 60_000)} min ago` : `${Math.floor(ms / 3600_000)} h ago`);
const ENDED: Record<NonNullable<BoundDoc['endReason']>, string> = {
  clear: 'ended by /clear', resume: 'ended when another conversation was resumed', prompt_input_exit: 'ended on exit',
  logout: 'ended on logout', other: 'ended', released: 'released',
};
/** When and how an earlier conversation let go of its seat; one that lapsed without SessionEnd was last seen. */
function whenText(b: BoundDoc, now: number): string {
  const ago = agoText(Math.max(0, now - Date.parse(b.endedAt ?? b.seenAt)));
  return b.endedAt !== null && b.endReason !== null ? `${ENDED[b.endReason]} ${ago}` : `last seen ${ago}`;
}

/** The owner's context (B-01): the one of before, with its seat's task; a design's owner hears of its draft only. */
function ownerText(ctx: Ctx, own: { seat: Seat; bound: BoundDoc }, plan: Plan | null, source: Source, input: HookInput): string | null {
  if (own.bound.via === 'design') {
    const v = draftVersion(ctx.docDir);
    return v === null ? null : `waypoint: design document ${ctx.project} v${v} (draft). Use /waypoint:design to continue the design loop.`;
  }
  if (!plan) return null;
  const sid = own.bound.sid;
  let track = '-';
  try {
    const s = JSON.parse(read(path.join(own.seat.dir, 'session.json')) ?? '{}') as { track?: unknown } | null;
    if (typeof s?.track === 'string' && s.track) track = s.track;
  } catch { track = '-'; }
  const cur = ctx.viewer.task ? plan.tasks.find(t => t.id === ctx.viewer.task) : undefined;
  let open = 0;
  try {
    const dir = path.join(ctx.wp, 'dbcache', 'messages');
    open = (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [])
      .map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as MessageDoc)
      .filter(m => m.to === sid && m.status === 'open').length;
  } catch { open = 0; }
  const secs = typeof input.seconds_since_last_response === 'number' ? input.seconds_since_last_response : 0;
  const resumed = source === 'resume' && secs >= 3600 ? `Resumed after ${Math.floor(secs / 3600)} h. ` : '';
  return `${resumed}waypoint: project ${ctx.project} has a live roadmap (${plan.artifacts.roadmap ?? 'not published'}). Session ${sid} track ${track}. Current task: ${cur ? `${cur.id} ${cur.title}` : 'none'}. Open messages: ${open}. Use /waypoint:work to continue, /waypoint:status for progress.`;
}

/** §4.3: what a session hears at start, by its role and the source; for anyone but the owner, a fact without an order. */
function sessionStart(io: Io, input: HookInput): string {
  const ctx = contextOf(io, input);
  if (!ctx) return '';
  const source: Source = (SOURCES as readonly unknown[]).includes(input.source) ? (input.source as Source) : 'startup';
  const say = (text: string | null): string => (text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }) : '');
  const v = ctx.viewer;
  // B-10, K5-10: an owner by forge (the coordinator, a member of the run) hears from forge's live hook; so does anyone
  // who looks at that run.
  if (v.subject === 'execution') return '';
  const plan = readPlan(ctx.docDir);
  const url = plan?.artifacts.roadmap ?? 'not published';
  const title = (t: string) => plan?.tasks.find(x => x.id === t)?.title ?? '';
  const own = ownSeat(ctx);
  if (own && ctx.sid) {
    // A resumed or compacted conversation reopens its binding (§4.1), and HEAD is its base for post-commit.
    touch(own.seat, ctx.sid, io.now(), source === 'resume' || source === 'compact', io.env);
    recordBase(own.seat.dir, ctx.sid, nonEmpty(input.cwd) ?? ctx.root);
    return say(ownerText(ctx, own, plan, source, input));
  }
  const b = v.binding;
  if (v.role === 'other-live' && b) {
    if (!plan) return '';
    const seen = Math.max(0, Math.round((ctx.now - Date.parse(b.seenAt)) / 60_000));
    const works = v.task ? ` and works on ${v.task} "${title(v.task)}"` : '';
    const fork = source === 'fork' ? ' This conversation is a fork; the binding stays with the original session.' : '';
    return say(`waypoint: project ${ctx.project} has a live roadmap (${url}). Another session (seat ${b.sid}, seen ${seen} min ago) is bound to it${works}. This session is not bound to the roadmap.${fork}`);
  }
  if (v.role === 'previous' && b) {
    const when = whenText(b, ctx.now);
    if (b.via === 'design') {
      const ver = draftVersion(ctx.docDir);
      if (ver !== null) return say(`waypoint: design document ${ctx.project} v${ver} (draft) was being worked by an earlier conversation (${when}). This session is not bound to it; /waypoint:design takes it up if the user asks.`);
    } else if (v.task && plan) {
      return say(`waypoint: ${v.task} "${title(v.task)}" of project ${ctx.project} was left in progress by an earlier conversation (seat ${b.sid}, ${when}). This session is not bound to the roadmap. If the user asks to take it up, /waypoint:work resume binds this session to it; otherwise it stays as it is.`);
    }
  }
  // none, or previous with nothing to take up: a plan is announced on a fresh start only; a design never is (K3-13).
  return say(source === 'startup' && plan ? `waypoint: project ${ctx.project} has a roadmap (${url}); no session is bound to it.` : null);
}

/** A-03: SessionEnd closes every binding of the ending conversation, with its reason. Small file writes only, no git:
 *  the engine gives a hook little time when the session ends. */
function sessionEnd(root: string, sid: string, reason: unknown, now: Date): string {
  const at = now.toISOString();
  for (const n of projectDirs(root)) {
    for (const s of readSeats(path.join(root, '.waypoint', n), now.getTime())) {
      if (s.bound && s.bound.claude === sid && s.bound.endedAt === null) writeBinding(boundFile(s.dir), { ...s.bound, endedAt: at, endReason: endReasonOf(reason) });
    }
  }
  return '';
}

/** Whether `sid` holds a binding anywhere in this checkout (ended or not): post-commit and stop leave at once otherwise. */
function boundAnywhere(root: string, sid: string): boolean {
  return projectDirs(root).some(n => readSeats(path.join(root, '.waypoint', n)).some(s => s.bound?.claude === sid));
}

/**
 * A-17, B-05: for the owner by binding only (another session leaves before git; an owner by forge records through
 * integrate). The commits HEAD gained in the worktree of the command since this conversation's base there (first
 * parent, at most MAX_COMMITS) go to <seat>/pending-commits.jsonl; with no base yet only a commit command's HEAD does.
 * After an amend, a rebase or a reset, the lines HEAD no longer reaches go. With no task open the base follows HEAD,
 * so nothing committed between tasks is given to the next one.
 */
function postCommit(io: Io, input: HookInput): string {
  const ctx = contextOf(io, input);
  const own = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own || !ctx.sid) return '';
  const sid = ctx.sid;
  touch(own.seat, sid, io.now(), false, io.env);
  const at = headOf(nonEmpty(input.cwd) ?? ctx.root);
  if (!at) return '';
  const lh = readLastHead(own.seat.dir);
  const heads = lh && lh.session === sid ? lh.heads : {};
  const last = heads[at.top];
  const save = () => { if (last !== at.head) writeLastHead(own.seat.dir, { session: sid, heads: { ...heads, [at.top]: at.head } }); };
  const task = ctx.viewer.task;
  if (!task) { save(); return ''; }
  const file = path.join(own.seat.dir, 'pending-commits.jsonl');
  const cmd = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
  const git = (args: string[]): string | null => {
    try { return execFileSync('git', ['-C', at.top, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  };
  let shas: string[] = [];
  if (!last) shas = isCommitCommand(cmd) ? [at.head] : [];
  else if (last !== at.head) {
    shas = (git(['rev-list', '--first-parent', '--reverse', `--max-count=${MAX_COMMITS}`, `${last}..${at.head}`]) ?? '')
      .split(/\r?\n/).map(s => s.trim()).filter(s => SHA.test(s));
    // An amend, a rebase or a reset: the old base is no longer under HEAD, nor are the commits it replaced.
    if (git(['merge-base', '--is-ancestor', last, at.head]) === null) {
      const all = lines(file);
      let checked = 0;
      const kept = all.filter(l => {
        const s = field(l, 'sha');
        if (!s || checked >= MAX_COMMITS) return true;
        checked++;
        return git(['merge-base', '--is-ancestor', s, at.head]) !== null;
      });
      if (kept.length !== all.length) writeFileSync(file, kept.map(l => `${l}\n`).join(''));
    }
  }
  const have = new Set(lines(file).map(l => field(l, 'sha')));
  const ts = io.now().toISOString();
  const add = shas.filter(s => !have.has(s)).map(sha => `${JSON.stringify({ ts, task, sha, command: cmd.slice(0, 200), session: sid, seat: own.bound.sid })}\n`);
  if (add.length) appendFileSync(file, add.join(''));
  save();
  return '';
}

/**
 * B-05: the reminder of what the seat has not recorded yet, for its owner only. A-07 (wave 1): forge steps its own
 * sessions (a coordinator, a member, the infinite run), so waypoint adds no turn there; the commits of the task in
 * progress are recorded with its completion, so they do not count.
 */
function stop(io: Io, input: HookInput): string {
  const ctx = contextOf(io, input);
  const own = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own || !ctx.sid) return '';
  touch(own.seat, ctx.sid, io.now(), false, io.env);
  if (forgeRoleOf({ execution: ctx.forge.any, members: ctx.forge.members, infinite: ctx.forge.infinite }, ctx.sid) !== null) return '';
  const ongoing = ctx.viewer.task;
  const commits = lines(path.join(own.seat.dir, 'pending-commits.jsonl')).filter(l => ongoing === null || field(l, 'task') !== ongoing);
  const queued = lines(path.join(own.seat.dir, 'queue.jsonl'));
  if (!commits.length && !queued.length) return '';
  // One reminder per distinct pending set: stopping again with nothing new goes through.
  const hash = createHash('sha256').update(JSON.stringify([commits, queued])).digest('hex');
  const ackFile = path.join(own.seat.dir, 'stop-ack');
  if ((read(ackFile) ?? '').trim() === hash) return '';
  writeFileSync(ackFile, `${hash}\n`);
  const rel = path.relative(ctx.root, own.seat.dir).split(path.sep).join('/');
  return JSON.stringify({ decision: 'block', reason: `waypoint: ${commits.length} commit(s) / ${queued.length} queued roadmap update(s) are not in the live roadmap yet. Record them (work skill: a \`commit\` event for intermediate commits, or the task's completion), or flush the queue, then remove those lines from ${rel}/pending-commits.jsonl. You can also stop now; this reminder shows once per change.${replyIn(planLocale(ctx.root, ctx.project))}` });
}

/** The classic hooks' entry: `waypoint hook session-start|session-end|post-commit|stop`, the input on stdin. */
export function runHook(sub: string | undefined, io: Io): string {
  let input: HookInput;
  try {
    const v: unknown = JSON.parse(io.stdin ?? '');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
    input = v as HookInput;
  } catch { return ''; /* unreadable input: say nothing (never risk a stop loop) */ }
  const sid = isSafeId(input.session_id) ? input.session_id : null;
  switch (sub) {
    case 'session-start': return sessionStart(io, input);
    case 'session-end': return sid ? sessionEnd(rootOf(io, input), sid, input.reason, io.now()) : '';
    // A session bound nowhere in this checkout is nobody's owner: it leaves before reading forge or the state cache.
    case 'post-commit': return sid && boundAnywhere(rootOf(io, input), sid) ? postCommit(io, input) : '';
    case 'stop': return input.stop_hook_active === true || !sid || !boundAnywhere(rootOf(io, input), sid) ? '' : stop(io, input);
    default: return '';
  }
}
