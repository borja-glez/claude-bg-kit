// 6b-3 Task 1: the replan history of plan.yaml as every reader takes it (parsePlan and planLite alike), and the clip that
// waypoint replan writes it with. T6B3-HISTORY-LENIENT: the history is a record, never a reason to refuse a plan. Pure, with
// no zod and no Node imports: the band's mod bundles it through planLite.
import { clean } from './decisions.js';
import { PLAN_HISTORY_MAX, type PlanHistoryEntry } from './types.js';

/** M-1: `clean` (one line, no control or bidi characters), then clipped by whole characters to `max` UTF-16 units, so a
 *  clipped text is never longer than `max` however it is counted. */
export function fitText(s: string, max: number): string {
  const t = clean(s, max);
  if (t.length <= max) return t;
  let out = '';
  for (const ch of t) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * The history of a plan from its raw YAML value, or undefined when it is no list. An entry counts when its `at` and `why` are
 * texts and its `changes` a list, of which only the texts are kept; any other entry is left out. Texts are clipped to the
 * caps of PLAN_HISTORY_MAX and only the last PLAN_HISTORY_MAX.entries entries are kept, so a hand-edited history reads.
 */
export function historyOf(x: unknown): PlanHistoryEntry[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: PlanHistoryEntry[] = [];
  for (const e of x) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const { at, why, changes } = e as Record<string, unknown>;
    if (typeof at !== 'string' || typeof why !== 'string' || !Array.isArray(changes)) continue;
    const lines = changes.filter((c): c is string => typeof c === 'string').slice(0, PLAN_HISTORY_MAX.changes);
    out.push({ at, why: fitText(why, PLAN_HISTORY_MAX.why), changes: lines.map(c => fitText(c, PLAN_HISTORY_MAX.change)) });
  }
  return out.slice(-PLAN_HISTORY_MAX.entries);
}
