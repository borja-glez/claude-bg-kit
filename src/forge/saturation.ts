// 6b-3, spec «Parada por saturación» (both profiles): an autonomous run stops as `saturated` when SATURATION_ROUNDS
// exploration rounds in a row pass nothing and nothing is left to do: no pending task, green validators, no open finding,
// defect or proposal. What waits for the person never keeps it going: the report lists it apart. `FORGE cycle --explore`
// counts the rounds from the ledger and stores the report (cli/commands/cycle.ts); stopReason reads it (run.ts).
import { readFileSync } from 'node:fs';
import { readEvents, type LedgerEvent } from './ledger.js';
import { samePath } from '../lib/worktree.js';
import { clean } from '../lib/decisions.js';
import { isActionable, type ProposalDoc } from '../lib/proposals.js';
import {
  SATURATION_LIST_MAX, SATURATION_LISTS, type SaturationBlocking, type SaturationInput, type SaturationList, type SaturationReport,
} from '../lib/forge-run.js';
import type { ForgeDocV2 } from '../lib/roadmap-doc.js';
import type { NoteDoc, PlanView, TaskState } from '../lib/types.js';
import type { ValidatorResult } from './validators.js';

/** The exploration rounds in a row that must pass nothing (the spec's N, which starts at 3). */
export const SATURATION_ROUNDS = 3;
const NO_OUTPUT = '(no validate output)';
const NO_VALIDATORS = '(no validators)';
const NAME_MAX = 80;
/** Built from its code point, so this file holds none. */
const BOM = String.fromCharCode(0xfeff);

/** What saturationOf reads. `toJudge` (H-2): pendingForJudge of the run's proposals. `waitsOwner` and `unowned` (L-18): the
 *  proposals that wait for the owner's mark (waitingForOwner) and the approvals without it (unownedReasons). */
export interface SaturationFacts {
  dry: number; at: string; plan: PlanView; states: Record<string, TaskState>; validators: ValidatorResult[] | null;
  proposals: (ProposalDoc & { id: string })[]; notes: NoteDoc[]; blocked: number;
  toJudge?: string[]; waitsOwner?: string[]; unowned?: string[];
}

interface Parts {
  at: string; rounds: number; blocking: SaturationBlocking[]; openFindings: number; questions: number; blocked: number; deferred: number;
  lists: Record<SaturationList, string[]>; missing?: SaturationInput[];
}

/** The report of its full lists, each kept to SATURATION_LIST_MAX ids with its length in `counts` (M-10). */
function reportOf(o: Parts): SaturationReport {
  const ids = (k: SaturationList) => o.lists[k].slice(0, SATURATION_LIST_MAX);
  const counts = Object.fromEntries(SATURATION_LISTS.map(k => [k, o.lists[k].length])) as Record<SaturationList, number>;
  return {
    saturated: o.blocking.length === 0, at: o.at, rounds: o.rounds, blocking: o.blocking,
    evidence: { pendingTasks: ids('pendingTasks'), validatorsFailed: ids('validatorsFailed'), openFindings: o.openFindings, openDefects: ids('openDefects'),
      openProposals: ids('openProposals') },
    waiting: { parked: ids('parked'), questions: o.questions, blocked: o.blocked, deferred: o.deferred, waitsOwner: ids('waitsOwner'), unowned: ids('unowned') },
    counts,
    ...(o.missing ? { missing: o.missing } : {}),
  };
}

const isV2 = (f: TaskState['forge']): f is ForgeDocV2 => (f as { v?: unknown } | undefined)?.v === 2;

/**
 * Why the run is or is not saturated after `dry` rounds in a row that passed nothing, with the evidence:
 * - pendingTasks: the plan's tasks whose state is not done;
 * - validatorsFailed: the validators with ok false; no file (null) is `(no validate output)`, an empty list `(no validators)` (L-15);
 * - openFindings: for each of the plan's tasks with a forge v2 block, critical + important of its last round when that round
 *   is not an accept (a state the plan dropped holds nothing open);
 * - openDefects: the `source: verify` proposals proposed, under discussion and not parked, or approved without a task;
 * - openProposals (H-2): the proposals still to judge, and every approval of any source without its task.
 * What waits for the person is `waiting` and never blocks: parked ideas, open questions (no answer, no answering note), the
 * blocked actions (given), the deferred findings of the plan's v2 blocks, the proposals that wait for the owner's mark and
 * the approvals without it (L-18); a proposal of those two lists is no open defect or proposal.
 */
export function saturationOf(i: SaturationFacts): SaturationReport {
  const tasks = i.plan.tasks.map(t => t.id);
  const pendingTasks = tasks.filter(id => i.states[id]?.status !== 'done');
  const validatorsFailed = i.validators === null ? [NO_OUTPUT] : !i.validators.length ? [NO_VALIDATORS]
    : i.validators.filter(v => !v.ok).map(v => clean(v.validator, NAME_MAX) || '(unnamed)');
  const blocks = tasks.map(id => i.states[id]?.forge).filter(isV2);
  let openFindings = 0;
  for (const f of blocks) {
    const last = f.rounds.at(-1);
    if (last && last.action !== 'accept') openFindings += last.findings.critical + last.findings.important;
  }
  const deferred = blocks.reduce((n, f) => n + f.deferred.length, 0);
  const waitsOwner = [...new Set(i.waitsOwner ?? [])].sort();
  const unowned = [...new Set(i.unowned ?? [])].sort();
  type P = SaturationFacts['proposals'][number];
  const untasked = (p: P) => isActionable(p) && p.taskId === undefined && !unowned.includes(p.id);
  const open = (p: P) => (p.status === 'proposed' || (p.status === 'discussing' && !p.parked)) && !waitsOwner.includes(p.id);
  const openDefects = i.proposals.filter(p => p.source === 'verify' && (open(p) || untasked(p))).map(p => p.id);
  const openProposals = [...new Set([...(i.toJudge ?? []), ...i.proposals.filter(untasked).map(p => p.id)])].sort();
  const parked = i.proposals.filter(p => p.status === 'discussing' && p.parked).map(p => p.id);
  const questions = i.notes.filter(n => n.type === 'question' && !n.answer && !n.answeredByNote).length;
  const blocking: SaturationBlocking[] = [];
  if (i.dry < SATURATION_ROUNDS) blocking.push('rounds');
  if (pendingTasks.length) blocking.push('pending-tasks');
  if (validatorsFailed.length) blocking.push('validators');
  if (openFindings) blocking.push('findings');
  if (openDefects.length) blocking.push('defects');
  if (openProposals.length) blocking.push('proposals');
  return reportOf({
    at: i.at, rounds: i.dry, blocking, openFindings, questions, blocked: i.blocked, deferred,
    lists: { pendingTasks, validatorsFailed, openDefects, openProposals, parked, waitsOwner, unowned },
  });
}

/** L-10: the report of a round past the count that lacks some of its inputs: not saturated, naming them, nothing else read. */
export function missingReport(dry: number, at: string, missing: SaturationInput[]): SaturationReport {
  const lists = Object.fromEntries(SATURATION_LISTS.map(k => [k, []])) as unknown as Record<SaturationList, string[]>;
  return reportOf({ at, rounds: dry, blocking: ['inputs'], openFindings: 0, questions: 0, blocked: 0, deferred: 0, lists, missing });
}

/** The file of `cycle --validate`: the JSON `FORGE validate --all` prints, an array of results; null when it does not read (no
 *  file, not JSON, not an array, or an entry without its validator's name and a boolean ok). A leading BOM is skipped. */
export function readValidateFile(file: string): ValidatorResult[] | null {
  let x: unknown;
  try {
    const text = readFileSync(file, 'utf8');
    x = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  } catch { return null; }
  if (!Array.isArray(x)) return null;
  const reads = x.every(r => !!r && typeof r === 'object' && typeof (r as ValidatorResult).validator === 'string' && typeof (r as ValidatorResult).ok === 'boolean');
  return reads ? (x as ValidatorResult[]) : null;
}

/** H-2: an event of something that passed: a judge's approval, or a v2 added (an `add` with `revises`, the trace an adapt
 *  leaves, since judge logs nothing for one: a proposal that passes with changes). */
const passes = (e: LedgerEvent): boolean => e.kind === 'proposal'
  && ((e.action === 'judge' && e.status === 'auto_approved') || (e.action === 'add' && typeof e.revises === 'string'));

/**
 * H-2: what passed in this exploration round, as the CLI counts it: the events of `root`'s ledger (the run's proposals, its
 * worktree: proposalsRootOf) that `passes` keeps, since the run's last `cycle` event (in the ledger of `runRoot`, the
 * directory of run.json) or, before its first, since the run started. One ledger for both is read by position, two by time.
 * A round whose batch was empty passes nothing: it is dry.
 */
export function explorePassed(runRoot: string, root: string, startedAt: string): number {
  const own = readEvents(root);
  const same = samePath(runRoot, root);
  // A recorded cycle (its number), as infinitePublish reads the last one: not the `stopped` event a stop appends.
  const last = (same ? own : readEvents(runRoot)).filter(e => e.kind === 'cycle' && typeof e.cycle === 'number' && e.ts >= startedAt).at(-1);
  const since = !last ? own : same ? own.slice(own.lastIndexOf(last) + 1) : own.filter(e => e.ts > last.ts);
  return since.filter(e => e.ts >= startedAt && passes(e)).length;
}
