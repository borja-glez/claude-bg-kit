import type { LedgerEvent } from './ledger.js';
import { agentFor, type Profile } from './config.js';
import { implementerFor, ZONE_ORDER, type ImplRole, type Zone } from './triage.js';
import { decideRound, nextImplementer, IMPL_LADDER } from './loop.js';
import type { Action } from './verdict.js';

// The round decision FORGE round and FORGE review-close share. It lives here so that cli/review.ts does not
// import cli/run.ts (run.ts dispatches to review.ts).

/**
 * `FORGE round` for a task `<T>-<n>` from the ledger: the decision on its verdicts (the last verdict per review dir
 * counts once) and who implements the attempt it starts, resolved with the profile. The previous implementer is the
 * last `agent` event of the task whose role is on the ladder (that brief first, then any brief of `<T>`); with none,
 * the role `implementerFor` gives a plan task of this path and the zones of the task's last triage.
 */
export function roundDecision(events: LedgerEvent[], task: string, p: 'medium' | 'large', profile: Profile) {
  const verdicts = events.filter(e => e.kind === 'verdict' && e.task === task && (e.action === 'accept' || e.action === 'fix' || e.action === 'redo'));
  // Only the last verdict per review dir counts: re-running a verdict (e.g. when resuming) is not a new round.
  const lastPerDir = new Map<string, number>();
  verdicts.forEach((e, i) => { if (typeof e.dir === 'string') lastPerDir.set(e.dir, i); });
  const history = verdicts
    .filter((e, i) => typeof e.dir !== 'string' || lastPerDir.get(e.dir) === i)
    .map(e => ({ action: e.action as Action, score: typeof e.score === 'number' ? e.score : null, signature: String(e.signature ?? ''), ...(e.held === true ? { held: true } : {}) }));
  const d = decideRound(history, p);
  const base = task.replace(/-\d+$/, '');
  const ofTask = (e: LedgerEvent) => typeof e.task === 'string' && (e.task === base || (e.task.startsWith(`${base}-`) && /^\d+$/.test(e.task.slice(base.length + 1))));
  const ladder = events.filter(e => e.kind === 'agent' && ofTask(e) && (IMPL_LADDER as readonly unknown[]).includes(e.role));
  const logged = (ladder.filter(e => e.task === task).at(-1) ?? ladder.at(-1))?.role as ImplRole | undefined;
  const triaged = events.filter(e => e.kind === 'triage' && ofTask(e)).at(-1);
  const sensitive = Array.isArray(triaged?.sensitive) ? (triaged!.sensitive as unknown[]).filter((z): z is Zone => (ZONE_ORDER as unknown[]).includes(z)) : [];
  const current = logged ?? implementerFor({ path: p, sensitive }, '', { plan: true }).role ?? 'impl';
  const role = nextImplementer(d, current);
  return { ...d, implementer: role ? { role, agent: agentFor(role, profile) } : null };
}
