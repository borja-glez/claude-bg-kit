// FX1: an implementer the coordinator starts that is not the one forge named for the task in progress. forge records it
// (a `deviation` event in the ledger) and says it, and never blocks it: the coordinator may have a reason, and the person
// reads it in the step, the review and the closing report.
import { appendEvent, readEvents, type LedgerEvent } from './ledger.js';
import { readExecution } from './execution.js';
import { hookRoot, mainCheckout } from './local.js';
import { memberForHook } from './members.js';
import { eventsOf, isTask, type TaskRef } from './task-ref.js';
import { isSafeId } from '../lib/execution-state.js';
import type { Io } from './cli/run.js';

/** The forge agents that implement: the ladder's (mech, impl-light, impl, impl-high, impl-heavy) and forge-fable. */
const IMPLEMENTER_AGENTS: readonly string[] = ['forge-mech', 'forge-impl-light', 'forge-impl', 'forge-impl-high', 'forge-impl-heavy', 'forge-fable'];
export const isImplementerAgent = (name: string): boolean => IMPLEMENTER_AGENTS.includes(name);

/** A fix round's next that hands the brief to an implementer (review-close's `implementer`). */
const FIX_NEXT: readonly unknown[] = ['resume', 'fresh-stronger', 'redo'];

/** Who forge named to implement a brief, and when. */
export interface Expected { brief: string; agent: string; ts: string }

/**
 * Who forge named last to implement brief `n` of task `ref` (a plan or loose task, not a brief id): the last hand-out of
 * swarm step for that brief (an `agent` event it wrote, `by: "step"`) or of review-close (a `round` event whose next goes
 * back to an implementer), else the implementer of the task's last CLI triage without a diff (it carries `reasons` and
 * `implementer`; a raise the session logs carries neither, and the triage run again after it names the raised one). A
 * hand-out wins over any triage: in an execution the step triages and hands out, and a triage the coordinator runs again
 * by hand does not change who the step named (A10). An `agent` event the session logs by hand is what it spawned, never
 * what forge named. Null when forge named no implementer.
 */
export function expectedImplementer(events: readonly LedgerEvent[], ref: TaskRef, n: number): Expected | null {
  const mine = eventsOf(events, ref);
  const brief = `${ref.task}-${n}`;
  for (let i = mine.length - 1; i >= 0; i--) {
    const e = mine[i];
    if (!isTask(e, brief)) continue;
    if (e.kind === 'agent' && e.by === 'step' && typeof e.agent === 'string' && e.agent) return { brief, agent: e.agent, ts: e.ts };
    const impl = e.implementer as { agent?: unknown } | null | undefined;
    if (e.kind === 'round' && FIX_NEXT.includes(e.next) && typeof impl?.agent === 'string' && impl.agent) return { brief, agent: impl.agent, ts: e.ts };
  }
  const triage = mine.filter(e => e.kind === 'triage' && isTask(e, ref.task) && Array.isArray(e.reasons) && e.diff === undefined).at(-1);
  return triage && typeof triage.implementer === 'string' && triage.implementer ? { brief, agent: triage.implementer, ts: triage.ts } : null;
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
 * The briefs in progress for the session that starts an agent. The coordinator of the active execution: its tasks at stage
 * implement, oldest stage first. A registered member of it: its task. Any other session: the brief of the last phase
 * event this session logged in the ledger of its checkout (`root`), while that phase is implement or fix.
 */
function candidatesFor(root: string, sessionId: string): { ledger: string; candidates: Candidate[] } {
  const main = mainCheckout(root);
  const exec = readExecution(main);
  const of = (ledger: string, events: readonly LedgerEvent[], refs: TaskRef[]) => ({
    ledger,
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
      return of(main, readEvents(main), tasks.map(task => ({ project, task })));
    }
  }
  const events = readEvents(root);
  const last = events.filter(e => e.kind === 'phase' && e.session === sessionId && typeof e.task === 'string').at(-1);
  if (!last) return { ledger: root, candidates: [] };
  const project = isSafeId(last.project) ? last.project : null;
  const ref = { project, task: last.task as string };
  return implementingBrief(events, ref) === null ? { ledger: root, candidates: [] } : of(root, events, [ref]);
}

/**
 * The SubagentStart side of `forge hook live`: a forge implementer (`forge:<agent>`) that is not the one forge named for
 * the brief in progress is a `deviation` event, once per agent. With several briefs in progress (an execution) it is a
 * deviation only when it is none of theirs, and it goes to the first of them without one since forge named its
 * implementer (`candidates` lists them all). Never throws and prints nothing: a hook must not fail on it.
 */
export function hookDeviation(io: Io): void {
  try {
    const input = JSON.parse(io.stdin ?? '') as { session_id?: unknown; hook_event_name?: unknown; agent_id?: unknown; agent_type?: unknown; cwd?: unknown };
    if (input.hook_event_name !== 'SubagentStart' || typeof input.agent_type !== 'string' || !input.agent_type.startsWith('forge:')) return;
    const agent = input.agent_type.slice('forge:'.length);
    const sessionId = input.session_id;
    const agentId = typeof input.agent_id === 'string' && isSafeId(input.agent_id) ? input.agent_id : null;
    if (!isImplementerAgent(agent) || !isSafeId(sessionId)) return;
    const { ledger, candidates } = candidatesFor(hookRoot(io, input), sessionId);
    if (!candidates.length || candidates.some(c => c.expected.agent === agent)) return;
    const logged = readEvents(ledger).filter(e => e.kind === 'deviation');
    if (agentId && logged.some(e => e.agentId === agentId)) return;
    const open = candidates.find(c => !logged.some(e => isTask(e, c.expected.brief) && Date.parse(e.ts) >= Date.parse(c.expected.ts)));
    const chosen = open ?? candidates[0];
    appendEvent(ledger, {
      ts: io.now().toISOString(), kind: 'deviation', task: chosen.expected.brief, agent, expected: chosen.expected.agent,
      ...(agentId ? { agentId } : {}), session: sessionId, ...(chosen.ref.project ? { project: chosen.ref.project } : {}),
      ...(candidates.length > 1 ? { candidates: candidates.map(c => c.expected.brief) } : {}),
    });
  } catch { /* fail-open: the agent runs, the deviation is not recorded */ }
}
