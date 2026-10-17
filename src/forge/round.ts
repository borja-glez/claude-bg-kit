import type { LedgerEvent } from './ledger.js';
import { agentFor, type Profile } from './config.js';
import { implementerFor, ZONE_ORDER, type ImplRole, type Zone } from './triage.js';
import { decideRound, nextImplementer, IMPL_LADDER } from './loop.js';
import { baseOf, eventsOf, isTask } from './task-ref.js';
import { eventsSince } from './execution.js';
import type { Action } from './verdict.js';

// The round decision FORGE round and FORGE review-close share. It lives here so that cli/review.ts does not
// import cli/run.ts (run.ts dispatches to review.ts).

/**
 * `FORGE round` for a task `<T>-<n>` of `project` from the ledger: the decision on its verdicts (the last verdict per
 * review dir counts once) and who implements the attempt it starts, resolved with the profile. Only the events of `<T>`
 * of that project count (D-08: ids repeat between plans). The previous implementer is the last `agent` event of the task
 * whose role is on the ladder (that brief first, then any brief of `<T>`); with none, the role `implementerFor` gives a
 * plan task of this path and the zones of the task's last triage. Carry 3: with `since` (the start of the execution that
 * holds the task, executionHolding), only the verdicts logged from then count: an earlier run's neither use up the cap
 * nor make a stall.
 */
export function roundDecision(events: LedgerEvent[], task: string, p: 'medium' | 'large', profile: Profile, project: string | null, since: string | null = null) {
  const mine = eventsOf(events, { project, task: baseOf(task) });
  const verdicts = eventsSince(mine, since).filter(e => e.kind === 'verdict' && isTask(e, task) && (e.action === 'accept' || e.action === 'fix' || e.action === 'redo'));
  // Only the last verdict per review dir counts: re-running a verdict (e.g. when resuming) is not a new round.
  const lastPerDir = new Map<string, number>();
  verdicts.forEach((e, i) => { if (typeof e.dir === 'string') lastPerDir.set(e.dir, i); });
  const history = verdicts
    .filter((e, i) => typeof e.dir !== 'string' || lastPerDir.get(e.dir) === i)
    .map(e => ({ action: e.action as Action, score: typeof e.score === 'number' ? e.score : null, signature: String(e.signature ?? ''), ...(e.held === true ? { held: true } : {}) }));
  const d = decideRound(history, p);
  const ladder = mine.filter(e => e.kind === 'agent' && (IMPL_LADDER as readonly unknown[]).includes(e.role));
  const logged = (ladder.filter(e => isTask(e, task)).at(-1) ?? ladder.at(-1))?.role as ImplRole | undefined;
  const triaged = mine.filter(e => e.kind === 'triage').at(-1);
  const sensitive = Array.isArray(triaged?.sensitive) ? (triaged!.sensitive as unknown[]).filter((z): z is Zone => (ZONE_ORDER as unknown[]).includes(z)) : [];
  const current = logged ?? implementerFor({ path: p, sensitive }, '', { plan: true }).role ?? 'impl';
  const role = nextImplementer(d, current);
  return { ...d, implementer: role ? { role, agent: agentFor(role, profile) } : null };
}
