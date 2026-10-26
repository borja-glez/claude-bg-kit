// FX1: an implementer the coordinator starts that is not the one forge named for the task in progress. forge records it
// (a `deviation` event in the ledger) and says it, and never blocks it: the coordinator may have a reason, and the person
// reads it in the step, the review and the closing report.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, ledgerRoot, readEvents, type LedgerEvent } from './ledger.js';
import { readExecution, withFileLock, writeAtomic } from './execution.js';
import { liveFile } from './live.js';
import { hookRoot, mainCheckout } from './local.js';
import { memberForHook } from './members.js';
import { eventsOf, idChain, isTask, type TaskRef } from './task-ref.js';
import { isSafeId, normalizeLive } from '../lib/execution-state.js';
import type { Io } from './cli/run.js';

/** The forge agents that implement: the ladder's (mech, impl-light, impl, impl-high, impl-heavy) and forge-fable. */
const IMPLEMENTER_AGENTS: readonly string[] = ['forge-mech', 'forge-impl-light', 'forge-impl', 'forge-impl-high', 'forge-impl-heavy', 'forge-fable'];
export const isImplementerAgent = (name: string): boolean => IMPLEMENTER_AGENTS.includes(name);

/** A deviation as the CLI prints it: the brief, who started, who forge named, and when. */
export interface Deviation { task: string; agent: string; expected: string; at: string }

/** The deviation events of `events` that `keep` takes, as printed; one that does not read is left out. */
export function deviationsOf(events: readonly LedgerEvent[], keep: (e: LedgerEvent) => boolean = () => true): Deviation[] {
  return events.flatMap(e => (e.kind === 'deviation' && typeof e.task === 'string' && typeof e.agent === 'string' && typeof e.expected === 'string' && keep(e)
    ? [{ task: e.task, agent: e.agent, expected: e.expected, at: e.ts }] : []));
}

/** The line the person reads (their language: es, else English); '' with none. */
export function deviationSay(list: readonly Deviation[], locale: string | undefined): string {
  if (!list.length) return '';
  return locale === 'es'
    ? `Desvío del triaje: ${list.map(d => `en ${d.task} arrancó ${d.agent} donde forge nombró ${d.expected}`).join('; ')}.`
    : `Deviation from the triage: ${list.map(d => `${d.task} started ${d.agent} where forge named ${d.expected}`).join('; ')}.`;
}

/** Appends the line to `out.say` (or makes it) and lists them in `out.deviations`; nothing with none. */
export function tellDeviations(out: Record<string, unknown>, list: readonly Deviation[], locale: string | undefined): void {
  if (!list.length) return;
  const line = deviationSay(list, locale);
  out.deviations = list;
  out.say = typeof out.say === 'string' && out.say ? `${out.say} ${line}` : line;
}

/** A fresh CLI triage of exactly `id`: it carries `reasons`, and a triage of the real diff (--base) carries `diff`. */
const freshTriage = (e: LedgerEvent, id: string): boolean => e.kind === 'triage' && e.task === id && Array.isArray(e.reasons) && e.diff === undefined;

/** The events of task `id` from its last CLI triage on: this run of it (a fresh triage starts a new one; m3: the triage
 *  of the real diff that sizes it again after its implementation does not). */
export function sinceLastTriage(events: readonly LedgerEvent[], id: string): LedgerEvent[] {
  const at = events.map(e => freshTriage(e, id)).lastIndexOf(true);
  return at < 0 ? [...events] : events.slice(at);
}

/** A fix round's next that hands the brief to an implementer (review-close's `implementer`). */
export const FIX_NEXT: readonly unknown[] = ['resume', 'fresh-stronger', 'redo'];

/** Who writes an `agent` event that is forge naming an implementer: swarm step's hand-out, and `agents --role --task`. */
const NAMED_BY: readonly unknown[] = ['step', 'agents'];

/** m5: the key a deviation is told by. */
const keyOf = (d: Deviation) => `${d.task}|${d.at}|${d.agent}`;
const TOLD_MAX = 500;
const toldFile = (root: string) => path.join(root, '.forge', 'deviations-told.json');

/**
 * m5: the deviations of `list` that `teller` has not said yet, recorded as said (.forge/deviations-told.json, the newest
 * TOLD_MAX per teller). A file that does not read or write says them all again rather than never.
 */
export function untold(root: string, teller: string, list: readonly Deviation[]): Deviation[] {
  if (!list.length) return [];
  let doc: Record<string, unknown> = {};
  try {
    const o: unknown = JSON.parse(readFileSync(toldFile(root), 'utf8'));
    if (o && typeof o === 'object' && !Array.isArray(o)) doc = o as Record<string, unknown>;
  } catch { /* none yet */ }
  const said = Array.isArray(doc[teller]) ? (doc[teller] as unknown[]).filter((k): k is string => typeof k === 'string') : [];
  const fresh = list.filter(d => !said.includes(keyOf(d)));
  if (!fresh.length) return [];
  try { writeAtomic(toldFile(root), JSON.stringify({ ...doc, [teller]: [...said, ...fresh.map(keyOf)].slice(-TOLD_MAX) }) + '\n'); } catch { /* said again next time */ }
  return fresh;
}

/** Who forge named to implement a brief, and when. */
export interface Expected { brief: string; agent: string; ts: string }

/**
 * Who forge named last to implement brief `n` of task `ref` (a plan or loose task, not a brief id): the last hand-out for
 * that brief, an `agent` event forge wrote (`by: "step"`: swarm step; `by: "agents"`: `agents --role --task`, the fresh
 * impl of an ephemeral Trivial or Small task) or review-close's (a `round` event whose next goes back to an implementer);
 * else the implementer of the last CLI triage without a diff of the task, or, for a task that has none, of the task it
 * belongs to, nearest first (idChain, as review-prep reads it: a Medium brief run as the loose task `<id>-<k>` has the
 * Medium task's). A triage carries `reasons` and `implementer`; a raise the session logs carries neither, and the triage
 * run again after it names the raised one. A hand-out wins over any triage: in an execution the step triages and hands
 * out, and a triage the coordinator runs again by hand does not change who the step named (A10). An `agent` event the
 * session logs by hand is what it spawned, never what forge named. Null when forge named no implementer.
 */
export function expectedImplementer(events: readonly LedgerEvent[], ref: TaskRef, n: number): Expected | null {
  const mine = eventsOf(events, ref);
  const brief = `${ref.task}-${n}`;
  for (let i = mine.length - 1; i >= 0; i--) {
    const e = mine[i];
    if (!isTask(e, brief)) continue;
    if (e.kind === 'agent' && NAMED_BY.includes(e.by) && typeof e.agent === 'string' && e.agent) return { brief, agent: e.agent, ts: e.ts };
    const impl = e.implementer as { agent?: unknown } | null | undefined;
    if (e.kind === 'round' && FIX_NEXT.includes(e.next) && typeof impl?.agent === 'string' && impl.agent) return { brief, agent: impl.agent, ts: e.ts };
  }
  for (const id of idChain(ref.task)) {
    const triage = eventsOf(events, { project: ref.project, task: id }).filter(e => freshTriage(e, id)).at(-1);
    if (!triage) continue;
    return typeof triage.implementer === 'string' && triage.implementer ? { brief, agent: triage.implementer, ts: triage.ts } : null;
  }
  return null;
}

/** The brief a task is implementing: that of its last phase event, when that phase is `implement` or `fix`; else null. */
function implementingBrief(events: readonly LedgerEvent[], ref: TaskRef): number | null {
  const last = eventsOf(events, ref).filter(e => e.kind === 'phase' && isTask(e, ref.task)).at(-1);
  if (!last || (last.phase !== 'implement' && last.phase !== 'fix')) return null;
  return typeof last.brief === 'number' && Number.isInteger(last.brief) && last.brief >= 1 ? last.brief : 1;
}

/** A brief in progress and who forge named for it. */
interface Candidate { ref: TaskRef; expected: Expected }

/**
 * The briefs in progress for the session that starts an agent, the ledger they are read from and the session's live
 * signal (m2: the agents it has running; null outside an execution). The coordinator of the active execution: its tasks
 * at stage implement, oldest stage first. A registered member of it: its task. Any other session: the brief of the last
 * phase event this session logged in the ledger of its checkout (`root`), while that phase is implement or fix.
 */
function candidatesFor(root: string, main: string, sessionId: string): { ledger: string; candidates: Candidate[]; live: string | null } {
  const exec = readExecution(main);
  const of = (ledger: string, events: readonly LedgerEvent[], refs: TaskRef[], live: string | null) => ({
    ledger, live,
    candidates: refs.flatMap(ref => {
      const n = implementingBrief(events, ref) ?? 1;
      const expected = expectedImplementer(events, ref, n);
      return expected ? [{ ref, expected }] : [];
    }),
  });
  if (exec?.active) {
    const project = exec.kind === 'plan' ? exec.project : null;
    const member = exec.hookSession === sessionId ? null : memberForHook(main, sessionId, exec.runId);
    if (exec.hookSession === sessionId || member) {
      const tasks = member ? (member.task ? [member.task] : []) : Object.entries(exec.tasks)
        .filter(([, t]) => t.status === 'running' && t.stage === 'implement')
        .sort(([, a], [, b]) => Date.parse(a.stageSince) - Date.parse(b.stageSince)).map(([id]) => id);
      // The signal hook live keeps: the coordinator's by its hook id, a member's by its waypoint SID.
      return of(main, readEvents(main), tasks.map(task => ({ project, task })), liveFile(main, member ? member.sessionId : sessionId));
    }
  }
  const events = readEvents(root);
  const last = events.filter(e => e.kind === 'phase' && e.session === sessionId && typeof e.task === 'string').at(-1);
  if (!last) return { ledger: root, candidates: [], live: null };
  const project = isSafeId(last.project) ? last.project : null;
  const ref = { project, task: last.task as string };
  return implementingBrief(events, ref) === null ? { ledger: root, candidates: [], live: null } : of(root, events, [ref], null);
}

/** m2: the ids of the agents of type `forge:<agent>` the live signal lists as running (hook live wrote this one first). */
function runningOf(live: string | null, agent: string): string[] {
  if (!live) return [];
  try {
    const doc = normalizeLive(JSON.parse(readFileSync(live, 'utf8')));
    return (doc?.agents ?? []).filter(a => a.type === `forge:${agent}`).map(a => a.id);
  } catch { return []; }
}

/** m1: the lock of the deviation check of a ledger: one read, one pick and one append at a time. */
export const deviationLock = (ledger: string) => path.join(ledger, '.forge', 'deviation.lock');
/** How long the hook waits for that lock before it checks without it (fail-open, as live.ts's signal), and when a lock
 *  left behind is taken over. */
const DEVIATION_LOCK_WAIT_MS = 2000;
const DEVIATION_LOCK_STALE_MS = 5000;

/**
 * Under the ledger's deviation lock: whether `agent` (`agentId`) is a deviation for the briefs in progress, and if so its
 * event. It is when it is none of theirs, or (m2) when more agents of its type are running than forge named of it for
 * them, those already recorded as deviations and still running aside (a pure swap between two briefs whose implementers
 * differ stays unseen: the hook has no prompt). Once per agent. It goes to the first brief without a deviation since forge
 * named its implementer, one named another implementer first (`candidates` lists them all).
 */
function checkAndRecord(io: Io, root: string, main: string, sessionId: string, agent: string, agentId: string | null): void {
  const { ledger, candidates, live } = candidatesFor(root, main, sessionId);
  if (!candidates.length) return;
  const logged = readEvents(ledger).filter(e => e.kind === 'deviation');
  if (agentId && logged.some(e => e.agentId === agentId)) return;
  const named = candidates.filter(c => c.expected.agent === agent).length;
  if (named > 0) {
    const running = new Set([...runningOf(live, agent), ...(agentId ? [agentId] : [])]);
    const flagged = logged.filter(e => e.agent === agent && typeof e.agentId === 'string' && e.agentId !== agentId && running.has(e.agentId)).length;
    if (running.size - flagged <= named) return;
  }
  const open = (c: Candidate) => !logged.some(e => isTask(e, c.expected.brief) && Date.parse(e.ts) >= Date.parse(c.expected.ts));
  const chosen = candidates.find(c => open(c) && c.expected.agent !== agent) ?? candidates.find(open) ?? candidates[0];
  appendEvent(ledger, {
    ts: io.now().toISOString(), kind: 'deviation', task: chosen.expected.brief, agent, expected: chosen.expected.agent,
    ...(agentId ? { agentId } : {}), session: sessionId, ...(chosen.ref.project ? { project: chosen.ref.project } : {}),
    ...(candidates.length > 1 ? { candidates: candidates.map(c => c.expected.brief) } : {}),
  });
}

/**
 * The SubagentStart side of `forge hook live`: a forge implementer (`forge:<agent>`) that is not the one forge named for
 * the brief in progress is a `deviation` event (checkAndRecord). m1: the read, the pick and the append go under the
 * ledger's deviation lock, so several starts at once each go to a brief of their own; a lock held longer than
 * DEVIATION_LOCK_WAIT_MS is left and the check runs without it. Never throws and prints nothing: a hook must not fail on it.
 */
export function hookDeviation(io: Io): void {
  try {
    const input = JSON.parse(io.stdin ?? '') as { session_id?: unknown; hook_event_name?: unknown; agent_id?: unknown; agent_type?: unknown; cwd?: unknown };
    if (input.hook_event_name !== 'SubagentStart' || typeof input.agent_type !== 'string' || !input.agent_type.startsWith('forge:')) return;
    const agent = input.agent_type.slice('forge:'.length);
    const sessionId = input.session_id;
    const agentId = typeof input.agent_id === 'string' && isSafeId(input.agent_id) ? input.agent_id : null;
    if (!isImplementerAgent(agent) || !isSafeId(sessionId)) return;
    const root = hookRoot(io, input);
    const main = mainCheckout(root);
    const run = () => checkAndRecord(io, root, main, sessionId, agent, agentId);
    // One lock per main checkout, where an execution's ledger is; a checkout whose .forge does not exist has nothing to
    // check (forge logged nothing there), and the session's own checkout's is the attended ledger.
    const lockAt = (dir: string) => (existsSync(path.join(dir, '.forge')) ? deviationLock(dir) : null);
    const lock = lockAt(main) ?? lockAt(ledgerRoot(root));
    if (!lock) return;
    let ran = false;
    try {
      withFileLock(lock, () => { ran = true; run(); }, { waitMs: DEVIATION_LOCK_WAIT_MS, staleMs: DEVIATION_LOCK_STALE_MS });
    } catch (e) { if (ran) throw e; }
    if (!ran) run();
  } catch { /* fail-open: the agent runs, the deviation is not recorded */ }
}
