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
import { FORGE_DOC_MAX_BYTES, isSafeId, normalizeLive, parseExecution, type ExecutionState, type LiveDoc } from '../lib/execution-state.js';
import { coordinatorGone } from '../lib/execution-view.js';
import { parseRun, type RunState } from '../lib/forge-run.js';
import { forgeRoleOf } from '../lib/forge-activity.js';
import { newestMemberFiles, normalizeMember, type MemberDoc } from '../lib/member-doc.js';
import { endReasonOf, MAX_PROJECTS, parseBound, type BoundDoc } from '../lib/bound.js';
import { bindingLive, describeViewer, type Viewer } from '../lib/viewer-role.js';
import { boundFile, claudeBindings, COMMIT_ACTIONS, commitsSince, headOf, logStatOf, openTasksOf, pidFromEnv, readBinding, readLastHead, readReflog, readSeats, rebaseInProgress, recordBase, replaysSince, settleBinding, taskSinceOf, writeBinding, writeLastHead, type Seat } from '../lib/bound-fs.js';
import { pickProject, type ProjectEntry } from '../lib/project-pick.js';
import { readDocs } from '../lib/read-docs.js';
import { normalizeMessage } from '../page/normalize.js';
import type { Plan } from '../lib/types.js';
import type { Io } from './run.js';

const SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'] as const;
type Source = (typeof SOURCES)[number];
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

// The other git commands that make commits on HEAD: merge, cherry-pick, revert, am and rebase --continue.
const MAKES_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*(merge|cherry-pick|revert|am)(?![\w-])/;
const CONTINUE_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*rebase\s+(-\S+\s+)*--continue(?![\w-])/;

/** C2: a command whose commits a seat records when another live seat works the same worktree (one HEAD for both). */
export function makesCommits(cmd: string): boolean {
  return isCommitCommand(cmd) || MAKES_RE.test(cmd) || CONTINUE_RE.test(cmd);
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const read = (f: string): string | null => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
/** A file's text when it is at most `max` bytes, as the band reads it; null when it is missing or bigger. */
const readCapped = (f: string, max: number): string | null => { try { return statSync(f).size > max ? null : readFileSync(f, 'utf8'); } catch { return null; } };
const lines = (file: string): string[] => (read(file) ?? '').split('\n').filter(l => l.trim());
const field = (l: string, k: 'sha' | 'task'): string | null => {
  try { const o = JSON.parse(l) as Record<string, unknown> | null; const v = o?.[k]; return typeof v === 'string' ? v : null; } catch { return null; }
};
/** The session's project directory: CLAUDE_PROJECT_DIR, else the input's cwd, else the process's. */
const rootOf = (io: Io, input: HookInput): string => nonEmpty(io.env?.CLAUDE_PROJECT_DIR) ?? nonEmpty(input.cwd) ?? io.cwd;
const projectDirs = (root: string): string[] => {
  try { return readdirSync(path.join(root, '.waypoint'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).slice(0, MAX_PROJECTS); } catch { return []; }
};

export interface ForgeFiles {
  /** The execution this roadmap is about: the project's plan run, or forge's ephemeral one; null otherwise. */
  exec: ExecutionState | null;
  /** Whatever execution.json holds (A-07 looks at any active one). */
  any: ExecutionState | null;
  members: MemberDoc[];
  infinite: RunState | null;
  /** The run has no coordinator: its conversation ended, or it went silent (coordinatorGone). */
  coordinatorEnded: boolean;
}

/** What forge does in the main checkout, read as files: execution.json, the members, run.json, and the coordinator's
 *  signal and bindings. Exported for its tests. */
export function readForge(root: string, project: string, now: number): ForgeFiles {
  const main = mainCheckoutFrom(root, read(path.join(root, '.git')));
  const dir = path.join(main, '.forge');
  const any = parseExecution(read(path.join(dir, 'execution.json')), now);
  const exec = any && (any.kind === 'ephemeral' || any.project === project) ? any : null;
  // The member files the band reads too (newestMemberFiles), so both give a session the same role.
  const mdir = path.join(dir, 'members');
  let files: { name: string; size: number; mtimeMs: number }[] = [];
  try {
    files = readdirSync(mdir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.json')).flatMap(d => {
      try { const st = statSync(path.join(mdir, d.name)); return [{ name: d.name, size: st.size, mtimeMs: st.mtimeMs }]; } catch { return []; }
    });
  } catch { files = []; }
  const members = newestMemberFiles(files).flatMap(f => {
    try { const m = normalizeMember(JSON.parse(read(path.join(mdir, f.name)) ?? 'null')); return m ? [m] : []; } catch { return []; }
  });
  // B-09, M4: the coordinator's own signal, as the band reads it, says whether the run lost its coordinator.
  let signal: LiveDoc | null = null;
  if (exec && isSafeId(exec.hookSession)) {
    try { signal = normalizeLive(JSON.parse(readCapped(path.join(dir, 'live', `${exec.hookSession}.json`), FORGE_DOC_MAX_BYTES) ?? 'null')); } catch { signal = null; }
  }
  // An open coordinator conversation (a live binding of its own, in any project, settled by its pid) keeps its run.
  const bindings = exec?.active && isSafeId(exec.hookSession) ? claudeBindings(main, exec.hookSession, now) : [];
  return { exec, any, members, infinite: parseRun(read(path.join(dir, 'run.json'))), coordinatorEnded: coordinatorGone(exec, signal, now, { bindings }) };
}

interface Ctx { root: string; project: string; wp: string; docDir: string; now: number; sid: string | null; seats: Seat[]; viewer: Viewer; forge: ForgeFiles }
/** The role of a hook input without a valid session id (rule 8). */
const NOBODY: Viewer = { role: 'none', subject: null, binding: null, member: null, coordinator: false, since: null, task: null };

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
  // §4.3 point 1 (M1): without a valid session id the role is none; only session-start acts on it.
  const viewer = sid === null ? NOBODY : describeViewer({
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
 * Until the band renews it (wave 2b), the conversation's own hooks keep its binding alive: seenAt moves at most once a minute,
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

/**
 * C1: every hook of a conversation renews its own live binding in the project, whatever its role's subject (a
 * coordinator or a member is an owner by execution, and still holds its seat through its binding). On a resume or a
 * compact the newest of its bindings is reopened instead (§4.1), unless it was released. M5: only that one binding is
 * renewed, the newest by its last renewal (the checkout seat first on a tie, as the band picks it); any other lapses,
 * so a seat a bind of this conversation released, and that a renewal raced back to life, does not stay held.
 */
function renewOwn(ctx: Ctx, io: Io, reopen: boolean): void {
  const sid = ctx.sid;
  if (!sid) return;
  type Own = Seat & { bound: BoundDoc };
  const newestOf = (list: Own[]): Own | null =>
    list.reduce<Own | null>((best, s) => (!best || Date.parse(s.bound.seenAt) > Date.parse(best.bound.seenAt) ? s : best), null);
  const mine = ctx.seats.filter((s): s is Own => s.bound?.claude === sid);
  const newest = newestOf(mine);
  const again = reopen && newest !== null && newest.bound.endReason !== 'released';
  const target = again ? newest : newestOf(mine.filter(s => s.bound.endedAt === null));
  if (target) touch(target, sid, io.now(), again, io.env);
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

/** The owner's context (B-01): the one of before, with its seat's task; a design's owner hears of its draft only, and
 *  one bound for a forge run with nothing open hears one fact (M8). */
function ownerText(ctx: Ctx, own: { seat: Seat; bound: BoundDoc }, plan: Plan | null, source: Source, input: HookInput): string | null {
  if (own.bound.via === 'design') {
    const v = draftVersion(ctx.docDir);
    return v === null ? null : `waypoint: design document ${ctx.project} v${v} (draft). Use /waypoint:design to continue the design loop.`;
  }
  if (!plan) return null;
  const sid = own.bound.sid;
  // M8: bound for forge's infinite run, or for a forge run with no task open: one fact, not the work skill.
  if (own.bound.via === 'forge-infinite' || (own.bound.via === 'forge-run' && !ctx.viewer.task)) {
    return `waypoint: this conversation holds seat ${sid} of project ${ctx.project} (${plan.artifacts.roadmap ?? 'not published'}) for its forge ${own.bound.via === 'forge-infinite' ? 'infinite run' : 'run'}.`;
  }
  let track = '-';
  try {
    const s = JSON.parse(read(path.join(own.seat.dir, 'session.json')) ?? '{}') as { track?: unknown } | null;
    if (typeof s?.track === 'string' && s.track) track = s.track;
  } catch { track = '-'; }
  const cur = ctx.viewer.task ? plan.tasks.find(t => t.id === ctx.viewer.task) : undefined;
  // I-14: a broken message file no longer hides the others; the hook says nothing about it.
  const open = Object.values(readDocs(path.join(ctx.wp, 'dbcache', 'messages'), normalizeMessage).docs)
    .filter(m => m.to === sid && m.status === 'open').length;
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
  // A resumed or compacted conversation reopens its binding (§4.1), whatever its role.
  renewOwn(ctx, io, source === 'resume' || source === 'compact');
  // B-10, K5-10: an owner by forge (the coordinator, a member of the run) hears from forge's live hook; so does anyone
  // who looks at that run.
  if (v.subject === 'execution') return '';
  const plan = readPlan(ctx.docDir);
  const url = plan?.artifacts.roadmap ?? 'not published';
  const title = (t: string) => plan?.tasks.find(x => x.id === t)?.title ?? '';
  const own = ownSeat(ctx);
  if (own && ctx.sid) {
    // HEAD is the owner's base for post-commit.
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
      if (!s.bound || s.bound.claude !== sid || s.bound.endedAt !== null) continue;
      // M7: read again just before the write, so a takeover that landed since the listing is never undone.
      const cur = readBinding(s.dir, s.sid, now.getTime());
      if (cur && cur.claude === sid && cur.endedAt === null) writeBinding(boundFile(s.dir), { ...cur, endedAt: at, endReason: endReasonOf(reason) });
    }
  }
  return '';
}

/** Whether `sid` holds a binding anywhere in this checkout (ended or not): post-commit and stop leave at once otherwise. */
function boundAnywhere(root: string, sid: string): boolean {
  return projectDirs(root).some(n => readSeats(path.join(root, '.waypoint', n)).some(s => s.bound?.claude === sid));
}

/**
 * C2: what the other seats of the project saw of the worktree `top`, from their last-head.json (for the conversation
 * bound to them, live or ended): the newest commit of each of their recordings, and their base unless that base is HEAD
 * and they did not record it (their hook may have run between this command's commit and this hook). `live`: another
 * live seat works this worktree, so HEAD moves for both and only a command that makes commits records.
 */
function othersOn(ctx: Ctx, own: Seat, top: string, head: string): { live: boolean; seen: Set<string> } {
  let live = false;
  const seen = new Set<string>();
  for (const s of ctx.seats) {
    const b = s.bound;
    if (s === own || !b || b.claude === ctx.sid) continue;
    const lh = readLastHead(s.dir);
    if (!lh || lh.session !== b.claude) continue;
    const base = lh.heads[top];
    const recorded = lh.recorded?.[top] ?? [];
    if (base && bindingLive(b, ctx.now)) live = true;
    for (const r of recorded) seen.add(r);
    if (base && (base !== head || recorded.includes(head))) seen.add(base);
  }
  return { live, seen };
}

/**
 * C2: of the commits HEAD gained (oldest first), this seat's: the ones after the last commit another seat saw; when
 * none comes after it (this command's commit came first and the other recorded it too, or the command made nothing),
 * the range without the commits the others saw. A commit two seats record is better than one neither does.
 */
function ownShare(range: string[], seen: ReadonlySet<string>): string[] {
  const k = range.reduce((at, s, i) => (seen.has(s) ? i : at), -1);
  if (k < 0) return range;
  return k < range.length - 1 ? range.slice(k + 1) : range.filter(s => !seen.has(s));
}

/**
 * A-17, B-05: for the owner by binding only (another session leaves before git; an owner by forge records through
 * integrate). The commits HEAD gained in the worktree of the command since this conversation's base there (first
 * parent, at most MAX_COMMITS) go to <seat>/pending-commits.jsonl; with no base yet only a commit command's HEAD does.
 * H4: only what this worktree made. The reflog of HEAD gives the entries after the position this hook already read (kept
 * in last-head.json) whose action is commit, commit (amend), commit (initial), commit (merge), revert or cherry-pick, and
 * that HEAD still reaches, and not before the claim of the task; what a pull, a merge, a rebase, a reset or a checkout
 * brings is not attributed, but the task's own commits a rebase replays keep their lines (under the new sha). The first time,
 * with no base, the task counts from its claim. Accepted limit: another person's commit in the same worktree is the task's.
 * When another live seat works the same worktree (C2), only a command that makes commits records; and what another
 * seat, live or ended, already saw or recorded there is not taken (ownShare). After an amend, a rebase or a reset, the
 * lines HEAD no longer reaches go. With no task open the base follows HEAD, so nothing committed between tasks is given
 * to the next one.
 */
function postCommit(io: Io, input: HookInput): string {
  const ctx = contextOf(io, input);
  if (ctx) renewOwn(ctx, io, false);
  const own = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own || !ctx.sid) return '';
  const sid = ctx.sid;
  const at = headOf(nonEmpty(input.cwd) ?? ctx.root);
  if (!at) return '';
  const lh = readLastHead(own.seat.dir);
  const mine = lh && lh.session === sid ? lh : null;
  const heads = mine?.heads ?? {};
  const recorded = mine?.recorded ?? {};
  const last = heads[at.top];
  // M3: the reflog is read only when it could hold something new: HEAD moved, there is no position yet, or the reflog file
  // changed (size or mtime) since this hook read it. A `git status` costs the one rev-parse and a stat. An older last-head.json has no stat: it counts as changed.
  const stat = logStatOf(at.gitDir);
  const storedStat = mine?.logs?.[at.top];
  const statKept = !!stat && storedStat?.size === stat.size && storedStat.mtimeMs === stat.mtimeMs;
  const reflog = last === at.head && mine?.reflog?.[at.top] && statKept ? [] : readReflog(at.top);
  const top = reflog[0] ?? null;
  // The position this hook left off at (H4). A last-head.json from before the position existed (H2) has a base and no position:
  // the newest entry at that base is where the hook left off; the claim cuts only a worktree with no base at all.
  const pos = mine?.reflog?.[at.top] ?? (last ? reflog.find(e => e.sha === last) ?? top : null);
  // The newest commit this hook records: the seat's marker of what is its own (C2).
  let newest: string | null = null;
  const save = () => {
    const stored = mine?.reflog?.[at.top];
    if (last === at.head && !newest && (statKept || !stat) && (!top || (stored?.at === top.at && stored.sha === top.sha))) return;
    writeLastHead(own.seat.dir, {
      session: sid, heads: { ...heads, [at.top]: at.head }, reflog: { ...mine?.reflog, ...(top ? { [at.top]: { at: top.at, sha: top.sha } } : {}) },
      recorded: newest ? { ...recorded, [at.top]: [...(recorded[at.top] ?? []), newest] } : recorded,
      logs: { ...mine?.logs, ...(stat ? { [at.top]: stat } : {}) },
    });
  };
  const task = ctx.viewer.task;
  if (!task) { save(); return ''; }
  const file = path.join(own.seat.dir, 'pending-commits.jsonl');
  const cmd = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
  const git = (args: string[]): string | null => {
    try { return execFileSync('git', ['-C', at.top, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  };
  let shas: string[] = [];
  const claim = taskSinceOf(ctx.wp, task);
  // Nothing before the claim is the task's; the first time, with no base at all, the claim is also where the count starts.
  if (!pos) {
    if (last === undefined && claim !== null) shas = commitsSince(reflog, null, claim, MAX_COMMITS);
    else if (isCommitCommand(cmd) && top && COMMIT_ACTIONS.includes(top.action) && top.sha === at.head) shas = [at.head];
  } else if (top && !(top.at === pos.at && top.sha === pos.sha)) {
    shas = commitsSince(reflog, pos, claim, MAX_COMMITS);
  }
  if (shas.length) {
    const others = othersOn(ctx, own.seat, at.top, at.head);
    shas = !others.live || makesCommits(cmd) ? ownShare(shas, others.seen) : [];
  }
  // Only what HEAD still reaches: a commit the same command undid is not the task's.
  shas = shas.slice(0, MAX_COMMITS).filter(s => git(['merge-base', '--is-ancestor', s, at.head]) !== null);
  if (last && last !== at.head) {
    // An amend, a rebase or a reset: the old base is no longer under HEAD, nor are the commits it replaced.
    // M1: a rebase stopped on a conflict has replayed only part of the task's commits: nothing is dropped, and the position and the base
    // stay where they were, so the pass that runs after `rebase --continue` remaps every line.
    if (git(['merge-base', '--is-ancestor', last, at.head]) === null) {
      if (rebaseInProgress(at.top)) return '';
      const all = lines(file);
      let checked = 0;
      // I3: a commit a rebase replayed keeps its line under the new sha; the replay is told by the subject it copied.
      const replays = replaysSince(reflog, pos);
      const kept = all.flatMap(l => {
        const s = field(l, 'sha');
        // I1: a line whose sha is not a sha never reaches git (`--output=<file>` would be an option); it stays as it is.
        if (!s || !SHA.test(s) || checked >= MAX_COMMITS) return [l];
        checked++;
        if (git(['merge-base', '--is-ancestor', s, at.head]) !== null) return [l];
        const subject = replays.length ? git(['log', '-1', '--format=%s', s])?.trim() : undefined; // fail-open: no subject, the line goes
        const k = subject ? replays.findIndex(r => r.subject === subject && git(['merge-base', '--is-ancestor', r.sha, at.head]) !== null) : -1;
        if (k < 0) return [];
        const [r] = replays.splice(k, 1);
        try { return [JSON.stringify({ ...JSON.parse(l), sha: r.sha })]; } catch { return []; }
      });
      if (kept.length !== all.length || kept.some((l, i) => l !== all[i])) writeFileSync(file, kept.map(l => `${l}\n`).join(''));
    }
  }
  const have = new Set(lines(file).map(l => field(l, 'sha')));
  const ts = io.now().toISOString();
  const fresh = shas.filter(s => !have.has(s));
  if (fresh.length) {
    appendFileSync(file, fresh.map(sha => `${JSON.stringify({ ts, task, sha, command: cmd.slice(0, 200), session: sid, seat: own.bound.sid })}\n`).join(''));
    newest = fresh[fresh.length - 1];
  }
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
  if (ctx) renewOwn(ctx, io, false);
  const own = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own || !ctx.sid) return '';
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
  // M3: parallel hooks may append one sha twice; it is one commit.
  const count = new Set(commits.map(l => field(l, 'sha') ?? l)).size;
  return JSON.stringify({ decision: 'block', reason: `waypoint: ${count} commit(s) / ${queued.length} queued roadmap update(s) are not in the live roadmap yet. Record them (work skill: a \`commit\` event for intermediate commits, or the task's completion), or flush the queue, then remove those lines from ${rel}/pending-commits.jsonl. You can also stop now; this reminder shows once per change.${replyIn(planLocale(ctx.root, ctx.project))}` });
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
