import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parsePlan, PlanError, isPlanId } from '../lib/plan.js';
import { buildDocs, buildSyncWrites, planHash, planViewFromDocs, type Known, type Write } from '../lib/sync.js';
import { normalizeMeta, normalizePhase } from '../page/normalize.js';
import { availableTasks, commitShas } from '../lib/deps.js';
import { pickTask, conflictsFor, recoverableTasks, inboxFor, escalationCandidates, isIdle, IDLE_MINUTES } from '../lib/coordination.js';
import { parseDesign, changedSections, designBody, DesignError, setDesignStatus } from '../lib/design.js';
import { importSpec, SpecImportError } from '../lib/design-import.js';
import { designGate, mergeDismissed } from '../lib/design-gate.js';
import { listVersions, nextVersion, parseChangelog, appendChangelog, parseAppliedItems, roundList, AppliedError, ENTRY_KINDS, entryKind, entryRound, type EntryKind } from '../lib/history.js';
import { parseCritique, selectProposals, formatProposals, CritiqueError, budgetFor, budgetIssues } from '../lib/critique.js';
import { buildDesignPageData } from '../design-page/build.js';
import { designFilesOf, readCritiques, readDismissedOf, readHistory, writeDismissed } from './design-files.js';
import { budgetRound, nextRound } from '../lib/design-round.js';
import { eventId, eventIds, sessionIdFrom } from '../lib/ids.js';
import { computeMetrics } from '../lib/metrics.js';
import { normalizeNote, notesSince, noteLines } from '../lib/notes.js';
import { BRANCH_RE, mainWorktreeFrom, samePath } from '../lib/worktree.js';
import { excludeWorktrees } from '../lib/git-info.js';
import { isCommitCommand, runHook } from './hooks.js';
import { launchRun, EFFORTS, MODELS, type Launcher, type Effort, type Model } from '../lib/launcher.js';
import { PAGE_RULES, declaresAssets, roadmapCapabilities, rulesOf, sharingChangeAsk, sharingChanged, sharingNotice, syncSummary } from '../lib/publish.js';
import { compareVersions, WAYPOINT_VERSION } from '../lib/waypoint-version.js';
import { TASK_STATUSES } from '../lib/types.js';
import { claudeSessionId, noClaudeSession } from '../lib/claude-session.js';
import { blockBatch, claimBatch, cleanText, doneBatch, freeBatch, heartbeatBatch, registerBatch, REASON_MAX, SUMMARY_MAX } from '../lib/batches.js';
import { BOUND_VIAS, MAX_SEATS, isBoundVia, type BoundDoc } from '../lib/bound.js';
import { boundFile, boundLive, checkoutSid, leftSeatOf, openTasksOf, pidFromEnv, readBinding, readSeats, recordBase, secondSeatOf, seatsDir, settleBinding, writeAtomic, writeBinding } from '../lib/bound-fs.js';
import { isSafeId } from '../lib/execution-state.js';
import { loadConfig } from '../forge/config.js';
import type { Commit, MessageDoc, NoteDoc, PhaseDoc, PlanView, SessionDoc, TaskState, TaskStatus } from '../lib/types.js';

// The classic hooks live in hooks.ts; the tests import isCommitCommand from here.
export { isCommitCommand };

export interface Io { cwd: string; now: () => Date; rand?: () => number; assetsDir: string; stdin?: string; env?: Record<string, string | undefined> }
type Result = { code: number; stdout: string; stderr: string };

const USAGE = `usage: waypoint <validate|hash|clean-cache|page|sync|next|conflicts|recover|notes|inbox|escalations|launch|status|session-id|event-id|now|commit-info|claim|done|block|heartbeat|bind|release|design-validate|design-park|design-import|design-snapshot|design-changed|design-gate|design-impact|critique-next|critique-check|critique-select|critique-dismiss|design-page|hook> ...`;

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
    const phases = Object.values(readDocs<unknown>(path.join(abs(db), 'plan'))).map(d => normalizePhase(d)).filter((x): x is PhaseDoc => !!x);
    const meta = existsSync(metaFile) ? normalizeMeta(JSON.parse(readFileSync(metaFile, 'utf8'))) : null;
    if (!meta || !phases.length) throw new CacheError('db plan cache missing — list meta and plan first');
    return { view: planViewFromDocs(meta, phases), project: p.project, version: meta.version || p.version };
  };
  // A-14: the flags every task batch takes; a wrong one is exit 2. A code-3 or code-4 answer prints its JSON on stdout.
  const out = (code: number, value: unknown): Result => ({ code, stdout: `${JSON.stringify(value)}\n`, stderr: '' });
  const posInt = (name: string): number | null => { const v = flag(name); return v !== undefined && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null; };
  // No leading "-" (sessionIdFrom never makes one): `--session $SID --task …` with an empty SID reads `--task`, not an id.
  const SID_RE = /^[A-Za-z0-9_.~:@+][A-Za-z0-9_\-.~:@+]{0,79}$/;
  const taskFlags = (cmd: string, versions: string[]): { sid: string; task: string; v: Record<string, number> } | Result => {
    const sid = flag('session'), task = flag('task');
    if (!sid || !SID_RE.test(sid)) return fail(`${cmd}: --session needs the session id`, 2);
    if (!task || task.startsWith('--') || !isPlanId(task)) return fail(`${cmd}: --task needs a plan task id`, 2);
    // An empty --db reads the next flag: the mirror would write the cache under `<cwd>/--session/`.
    const db = flag('db');
    if (args.includes('--db') && (!db || db.startsWith('-'))) return fail(`${cmd}: --db needs the cache directory`, 2);
    const v: Record<string, number> = {};
    for (const name of versions) {
      const n = posInt(name);
      if (n === null) return fail(`${cmd}: --${name} must be a positive integer`, 2);
      v[name] = n;
    }
    return { sid, task, v };
  };
  // A task of the runtime plan (the db cache with --db, else the plan file): claim, done and block take no other.
  const planHas = (task: string): boolean => loadView().view.tasks.some(t => t.id === task);
  // With --db the local cache sees the state write at once (the hooks read the seat's task there); a write the
  // roadmap refuses is replaced by the next listing of `state`.
  const mirror = (batch: Write[]) => { const db = flag('db'); if (db) for (const w of batch) mirrorState(abs(db), w); };

  try {
    switch (cmd) {
      case 'validate': {
        const p = loadPlan();
        // D-09: forge runs a task without zones alone (it may touch anything), so the plan should say what each touches.
        const loose = p.tasks.filter(t => !t.zones.length).map(t => t.id);
        const warning = loose.length ? `\nwarning: ${loose.length} task(s) without zones run alone in a forge execution: ${loose.join(', ')}` : '';
        // G-25: with --design, each design_ref must name a section of the design (a warning, never a failure).
        // K3-08: and the plan of an approved design names that design and its version.
        let refs = '';
        const designArg = flag('design');
        // Carry 8: --design without its file is an error, not a silent skip; a file that cannot be read and one that is
        // no design say so apart.
        if (args.includes('--design') && (!designArg || designArg.startsWith('--'))) return fail('validate: --design needs the design file', 2);
        if (designArg) {
          let text: string;
          try { text = readFileSync(abs(designArg), 'utf8'); } catch (e) { return fail(`validate: cannot read the design ${designArg}: ${(e as Error).message}`, 2); }
          let design: ReturnType<typeof parseDesign>;
          try { design = parseDesign(text); }
          catch (e) { return fail(`validate: ${designArg} is not a design: ${(e as Error).message}`, 2); }
          const slugs = new Set(['_intro', ...design.sections.map(s => s.slug)]);
          const unknown = p.tasks.filter(t => t.design_ref && !slugs.has(t.design_ref)).map(t => `${t.id} (${t.design_ref})`);
          if (unknown.length) refs = `\nwarning: ${unknown.length} design_ref(s) not in the design: ${unknown.join(', ')}`;
          if (design.meta.status === 'approved') {
            const approved = readChangelog(path.dirname(abs(designArg))).at(-1)?.version;
            if (approved !== undefined && p.design_version !== approved) {
              refs += `\nwarning: design_version is ${p.design_version ?? 'missing'} but the approved design is v${approved}: set design_version: ${approved}`;
            }
            if (design.meta.artifact && p.artifacts.design !== design.meta.artifact) {
              refs += `\nwarning: artifacts.design is not the design's artifact: set it to ${design.meta.artifact.replace(/[\u0000-\u001f\u007f]/g, ' ')}`;
            }
          }
        }
        return ok(`ok: ${p.tasks.length} tasks, ${p.phases.length} phases, ${p.tracks.length} tracks${warning}${refs}`);
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
        // Final review I5: meta/page's rules are those of the capabilities actually published, the file the skill passed to
        // the Artifact publish; read (and refused) before the page is built.
        let published: unknown;
        if (args.includes('--publish-info')) {
          const capsArg = flag('capabilities');
          if (!capsArg || capsArg.startsWith('--')) return fail('page: --publish-info needs --capabilities <file>, the capabilities JSON passed to the Artifact publish', 2);
          try { published = JSON.parse(readFileSync(abs(capsArg), 'utf8')); } catch { return fail(`page: cannot read --capabilities ${capsArg} as JSON`, 2); }
          if (!published || typeof published !== 'object' || Array.isArray(published)) return fail(`page: --capabilities ${capsArg} must be a JSON object`, 2);
        }
        // Re-review I1: --page, the listed meta/page.json, to compare who can see the roadmap now with what this publish gives.
        const pageArg = flag('page');
        if (args.includes('--page') && (!pageArg || pageArg.startsWith('--'))) return fail('page: --page needs the listed meta/page.json', 2);
        const out = abs(flag('out') ?? '.waypoint/roadmap.html');
        const now = io.now().toISOString();
        // G-13, G-14: the snapshot says which waypoint built the page and, with --states, the states the last listing saw
        // (the page shows them until the database answers, and offline).
        const states = flag('states') ? statesOf(abs(flag('states')!), p.tasks.map(t => t.id)) : null;
        const snapshot = { ...buildDocs(p, now), pageVersion: WAYPOINT_VERSION, ...(states ? { states: states.states, statesAt: states.at } : {}) };
        const tpl = readFileSync(path.join(io.assetsDir, 'roadmap.template.html'), 'utf8');
        const html = tpl
          .replace('__TITLE__', () => `${p.project} Roadmap`)
          .replace('__SNAPSHOT__', () => JSON.stringify(snapshot).replace(/</g, '\\u003c'));
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, html);
        if (!args.includes('--publish-info')) return ok(out);
        const internal = evidenceUploaded(io.cwd);
        // G-13, §4.1: meta/page, the version and the rules of what is published (sync --db compares it; infinite reads rules).
        // `capabilities` is what this checkout should publish; `rules`, what the published file grants (rulesOf).
        // `roadmap` is the plan's project, the id known before the first publish: the approvals warning keys on it.
        const rules = rulesOf(published);
        // Re-review I1: meta/page records whether this publish declared `assets`; with --page, whether that changes who can
        // see and share the published roadmap (a listed page without the record, or none, is unknown), and the line to ask.
        const assets = declaresAssets(published);
        let changed: Record<string, unknown> = {};
        if (pageArg) {
          let listed: unknown = null;
          try { listed = JSON.parse(readFileSync(abs(pageArg), 'utf8')); } catch { listed = null; }
          const before = listed && typeof listed === 'object' && typeof (listed as { assets?: unknown }).assets === 'boolean' ? (listed as { assets: boolean }).assets : undefined;
          const capabilitiesChanged = sharingChanged(p, assets, before);
          changed = { capabilitiesChanged, ask: capabilitiesChanged ? sharingChangeAsk(p, assets) : null };
        }
        return ok(JSON.stringify({
          out, capabilities: roadmapCapabilities(internal), internal, say: sharingNotice(p, internal), pageVersion: WAYPOINT_VERSION, rules, ...changed,
          write: { op: 'set', collection: 'meta', doc_id: 'page', data: { version: WAYPOINT_VERSION, rules, assets, roadmap: p.project, publishedAt: now } },
        }));
      }
      case 'sync': {
        const p = loadPlan();
        const knownPath = flag('known');
        const known: Known = knownPath && existsSync(abs(knownPath)) ? JSON.parse(readFileSync(abs(knownPath), 'utf8')) : {};
        const session = flag('session') ?? 'main';
        const now = io.now();
        const outDir = abs(flag('out') ?? '.waypoint/sync');
        // A-11, G-13, G-26: with --db (the listings of the roadmap) a document it holds is never set, what is missing is
        // named, a listing that may be cut stops the sync, and a page older than this waypoint asks to republish.
        const db = flag('db');
        let listed: string[] | undefined;
        let republish = false;
        let syncedHash = false;
        if (db) {
          for (const c of ['state', 'plan', 'meta']) {
            if (jsonFiles(path.join(abs(db), c)).length >= LIST_LIMIT) {
              return fail(`sync: the listing of ${c} may be truncated (${LIST_LIMIT} documents, the most one list returns): split the plan before syncing it`, 2);
            }
          }
          listed = jsonFiles(path.join(abs(db), 'state')).map(f => f.slice(0, -5));
          const metaDocs = readDocs<{ version?: unknown; rules?: unknown; planHash?: unknown }>(path.join(abs(db), 'meta'));
          const page = metaDocs.page;
          republish = !page || compareVersions(page.version, WAYPOINT_VERSION) < 0 || typeof page.rules !== 'number' || page.rules < PAGE_RULES;
          // A-11 for the documents sync writes itself: one the db holds and known.json does not list could only be
          // printed as an unpinned set, which the store refuses. A version known.json has for a document the db lacks is dropped.
          const inDb = { state: new Set(listed), plan: new Set(jsonFiles(path.join(abs(db), 'plan')).map(f => f.slice(0, -5))), meta: new Set(Object.keys(metaDocs)) };
          const unlisted = [
            ...p.phases.map(ph => ph.id).filter(id => inDb.plan.has(id) && !known.plan?.[id]).map(id => `plan/${id}`),
            ...(inDb.meta.has('project') && !known.meta?.project ? ['meta/project'] : []),
          ];
          if (unlisted.length) return fail(`sync: known.json has no version of ${unlisted.join(', ')}, which this sync has to write: list the db first (or refresh known.json)`, 2);
          for (const c of ['state', 'plan', 'meta'] as const) {
            for (const id of Object.keys(known[c] ?? {})) if (!inDb[c].has(id)) delete known[c]![id];
          }
          if (metaDocs.project?.planHash === planHash(p)) syncedHash = true;
        }
        const statesDir = flag('states') ?? (db ? path.join(db, 'state') : undefined);
        const r = buildSyncWrites(p, known, outDir, {
          nowIso: now.toISOString(),
          sessionId: session,
          eventId: eventId(now, session, io.rand),
          states: readDocs<TaskState>(statesDir && abs(statesDir)),
          ...(listed ? { listed } : {}),
          ...(syncedHash ? { planSynced: true } : {}),
        });
        if (r.needsList.length) {
          return fail(`sync: known.json has no version of ${r.needsList.map(id => `state/${id}`).join(', ')}, which this sync has to write: list state again and write known.json from that listing`, 2);
        }
        mkdirSync(outDir, { recursive: true });
        for (const [file, body] of Object.entries(r.files)) writeFileSync(file, JSON.stringify(body, null, 2));
        return ok(JSON.stringify({ batches: r.batches, say: syncSummary(p), removed: r.removed, missing: r.missing, unknownVersion: r.unknownVersion, republish }));
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
        const localeFlag = flag('locale');
        if (localeFlag !== undefined && localeFlag !== 'es' && localeFlag !== 'en') return fail('notes: --locale must be es or en', 2);
        // The plan, when given, names the task ids a line may mention and the language when --locale is not given.
        const plan = flag('plan') !== undefined ? parsePlan(readFileSync(abs(flag('plan')!), 'utf8')) : null;
        const locale = localeFlag ?? (plan?.locale?.toLowerCase().startsWith('es') ? 'es' : 'en');
        // No notes directory yet means nobody has written a note: not an error.
        if (!existsSync(abs(dir))) return ok(JSON.stringify({ notes: [], latest: null, say: [], mentions: [] }));
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
        const since = flag('since') ?? null;
        const notes = notesSince(all, since);
        const { say, mentions } = noteLines(notes, since, locale, new Set(plan?.tasks.map(t => t.id) ?? []));
        return ok(JSON.stringify({ notes, latest, say, mentions }));
      }
      case 'inbox': {
        const session = flag('session');
        if (!session) return fail('inbox: --session is required', 2);
        return ok(JSON.stringify(inboxFor(readDocs<MessageDoc>(flag('messages') && abs(flag('messages')!)), session)));
      }
      case 'escalations':
        return ok(JSON.stringify(escalationCandidates(readDocs<MessageDoc>(flag('messages') && abs(flag('messages')!)))));
      case 'launch': {
        // The plan path goes into the launched session's prompt, inside double quotes in a shell command.
        if (args[0] !== undefined && !/^[\w./\\:~@+ -]+$/.test(args[0])) return fail('launch: the plan path may only use letters, digits, spaces and _ . / \\ : ~ @ + -', 2);
        const p = loadPlan();
        const track = args[1];
        const taskMode = args.includes('--task');
        if (taskMode) {
          if (!track || !isPlanId(track) || !p.tasks.some(t => t.id === track)) return fail(`launch: unknown task ${track ?? ''}`);
        } else if (!p.tracks.some(t => t.id === track)) return fail(`launch: unknown track ${track ?? ''}`);
        const SAFE_ID = /^[A-Za-z0-9_.~:@+][A-Za-z0-9_\-.~:@+]{0,79}$/;
        const val = (f: string) => { const i = args.indexOf(f); const v = i >= 0 ? args[i + 1] : undefined; return v && !v.startsWith('--') ? v : undefined; };
        // A member session's own effort and model: closed lists, so they go into the shell command unquoted.
        let effort: Effort | undefined, model: Model | undefined;
        if (taskMode) {
          if (args.includes('--effort')) {
            const v = val('--effort');
            if (!v || !(EFFORTS as readonly string[]).includes(v)) return fail(`launch --task: --effort must be one of ${EFFORTS.join(', ')}`, 2);
            effort = v as Effort;
          }
          if (args.includes('--model')) {
            const v = val('--model');
            if (!v || !(MODELS as readonly string[]).includes(v)) return fail(`launch --task: --model must be one of ${MODELS.join(', ')}`, 2);
            model = v as Model;
          }
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
        // A-08: the worktrees never show as untracked, also without a .gitignore entry for them (at the main checkout).
        const excludeHere = () => excludeWorktrees(a => {
          try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
        });
        if (taskMode) {
          // Same worktree and branch names as `forge swarm worktree <T>`: every execution mode shares the work of a task.
          const taskWt = path.join(root, '.claude', 'worktrees', `task-${track}`);
          const taskBranch = `task/${track}`;
          const taskName = `wp-${p.project}-${track}`;
          const taskPrompt = `/forge:member --plan ${args[0]} --task ${track} — run member of ${val('--coordinator')}: work only ${track}, then stop`;
          const taskFlags = `${effort ? ` --effort ${effort}` : ''}${model ? ` --model ${model}` : ''}`;
          const taskCommand = `claude --bg --name ${taskName}${taskFlags} "${taskPrompt}"`;
          // The launcher is resolved before any branch or worktree exists: a refused one leaves nothing behind.
          const taskRun = launchRun(launcher as Launcher, { name: taskName, prompt: taskPrompt, worktree: taskWt, effort, model });
          if (taskRun === null) return fail('launch: herdr cannot open panes from the command line; use launcher bg', 2);
          if (!existsSync(taskWt)) {
            excludeHere();
            const exists = git('branch', '--list', taskBranch) !== '';
            git('worktree', 'add', taskWt, ...(exists ? [taskBranch] : ['-b', taskBranch, base!]));
          }
          return ok(JSON.stringify({ worktree: taskWt, branch: taskBranch, name: taskName, prompt: taskPrompt, command: taskCommand, run: taskRun, runId: val('--run'), task: track }));
        }
        const worktree = path.join(root, '.claude', 'worktrees', track!);
        const branch = `track/${track}`;
        const name = `wp-${p.project}-${track}`;
        // J-02: no forge mark. A track of a plan that a forge execution runs joins it as a manual member by itself
        // (/waypoint:work §0.5). --forge and --no-forge are still accepted and do nothing, for skills loaded before 0.20.
        // J-16: --swarm is obsolete (forge launches run members with --task): it keeps its checks and changes nothing.
        const prompt = `/waypoint:work ${track}`
          + (args.includes('--merge') ? ` — the user authorizes merging ${branch} into main at phase close` : '');
        const command = `claude --bg --name ${name} "${prompt}"`;
        // `run` starts it from any directory without moving the caller's shell: a cd outside a subshell would
        // leave a coordinator working in the worktree. Single quotes, with any quote in the path escaped.
        const inWorktree = launchRun(launcher as Launcher, { name, prompt, worktree });
        if (inWorktree === null) return fail('launch: herdr cannot open panes from the command line; use launcher bg', 2);
        // Only once the launcher resolved: a refused one leaves no branch nor worktree behind.
        if (!existsSync(worktree)) {
          excludeHere();
          const exists = git('branch', '--list', branch) !== '';
          git('worktree', 'add', worktree, ...(exists ? [branch] : ['-b', branch, ...(base ? [base] : [])]));
        }
        const done = ok(JSON.stringify({ worktree, branch, name, prompt, command, run: inWorktree }));
        return swarm ? { ...done, stderr: '--swarm is obsolete: forge launches run members with --task\n' } : done;
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
      case 'commit-info':
        return ok(JSON.stringify(commitInfo(io.cwd, args[0] ?? 'HEAD')));
      case 'claim': {
        const f = taskFlags('claim', ['state-version', 'session-version']);
        if ('code' in f) return f;
        if (!planHas(f.task)) return fail(`claim: unknown task ${f.task}`, 2);
        const from = flag('recovered-from');
        if (args.includes('--recovered-from') && (!from || !SID_RE.test(from))) return fail('claim: --recovered-from needs the previous owner', 2);
        const now = io.now();
        const sessions = optSessions();
        // solo: no other session of the listing is alive, so nobody can have claimed at the same time.
        const solo = !!sessions && Object.entries(sessions).every(([id, s]) => id === f.sid || isIdle(s, now.getTime()));
        const unblock = args.includes('--unblock');
        const r = claimBatch({ sid: f.sid, task: f.task, stateVersion: f.v['state-version'], sessionVersion: f.v['session-version'], now, eids: eventIds(now, f.sid, unblock ? 2 : 1, io.rand), unblock, recoveredFrom: from ?? null });
        mirror(r.batch);
        return ok(JSON.stringify({ ...r, solo }));
      }
      case 'done': {
        // A-10: --meta-version is no longer needed: the metrics go apart (an older skill may still pass it).
        const f = taskFlags('done', ['state-version', 'session-version']);
        if ('code' in f) return f;
        if (!planHas(f.task)) return fail(`done: unknown task ${f.task}`, 2);
        const file = flag('summary-file');
        if (!file) return fail('done: --summary-file is required', 2);
        let summary: string;
        try { summary = readFileSync(abs(file), 'utf8'); } catch { return fail(`done: cannot read ${file}`, 2); }
        if (!cleanText(summary, SUMMARY_MAX)) return fail('done: the summary file is empty', 2);
        const tests = flag('tests');
        if (tests !== undefined && !/^\d{1,9}$/.test(tests)) return fail('done: --tests must be a whole number', 2);
        const rev = flag('rev') ?? 'HEAD';
        if (!BRANCH_RE.test(rev)) return fail('done: --rev needs a commit', 2);
        const now = io.now();
        const r = doneBatch({
          sid: f.sid, task: f.task, stateVersion: f.v['state-version'], sessionVersion: f.v['session-version'],
          now, eids: eventIds(now, f.sid, 1, io.rand), commit: commitInfo(io.cwd, rev), summary, ...(tests !== undefined ? { tests: Number(tests) } : {}),
        });
        mirror(r.batch);
        return ok(JSON.stringify(r));
      }
      case 'block': {
        const f = taskFlags('block', ['state-version', 'session-version']);
        if ('code' in f) return f;
        if (!planHas(f.task)) return fail(`block: unknown task ${f.task}`, 2);
        const by = (flag('by') ?? '').split(',').map(s => s.trim()).filter(Boolean);
        if (!by.length || by.some(b => b !== 'external' && (b.startsWith('--') || !isPlanId(b)))) return fail('block: --by needs task ids or external, comma-separated', 2);
        const file = flag('why-file');
        if (!file) return fail('block: --why-file is required', 2);
        let reason: string;
        try { reason = readFileSync(abs(file), 'utf8'); } catch { return fail(`block: cannot read ${file}`, 2); }
        if (!cleanText(reason, REASON_MAX)) return fail('block: the reason file is empty', 2);
        const now = io.now();
        const r = blockBatch({ sid: f.sid, task: f.task, stateVersion: f.v['state-version'], sessionVersion: f.v['session-version'], now, eids: eventIds(now, f.sid, 1, io.rand), by, reason });
        mirror(r.batch);
        return ok(JSON.stringify(r));
      }
      case 'heartbeat': {
        const sid = flag('session');
        if (!sid || !SID_RE.test(sid)) return fail('heartbeat: --session needs the session id', 2);
        const now = io.now();
        if (args.includes('--register')) {
          const need = (n: string): string | null => { const v = flag(n); return v && !v.startsWith('--') ? v.slice(0, 200) : null; };
          const name = need('name'), agent = need('agent'), branch = need('branch'), worktree = need('worktree');
          if (!name || !agent || !branch || !worktree) return fail('heartbeat --register: --name, --agent, --branch and --worktree are required', 2);
          const svFlag = flag('session-version');
          const sv = svFlag === undefined ? null : posInt('session-version');
          if (svFlag !== undefined && sv === null) return fail('heartbeat: --session-version must be a positive integer', 2);
          const claude = claudeSessionId(flag('claude'), io.env ?? {});
          const sessions = optSessions();
          if (sessions && heldElsewhere(sessions[sid], now.getTime(), claude, worktree)) return out(3, { held: sid, use: freeSid(sid, sessions, now.getTime(), claude, worktree) });
          return ok(JSON.stringify(registerBatch({ sid, now, name, agent, branch, worktree, track: need('track'), claude, sessionVersion: sv })));
        }
        const sv = posInt('session-version');
        if (sv === null) return fail('heartbeat: --session-version must be a positive integer', 2);
        const idle = args.includes('--idle');
        const busy = flag('busy-until');
        if (busy !== undefined && (idle || !Number.isFinite(Date.parse(busy)))) return fail('heartbeat: --busy-until needs an ISO time, and not with --idle', 2);
        return ok(JSON.stringify(heartbeatBatch({ sid, sessionVersion: sv, now, busyUntil: busy !== undefined ? new Date(busy) : null, idle })));
      }
      case 'bind': {
        // C3: bind this conversation to a seat of the checkout; never a seat another live conversation holds.
        if (!args[0] || args[0].startsWith('--')) return fail('usage: waypoint bind <plan.yaml|design.md> --via work|design|forge-run|forge-member|forge-infinite [--claude <id>] [--seat <sid> | --second-seat] [--track <t>] [--resume] [--takeover]', 2);
        const via = flag('via');
        if (!isBoundVia(via)) return fail(`bind: --via must be one of ${BOUND_VIAS.join(', ')}`, 2);
        const claude = claudeSessionId(flag('claude'), io.env ?? {});
        if (!claude) return fail(noClaudeSession('bind', '--claude'), 2);
        // An empty substitution leaves the next flag where the value goes: `--seat --resume` names no seat.
        const valueOf = (name: string): string | null | undefined => {
          if (!args.includes(`--${name}`)) return undefined;
          const v = flag(name);
          return v && !v.startsWith('-') ? v : null;
        };
        const seatFlag = valueOf('seat');
        const track = valueOf('track');
        if (seatFlag === null || track === null) return fail('bind: --seat and --track need a value', 2);
        const second = args.includes('--second-seat');
        if (second && seatFlag !== undefined) return fail('bind: --seat and --second-seat exclude each other', 2);
        const target = projectOf(abs(args[0]), io.cwd);
        if (!target) return fail(`bind: ${args[0]} is not in a project folder with a valid id`, 2);
        const wp = path.join(io.cwd, '.waypoint', target.project);
        const rel = (p: string) => path.relative(io.cwd, p).split(path.sep).join('/') || '.';
        const now = io.now();
        const t = now.getTime();
        const open = openTasksOf(wp);
        const own = checkoutSid(wp, t);
        const resume = args.includes('--resume');
        const takeover = args.includes('--takeover');
        // I3: a task an earlier conversation left on a seat; --resume without --seat takes that seat, unless this
        // conversation already holds a live seat with a task open: that one it keeps (M1 would end it otherwise).
        const seats = readSeats(wp, t);
        const left = leftSeatOf(seats, open, t);
        const working = seats.find(s => s.bound?.claude === claude && boundLive(s.bound, t) && !!open[s.sid]);
        const picked = resume ? working ?? left : undefined;
        let sid: string | null;
        if (seatFlag !== undefined) sid = seatFlag;
        else if (picked) sid = picked.sid;
        else if (second) sid = secondSeatOf(wp, claude, open, t);
        else sid = own ?? sessionIdFrom(track ?? 'main');
        if (sid === null) return fail(`bind: every extra seat (main-2 to main-${MAX_SEATS + 1}) is held by a live conversation`, 2);
        if (!isSafeId(sid) || sid.startsWith('-')) {
          const fix = seatFlag !== undefined ? 'pick another --seat' : own !== null ? `fix the sessionId of ${rel(path.join(wp, 'session.json'))}` : 'pick another --track';
          return fail(`bind: the seat id ${JSON.stringify(sid.slice(0, 130))} names a folder: only letters, digits, _ . - and no leading - (${fix})`, 2);
        }
        const seatDir = picked && sid === picked.sid ? picked.dir : second || (own !== null && own !== sid) ? path.join(seatsDir(wp), sid) : wp;
        const cur = readBinding(seatDir, sid, t);
        const task = open[sid] ?? null;
        const options = ['worktree', 'second-seat', 'takeover'];
        // As the hooks see it: one live by its lease whose process is gone ended at its last renewal.
        const prevOf = (raw: BoundDoc) => {
          const b = settleBinding(raw, t);
          return { sid: b.sid, claude: b.claude, endedAt: b.endedAt, endReason: b.endReason, seenAt: b.seenAt, task: open[b.sid] ?? null };
        };
        // Exit 3 also names a task another seat left, so the person can resume it there (I3).
        const held = (b: BoundDoc) => ({ held: { sid, claude: b.claude, via: b.via, seenAt: b.seenAt, task }, options, secondSeat: secondSeatOf(wp, claude, open, t), ...(left?.bound && left.sid !== sid ? { previous: prevOf(left.bound) } : {}) });
        let took: 'new' | 'same' | 'takeover' | 'previous';
        if (!cur) took = 'new';
        else if (cur.claude === claude) took = 'same';
        else if (boundLive(cur, t)) {
          if (!takeover) return out(3, held(cur));
          took = 'takeover';
        } else if (task && !resume && !takeover) return out(4, { previous: prevOf(cur), options: ['resume', 'release'] });
        else took = 'previous';
        const iso = now.toISOString();
        writeBinding(boundFile(seatDir), { sid, claude, pid: pidFromEnv(io.env), via, since: took === 'same' && cur ? cur.since : iso, seenAt: iso, endedAt: null, endReason: null });
        // Two binds on one seat at once: each renames its own file in; the one that reads another's back lost.
        const back = readBinding(seatDir, sid, t);
        if (!back || back.claude !== claude) return out(3, back ? held(back) : { held: null, options, secondSeat: null });
        // M1: one conversation, one seat of the project: its other live bindings end as released (never reopened).
        for (const s of readSeats(wp, t)) {
          if (s.sid !== sid && s.bound?.claude === claude && s.bound.endedAt === null) writeBinding(boundFile(s.dir), { ...s.bound, endedAt: iso, endReason: 'released' });
        }
        // The seat's session.json: created when missing, never changing a field it already has (B-12).
        const sessionFile = path.join(seatDir, 'session.json');
        let session: Record<string, unknown> = {};
        try { const v: unknown = JSON.parse(readFileSync(sessionFile, 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) session = v as Record<string, unknown>; } catch { session = {}; }
        const merged = { ...(target.plan ? { plan: target.plan, url: target.url } : {}), sessionId: sid, track: track ?? null, ...session };
        if (Object.keys(merged).length !== Object.keys(session).length) writeAtomic(sessionFile, `${JSON.stringify(merged, null, 2)}\n`);
        recordBase(seatDir, claude, io.cwd);
        return out(0, { took, sid, seatDir: rel(seatDir), sessionFile: rel(sessionFile), claude, via, ...(cur && (took === 'takeover' || took === 'previous') ? { previous: prevOf(cur) } : {}) });
      }
      case 'release': {
        if (!args[0] || args[0].startsWith('--')) return fail('usage: waypoint release <plan.yaml|design.md> [--seat <sid>] [--claude <id>] [--free <T> --state-version <V> [--session-version <SV>] [--db <dir>] [--keep-seat]]', 2);
        // Re-review m5: --keep-seat gives a task back and keeps this conversation on its seat (it goes on working).
        const keepSeat = args.includes('--keep-seat');
        if (keepSeat && flag('free') === undefined) return fail('release: --keep-seat goes with --free <T>', 2);
        // An empty --db value reads the next flag: the mirror would write the cache under `<cwd>/--seat/`.
        const dbFlag = flag('db');
        if (args.includes('--db') && (!dbFlag || dbFlag.startsWith('-'))) return fail('release: --db needs the cache directory', 2);
        const target = projectOf(abs(args[0]), io.cwd);
        if (!target) return fail(`release: ${args[0]} is not in a project folder with a valid id`, 2);
        const wp = path.join(io.cwd, '.waypoint', target.project);
        const rel = (p: string) => path.relative(io.cwd, p).split(path.sep).join('/') || '.';
        const now = io.now();
        const t = now.getTime();
        const claude = claudeSessionId(flag('claude'), io.env ?? {});
        const seats = readSeats(wp, t);
        const seatFlag = flag('seat');
        // An empty substitution leaves the next flag, or nothing, where the seat goes: that names no seat.
        if (args.includes('--seat') && (!seatFlag || seatFlag.startsWith('-'))) return fail('release: --seat needs a seat id', 2);
        const seat = seatFlag !== undefined ? seats.find(s => s.sid === seatFlag) : (claude ? seats.find(s => s.bound?.claude === claude) : undefined) ?? seats.find(s => s.checkout);
        if (!seat) return fail(seatFlag !== undefined ? `release: no seat ${seatFlag} in ${rel(wp)}` : `release: no seat in ${rel(wp)}`, 2);
        let batch: Write[] | undefined;
        const db = dbFlag !== undefined ? abs(dbFlag) : path.join(wp, 'dbcache');
        const free = flag('free');
        if (free !== undefined) {
          if (!isPlanId(free)) return fail('release: --free needs a task id', 2);
          const v = posInt('state-version');
          if (v === null) return fail('release: --state-version must be a positive integer', 2);
          const svFlag = flag('session-version');
          const sv = svFlag === undefined ? null : posInt('session-version');
          if (svFlag !== undefined && sv === null) return fail('release: --session-version must be a positive integer', 2);
          let owner: unknown = null;
          try { owner = (JSON.parse(readFileSync(path.join(db, 'state', `${free}.json`), 'utf8')) as { owner?: unknown }).owner; } catch { owner = null; }
          if (owner !== seat.sid) return fail(`release: ${free} is not held by seat ${seat.sid} in the state cache (list state first)`, 2);
          batch = freeBatch({ sid: seat.sid, task: free, stateVersion: v, sessionVersion: sv, keepSeat });
        }
        const b = seat.bound;
        if (b && b.claude !== claude && boundLive(b, t)) return fail(`release: ${seat.sid} is bound to another live session`, 3);
        let released = false;
        if (!keepSeat && b && b.claude === claude && b.endedAt === null) {
          writeBinding(boundFile(seat.dir), { ...b, endedAt: now.toISOString(), endReason: 'released' });
          released = true;
        }
        if (batch) mirrorState(db, batch[0]);
        return out(0, { released, sid: seat.sid, seatDir: rel(seat.dir), now: now.toISOString(), ...(batch ? { batch } : {}) });
      }
      case 'design-validate': {
        const d = parseDesign(readFileSync(abs(args[0]), 'utf8'));
        const log = readChangelog(path.dirname(abs(args[0])));
        const sections = d.sections.length;
        return ok(`ok: ${d.words} words, ${sections} sections, v${log[log.length - 1]?.version ?? 0}`);
      }
      case 'design-park': {
        // K3-13: a parked design is not announced at session start nor drawn in the band; only a draft is parked.
        if (!args[0] || args[0].startsWith('--')) return fail('usage: waypoint design-park <design.md>', 2);
        const file = abs(args[0]);
        let text: string;
        try { text = readFileSync(file, 'utf8'); } catch { return fail(`design-park: cannot read ${args[0]}`, 2); }
        const d = parseDesign(text);
        if (d.meta.status === 'parked') return ok(JSON.stringify({ path: file, status: 'parked', changed: false }));
        if (d.meta.status !== 'draft') return fail(`design-park: only a draft design can be parked (this one is ${d.meta.status})`, 2);
        const next = setDesignStatus(text, 'parked');
        parseDesign(next);
        writeAtomic(file, next);
        return ok(JSON.stringify({ path: file, status: 'parked', changed: true }));
      }
      case 'design-import': {
        const spec = args[0];
        const project = flag('project');
        const out = flag('out');
        if (!spec || spec.startsWith('--') || !project || !out) return fail('usage: waypoint design-import <spec.md> --project <id> [--locale <l>] --out <design.md>', 2);
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(project) || project === '.' || project === '..') return fail(`design-import: invalid project id ${project}`, 2);
        const target = abs(out);
        if (existsSync(target)) return fail(`design-import: ${out} already exists; an import never overwrites a design`, 2);
        let text: string;
        try { text = readFileSync(abs(spec), 'utf8'); } catch { return fail(`design-import: cannot read ${spec}`, 2); }
        // `source` is relative to the repository (the git top level of the spec), else to the working directory.
        let source = path.relative(io.cwd, abs(spec)).split(path.sep).join('/');
        try {
          const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(abs(spec)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          const rel = path.relative(path.resolve(top), abs(spec)).split(path.sep).join('/');
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) source = rel;
        } catch { /* not a git repository */ }
        let design: string;
        try { design = importSpec(text, { project, locale: flag('locale') ?? 'en', source }); } catch (e) {
          if (e instanceof SpecImportError) return fail(`design-import: ${e.message}`, 2);
          throw e;
        }
        let d;
        try { d = parseDesign(design); } catch (e) {
          if (e instanceof DesignError) return fail(`design-import: ${e.message}`, 2);
          throw e;
        }
        mkdirSync(path.dirname(target), { recursive: true });
        try { writeFileSync(target, design, { flag: 'wx' }); } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EEXIST') return fail(`design-import: ${out} already exists; an import never overwrites a design`, 2);
          throw e;
        }
        return ok(JSON.stringify({ path: target, title: d.meta.title, sections: d.sections.length, words: d.words, source }));
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
        // K3-10: the critiques from docs/…/critiques/ first, then .waypoint/<project>/.
        const files = designFilesOf(file, d.meta.project);
        const critiques = readCritiques(files);
        const roundFlag = flag('round');
        // Final review I1: without --round, the newest round of the changelog and of the critiques, as critique-next counts
        // them, so an approval or a reopen after a critique no snapshot recorded carries that critique's round, and the
        // first round after a reopen gets round 1's budget. An explicit --round wins.
        const round = roundFlag !== undefined ? Number(roundFlag) : Math.max(entryRound(log[log.length - 1]), ...critiques.map(c => c.round));
        if (!Number.isInteger(round) || round < 0) return fail('design-snapshot: --round must be a non-negative integer', 2);
        // K3-07: what kind of entry this is. An amend or an approve keeps an approved design; a reopen needs it a draft
        // again. The CLI never changes the status: the skill sets it first, and a status that does not match is refused.
        const kindFlag = flag('kind');
        if (args.includes('--kind') && (kindFlag === undefined || !(ENTRY_KINDS as readonly string[]).includes(kindFlag))) {
          return fail(`design-snapshot: --kind must be one of ${ENTRY_KINDS.join(', ')}`, 2);
        }
        const kindGiven = kindFlag as EntryKind | undefined;
        // An approval hides what it applied; an amendment of an approved design may carry the items of its apply or rewrite.
        if (kindGiven === 'approve' && (args.includes('--applied') || args.includes('--rewrite'))) {
          return fail('design-snapshot: --kind approve cannot go with --applied or --rewrite: the entry would hide what it applied', 2);
        }
        if ((kindGiven === 'amend' || kindGiven === 'approve') && d.meta.status !== 'approved') {
          return fail(`design-snapshot: --kind ${kindGiven} needs status: approved in the design (it is ${d.meta.status})`, 2);
        }
        if (kindGiven === 'reopen' && d.meta.status !== 'draft') {
          return fail(`design-snapshot: --kind reopen needs status: draft in the design (it is ${d.meta.status}); set it first`, 2);
        }
        if (kindGiven === 'reopen' && !log.some(e => entryKind(e) === 'approve')) {
          return fail('design-snapshot: --kind reopen needs a design that was approved once: this draft was never approved, so there is nothing to reopen', 2);
        }
        // A-04, K3-02: what this entry applied and what its interview resolved, checked against the critiques before
        // anything is written. An id that is in no critique is an error (exit 2) that names it, never ignored.
        const critiqueOf = (r: number) => critiques.find(c => c.round === r)?.critique ?? null;
        const items: { applied: Record<number, number[]> | null; resolved: Record<number, number[]> | null } = { applied: null, resolved: null };
        for (const name of ['applied', 'resolved'] as const) {
          const at = args.indexOf(`--${name}`);
          if (at < 0) continue;
          const end = args.findIndex((a, i) => i > at && a.startsWith('--'));
          let got: Record<number, number[]>;
          try { got = parseAppliedItems(args.slice(at + 1, end < 0 ? args.length : end), roundFlag !== undefined ? round : null, name); } catch (e) {
            if (e instanceof AppliedError) return fail(`design-snapshot: ${e.message}`, 2);
            throw e;
          }
          for (const [r, ns] of Object.entries(got)) {
            const c = critiqueOf(Number(r));
            if (!c) return fail(`design-snapshot: round ${r} has no critique (${path.join(files.critiques, `r${r}.json`)})`, 2);
            const missing = ns.filter(n => !c.proposals.some(p => p.n === n));
            if (missing.length) return fail(`design-snapshot: round ${r} has no proposal ${missing.join(', ')}`, 2);
          }
          items[name] = got;
        }
        const applied = items.applied;
        const resolved = items.resolved ? roundList(items.resolved) : null;
        const rewrite = args.includes('--rewrite');
        if (rewrite && (roundFlag === undefined || !critiqueOf(round))) return fail('design-snapshot: --rewrite needs --round <R> and the critique of that round', 2);
        const kind: EntryKind | undefined = kindGiven ?? (rewrite ? 'rewrite' : applied ? 'apply' : undefined);
        // Pure check first so a stale changelog fails before anything is written.
        const next = appendChangelog(log, {
          version, date: io.now().toISOString().slice(0, 10), note, words: d.words, round,
          ...(applied ? { applied } : {}), ...(rewrite ? { rewrite: true as const } : {}), ...(resolved ? { resolved } : {}), ...(kind ? { kind } : {}),
        });
        mkdirSync(histDir, { recursive: true });
        const dest = path.join(histDir, `v${version}.md`);
        try { writeFileSync(dest, text, { flag: 'wx' }); } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EEXIST') return fail(`design-snapshot: ${dest} already exists; history is immutable`);
          throw e;
        }
        writeFileSync(path.join(base, 'changelog.json'), JSON.stringify(next, null, 2) + '\n');
        return ok(JSON.stringify({ version, path: dest, ...(applied ? { applied } : {}), ...(resolved ? { resolved } : {}), ...(kind ? { kind } : {}) }));
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
          return ok(JSON.stringify({ since: 0, changed: d.sections.map(s => s.slug), removed: [], scope: 'full' }));
        }
        // K3-03: the bodies only, so a front matter change (status, artifact) is no change; K3-14: and what went away.
        const { changed, removed } = changedSections(designBody(readFileSync(prevFile, 'utf8')), d.body);
        const total = d.sections.length;
        const count = changed.filter(s => s !== '_intro').length + removed.length;
        return ok(JSON.stringify({ since, changed, removed, scope: total === 0 || count * 2 > total ? 'full' : 'changed' }));
      }
      case 'design-gate': {
        if (!args[0] || args[0].startsWith('--')) return fail('usage: waypoint design-gate <design.md>', 2);
        const file = abs(args[0]);
        const text = readFileSync(file, 'utf8');
        const d = parseDesign(text);
        // K3-10: the critiques and dismissed.json from the design's folder (docs/ first, then .waypoint/), never from the
        // working directory; K3-06: the history and the file, so that needsVerify compares the bodies.
        const files = designFilesOf(file, d.meta.project);
        return ok(JSON.stringify(designGate(readChangelog(files.dir), readCritiques(files), readDismissedOf(files), { history: readHistory(files.dir), current: text })));
      }
      case 'critique-next': {
        // K3-04, K3-06: the next critique round (number, budget, scope, sections, output path), so the skill computes none.
        if (!args[0] || args[0].startsWith('--')) return fail('usage: waypoint critique-next <design.md> [--verify] [--full]', 2);
        const file = abs(args[0]);
        const text = readFileSync(file, 'utf8');
        const d = parseDesign(text);
        const files = designFilesOf(file, d.meta.project);
        const critiques = readCritiques(files);
        const verify = args.includes('--verify');
        if (verify && !critiques.some(c => c.critique !== null)) return fail('critique-next: nothing to verify: no critique yet, run a round first', 2);
        const next = nextRound({
          changelog: readChangelog(files.dir), critiques, history: readHistory(files.dir), current: text,
          sections: d.sections.map(s => s.slug), verify, full: args.includes('--full'),
        });
        return ok(JSON.stringify({ ...next, out: path.join(files.critiques, `r${next.round}.json`) }));
      }
      case 'design-impact': {
        // A-21: the plan tasks an amendment touches: those whose design_ref is a section that changed or went away since
        // the version the plan follows, and how many tasks have no design_ref at all.
        const usage = 'usage: waypoint design-impact <design.md> --plan <plan.yaml> [--since <N>] [--states <dir>]';
        if (!args[0] || args[0].startsWith('--') || !flag('plan')) return fail(usage, 2);
        const sinceFlag = flag('since');
        if (sinceFlag !== undefined && !/^[1-9]\d*$/.test(sinceFlag)) return fail('design-impact: --since must be a positive integer', 2);
        const file = abs(args[0]);
        const d = parseDesign(readFileSync(file, 'utf8'));
        let plan: ReturnType<typeof parsePlan>;
        try { plan = parsePlan(readFileSync(abs(flag('plan')!), 'utf8')); } catch (e) { return fail(`design-impact: ${(e as Error).message}`, 2); }
        const dir = path.dirname(file);
        const history = readHistory(dir);
        const versions = Object.keys(history).map(Number);
        const current = readChangelog(dir).at(-1)?.version ?? Math.max(0, ...versions);
        // Since: --since, else the version the plan follows, else the version before the current one, else nothing (all changed).
        const before = versions.filter(v => v < current).sort((a, b) => b - a)[0];
        const since = sinceFlag !== undefined ? Number(sinceFlag) : plan.design_version ?? before ?? 0;
        if (since > 0 && history[since] === undefined) return fail(`design-impact: no history for v${since}`, 2);
        const { changed, removed } = since > 0
          ? changedSections(designBody(history[since]), d.body)
          : { changed: ['_intro', ...d.sections.map(s => s.slug)], removed: [] as string[] };
        // G-14: the tolerant reader, so a broken state file leaves that task with no status instead of failing.
        const states = flag('states') ? statesOf(abs(flag('states')!), plan.tasks.map(t => t.id))?.states ?? {} : {};
        const hit = new Set([...changed, ...removed]);
        const tasks = plan.tasks.filter(t => t.design_ref && hit.has(t.design_ref))
          .map(t => ({ id: t.id, ref: t.design_ref as string, status: states[t.id] ?? null }));
        return ok(JSON.stringify({ since, changed, removed, tasks, unref: plan.tasks.filter(t => !t.design_ref).length }));
      }
      case 'critique-dismiss': {
        // waypoint critique-dismiss <design> --round <R> <spec> [--reason-file <f>]: the spec is the argument after the
        // design that is no flag nor a flag's value.
        const usage = 'usage: waypoint critique-dismiss <design.md> --round <R> <all|1,3> [--reason-file <f>]';
        const valued = new Set(['--round', '--reason-file']);
        const rest = args.slice(1);
        const spec = rest.filter((a, i) => !valued.has(a) && !valued.has(rest[i - 1]))[0];
        const roundFlag = flag('round');
        if (!args[0] || args[0].startsWith('--') || !args.includes('--round') || !spec || spec.startsWith('--')) return fail(usage, 2);
        if (!roundFlag || !/^[1-9]\d*$/.test(roundFlag)) return fail('critique-dismiss: --round must be a positive integer', 2);
        const round = Number(roundFlag);
        // K3-05: the person's reason comes in a file, so their words never go through a shell string.
        let reason: string | undefined;
        if (args.includes('--reason-file')) {
          const reasonFile = flag('reason-file');
          if (!reasonFile || reasonFile.startsWith('--')) return fail(usage, 2);
          try { reason = readFileSync(abs(reasonFile), 'utf8'); } catch { return fail(`critique-dismiss: cannot read ${reasonFile}`, 2); }
          // A canned reason says nothing: the person's own words (or none, for a minor) are what the gate keeps.
          if (PLACEHOLDER_REASONS.has(reasonKey(reason))) return fail(`critique-dismiss: "${reason.trim().slice(0, 60)}" is a placeholder, not a reason: pass the person's own words`, 2);
        }
        const file = abs(args[0]);
        const d = parseDesign(readFileSync(file, 'utf8'));
        const files = designFilesOf(file, d.meta.project);
        const entry = readCritiques(files).find(c => c.round === round);
        if (!entry) return fail(`critique-dismiss: no critique for round ${round} (${path.join(files.critiques, `r${round}.json`)})`, 2);
        if (!entry.critique) return fail(`critique-dismiss: the critique of round ${round} is not valid (${entry.file})`, 2);
        let picked: { n: number; severity: string }[];
        try { picked = selectProposals(entry.critique, spec); } catch (e) {
          if (e instanceof CritiqueError) return fail(`critique-dismiss: ${e.message}`, 2);
          throw e;
        }
        // K3-10: written in docs/, with the dismissals read from .waypoint/ carried over.
        const next = mergeDismissed(readDismissedOf(files), round, picked.map(p => p.n), reason);
        // A decided critical or major always keeps its reason (a minor may go without one).
        const bare = picked.filter(p => p.severity !== 'minor' && !(next[round] ?? []).find(x => x.n === p.n)?.reason).map(p => p.n);
        if (bare.length) return fail(`critique-dismiss: ${bare.length === 1 ? 'proposal' : 'proposals'} ${bare.join(', ')} of round ${round} ${bare.length === 1 ? 'is' : 'are'} major or critical and need a reason: pass --reason-file <f> with the person's words`, 2);
        writeDismissed(files, next);
        return ok(JSON.stringify({ round, dismissed: (next[round] ?? []).map(x => x.n) }));
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
        // K3-04: the budget of this round (the critique's own round without --round), or of a verification.
        const roundGiven = flag('round');
        const designFlag = flag('design');
        const designParsed = designFlag !== undefined ? parseDesign(readFileSync(abs(designFlag), 'utf8')) : null;
        // With --design the round counts from the design's last reopen, as critique-next gave it (ruling C1). A changelog
        // that does not parse leaves no budget to apply: exit 2, the critique is not judged (carry 6).
        const absolute = roundGiven !== undefined ? Number(roundGiven) : c.round;
        let budgetAt = absolute;
        if (designFlag !== undefined && designParsed) {
          let log: ReturnType<typeof readChangelog>;
          try { log = readChangelog(designFilesOf(abs(designFlag), designParsed.meta.project).dir); }
          catch (e) { return fail(`critique-check: cannot read the changelog of the design: ${(e as Error).message}`, 2); }
          budgetAt = budgetRound(log, absolute);
        }
        issues.push(...budgetIssues(c, budgetFor(budgetAt, args.includes('--verify'))));
        const headings: Record<string, string> = {};
        if (designParsed) {
          const sections = designParsed.sections;
          for (const s of sections) headings[s.slug] = s.heading;
          const slugs = new Set(['_intro', ...sections.map(s => s.slug)]);
          for (const p of c.proposals) if (!slugs.has(p.section)) issues.push(`proposal ${p.n}: section "${p.section}" is not a section slug of the design`);
        }
        if (issues.length) throw new CritiqueError(issues);
        // K3-15: a critique of what changed that reviews another section is told, never refused.
        const warnings: string[] = [];
        const changedFlag = flag('changed');
        if (changedFlag !== undefined && c.scope === 'changed') {
          const allowed = changedFlag.split(',').map(s => s.trim()).filter(Boolean);
          for (const p of c.proposals) {
            if (!allowed.includes(p.section)) warnings.push(`warning: proposal ${p.n} reviews "${p.section}", outside the changed sections (${allowed.join(', ')})`);
          }
        }
        const text = formatProposals(c, flag('locale') ?? 'en', headings);
        return { code: 0, stdout: text.endsWith('\n') ? text : `${text}\n`, stderr: warnings.length ? `${warnings.join('\n')}\n` : '' };
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
        const history = readHistory(dirPath);
        const current = readFileSync(file, 'utf8');
        const project = parseDesign(current).meta.project;
        let source = `docs/waypoint/${project}/`;
        try {
          const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          const rel = path.relative(path.resolve(root), dirPath).split(path.sep).join('/');
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) source = rel ? `${rel}/` : '';
        } catch { /* not a git repo: keep the docs/waypoint/<project>/ fallback */ }
        // K3-09, K3-10: the rounds the page tells, from the critiques and dismissed.json next to the design (or in .waypoint/).
        const files = designFilesOf(file, project);
        const data = buildDesignPageData({ current, history, changelog: readChangelog(dirPath), source, critiques: readCritiques(files), dismissed: readDismissedOf(files) });
        const tpl = readFileSync(path.join(io.assetsDir, 'design.template.html'), 'utf8');
        const title = `${data.meta.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} · Design`;
        // `<` (a closing tag, a comment) and the line separators U+2028/U+2029 are written as escapes.
        const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
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

// Reasons that only fill the field (EN and ES), compared after reasonKey.
const PLACEHOLDER_REASONS = new Set([
  'dismissed', 'dismissed at approval', 'dismissed on approval', 'dismissed when approving', 'no reason', 'no reason given', 'none', 'n a', 'na', 'tbd', 'todo', 'ok', 'wontfix',
  'descartada', 'descartado', 'descartada al aprobar', 'descartado al aprobar', 'descartada en la aprobacion', 'descartado en la aprobacion',
  'sin motivo', 'sin razon', 'ninguno', 'ninguna', 'no aplica',
]);
/** Lower case, accents dropped, every run of other characters a single space. */
function reasonKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

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

/** commit-info: a commit's sha, committer date, title and line counts. */
function commitInfo(cwd: string, rev: string): Commit {
  const git = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  const [sha, ts, ...title] = git('log', '-1', '--format=%H%x09%cI%x09%s', rev).trim().split('\t');
  const stat = git('show', '--shortstat', '--format=', rev);
  const num = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0);
  return { sha, ts: new Date(ts).toISOString(), title: title.join('\t'), add: num(/(\d+) insertion/), del: num(/(\d+) deletion/) };
}

/** A state write applied to the local cache (`<db>/state/<T>.json`): its fields set, `{__delete__: true}` ones removed. */
function mirrorState(db: string, write: Write): void {
  if (write.collection !== 'state' || !write.data || !isPlanId(write.doc_id)) return;
  const file = path.join(db, 'state', `${write.doc_id}.json`);
  let cur: Record<string, unknown> = {};
  try { const v: unknown = JSON.parse(readFileSync(file, 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) cur = v as Record<string, unknown>; } catch { cur = {}; }
  for (const [k, v] of Object.entries(write.data)) {
    if (v && typeof v === 'object' && (v as { __delete__?: unknown }).__delete__ === true) delete cur[k];
    else cur[k] = v;
  }
  writeAtomic(file, JSON.stringify(cur));
}

/** A-14: another checkout uses `sid`: its sessions document has a live lease, another Claude id and another worktree. */
function heldElsewhere(doc: SessionDoc | undefined, now: number, claude: string | null, worktree: string): boolean {
  return !!doc && !isIdle(doc, now) && (claude === null || doc.claude !== claude) && !(typeof doc.worktree === 'string' && samePath(doc.worktree, worktree));
}

/** The first `<sid>-N` (N ≥ 2) no other checkout holds. */
function freeSid(sid: string, sessions: Record<string, SessionDoc>, now: number, claude: string | null, worktree: string): string {
  for (let n = 2; n < 100; n++) if (!heldElsewhere(sessions[`${sid}-${n}`], now, claude, worktree)) return `${sid}-${n}`;
  return `${sid}-100`;
}

/** The project a plan names (or a design's folder), its plan path relative to cwd (a design without a plan has none)
 *  and its roadmap. Null when a design's folder is not a valid project id; a plan or design that does not read throws. */
function projectOf(file: string, cwd: string): { project: string; plan: string | null; url: string | null } | null {
  const rel = (p: string) => path.relative(cwd, p).split(path.sep).join('/');
  if (path.basename(file) === 'design.md') {
    parseDesign(readFileSync(file, 'utf8'));
    const project = path.basename(path.dirname(file));
    if (!isPlanId(project)) return null;
    const planFile = path.join(path.dirname(file), 'plan.yaml');
    if (!existsSync(planFile)) return { project, plan: null, url: null };
    let url: string | null = null;
    try { url = parsePlan(readFileSync(planFile, 'utf8')).artifacts.roadmap ?? null; } catch { url = null; }
    return { project, plan: rel(planFile), url };
  }
  const p = parsePlan(readFileSync(file, 'utf8'));
  return { project: p.project, plan: rel(file), url: p.artifacts.roadmap ?? null };
}

function readDocs<T = unknown>(dir: string | undefined): Record<string, T> {
  if (!dir || !existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => [f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T]),
  );
}

/** G-14: the states a `state` listing holds (id → status) and when its newest valid file was written; null with none. */
function statesOf(dir: string, taskIds: readonly string[]): { states: Record<string, TaskStatus>; at: string } | null {
  if (!existsSync(dir)) return null;
  const states: Record<string, TaskStatus> = {};
  let newest = 0;
  // Carry 9: only the plan's tasks, one file each (so the snapshot never grows past the plan), and a state counts only
  // once its file's time is read.
  for (const id of [...new Set(taskIds)].filter(isPlanId).sort()) {
    const file = path.join(dir, `${id}.json`);
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as { status?: unknown } | null;
      if (!doc || typeof doc.status !== 'string' || !(TASK_STATUSES as readonly string[]).includes(doc.status)) continue;
      const mtime = statSync(file).mtimeMs;
      states[id] = doc.status as TaskStatus;
      newest = Math.max(newest, mtime);
    } catch { /* a missing or broken file is left out */ }
  }
  return Object.keys(states).length ? { states, at: new Date(newest).toISOString() } : null;
}

/** G-26: the roadmap lists at most this many documents per call, with no cursor. */
const LIST_LIMIT = 1000;
const jsonFiles = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : []);

// forge uploads its verification screenshots to the roadmap (the `assets` capability) when the repository has a .forge/
// directory and its config does not say `evidence: local`. An unreadable config counts as forge's default, upload.
function evidenceUploaded(root: string): boolean {
  if (!existsSync(path.join(root, '.forge'))) return false;
  try { return loadConfig(root).evidence !== 'local'; } catch { return true; }
}

function readChangelog(designDir: string) {
  const f = path.join(designDir, 'design', 'changelog.json');
  return parseChangelog(existsSync(f) ? readFileSync(f, 'utf8') : null);
}
