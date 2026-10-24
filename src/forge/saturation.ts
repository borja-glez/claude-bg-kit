// 6b-3, spec «Parada por saturación» (both profiles): an autonomous run stops as `saturated` when SATURATION_ROUNDS
// exploration rounds in a row pass nothing and nothing is left to do: no pending task, green validators, no open finding,
// defect or proposal. What waits for the person never keeps it going: the report lists it apart. `FORGE cycle --explore`
// counts the rounds from the ledger and every cycle past the count stores the report (cli/commands/cycle.ts); stopReason
// reads it (run.ts).
import { readFileSync, statSync } from 'node:fs';
import { readEvents, type LedgerEvent } from './ledger.js';
import { samePath } from '../lib/worktree.js';
import { clean } from '../lib/decisions.js';
import { isPlanId } from '../lib/ids.js';
import { isActionable, proposalDigest, type ApprovalDoc, type ProposalDoc } from '../lib/proposals.js';
import {
  SATURATION_LIST_MAX, SATURATION_LISTS, type SaturationBlocking, type SaturationInput, type SaturationList, type SaturationReport,
} from '../lib/forge-run.js';
import type { ForgeDocV2 } from '../lib/roadmap-doc.js';
import type { NoteDoc, PlanTask, PlanView, TaskState } from '../lib/types.js';
import type { ValidatorResult } from './validators.js';

/** The exploration rounds in a row that must pass nothing (the spec's N, which starts at 3). */
export const SATURATION_ROUNDS = 3;
const NO_OUTPUT = '(no validate output)';
const NO_VALIDATORS = '(no validators)';
const NAME_MAX = 80;
/** waypoint block --by external: a task blocked for the person (large triage's question). */
const EXTERNAL = 'external';
/** Built from its code point, so this file holds none. */
const BOM = String.fromCharCode(0xfeff);

/**
 * What saturationOf reads. `toJudge` (H-2) and `waitsOwner` (L-18): judgeQueue of the run's proposals; `unowned` (L-18): the
 * approvals without the owner's mark (unownedReasons); `marks` (fix 1): the owner's marks (loadApprovals); `missing` (L-10,
 * fix 1): the inputs the cycle lacked, did not read, or (the validate file) had from an earlier cycle; `explored` (fix 2):
 * false in a cycle without the scout, which never concludes saturated.
 */
export interface SaturationFacts {
  dry: number; at: string; plan: PlanView; states: Record<string, TaskState>; validators: ValidatorResult[] | null;
  proposals: (ProposalDoc & { id: string })[]; notes: NoteDoc[]; blocked: number;
  toJudge?: string[]; waitsOwner?: string[]; unowned?: string[]; marks?: Record<string, ApprovalDoc>; missing?: SaturationInput[]; explored?: boolean;
}

interface Parts {
  at: string; rounds: number; blocking: SaturationBlocking[]; openFindings: number; questions: number; blocked: number; deferred: number;
  lists: Record<SaturationList, string[]>; missing: SaturationInput[];
}

/** The report of its full lists, each kept to SATURATION_LIST_MAX ids with its length in `counts` (M-10). */
function reportOf(o: Parts): SaturationReport {
  const ids = (k: SaturationList) => o.lists[k].slice(0, SATURATION_LIST_MAX);
  const counts = Object.fromEntries(SATURATION_LISTS.map(k => [k, o.lists[k].length])) as Record<SaturationList, number>;
  return {
    saturated: o.blocking.length === 0, at: o.at, rounds: o.rounds, blocking: o.blocking,
    evidence: { pendingTasks: ids('pendingTasks'), validatorsFailed: ids('validatorsFailed'), openFindings: o.openFindings, openDefects: ids('openDefects'),
      openProposals: ids('openProposals') },
    waiting: {
      parked: ids('parked'), questions: o.questions, blocked: o.blocked, deferred: o.deferred, waitsOwner: ids('waitsOwner'), unowned: ids('unowned'),
      blockedTasks: ids('blockedTasks'), unplaced: ids('unplaced'), orphanFindings: ids('orphanFindings'),
    },
    counts,
    ...(o.missing.length ? { missing: o.missing } : {}),
  };
}

const isV2 = (f: TaskState['forge']): f is ForgeDocV2 => (f as { v?: unknown } | undefined)?.v === 2;
/** critical + important of the block's last review round, when that round is not an accept. */
const openOf = (f: ForgeDocV2): number => {
  const last = f.rounds.at(-1);
  return last && last.action !== 'accept' ? last.findings.critical + last.findings.important : 0;
};

/** T6B3-SAT-WAITING: the tasks that wait for the person: one `blocked` by `external`, and every task not done whose unmet
 *  dependencies (its depends_on, and the tasks its block names) all wait so. */
function heldForPerson(tasks: readonly PlanTask[], states: Record<string, TaskState>): Set<string> {
  const done = (id: string) => states[id]?.status === 'done';
  const blockedBy = (id: string) => (states[id]?.status === 'blocked' ? states[id]?.blockedBy ?? [] : []);
  const held = new Set(tasks.filter(t => blockedBy(t.id).includes(EXTERNAL)).map(t => t.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tasks) {
      if (done(t.id) || held.has(t.id)) continue;
      const unmet = [...t.depends_on, ...blockedBy(t.id)].filter(id => !done(id));
      if (unmet.length && unmet.every(id => held.has(id))) { held.add(t.id); grew = true; }
    }
  }
  return held;
}

/** T6B3-SAT-WAITING, fix 2: whether a debt note of the run (its author a `session:`) names proposal `id` in its proposalId (never
 *  only in its text): an approval whose placement the CLI refused twice, which forge:infinite leaves to the person that way. */
const namedByDebt = (notes: readonly NoteDoc[], id: string): boolean =>
  notes.some(n => n.type === 'debt' && n.author.startsWith('session:') && n.proposalId === id);

/**
 * Why the run is or is not saturated after `dry` rounds in a row that passed nothing, with the evidence:
 * - pendingTasks: the plan's tasks not done, but those that wait for the person (heldForPerson: `waiting.blockedTasks`);
 * - validatorsFailed: the validators with ok false; no file (null) is `(no validate output)`, an empty list `(no validators)` (L-15);
 * - openFindings: for each of the plan's tasks with a forge v2 block, critical + important of its last round when that round
 *   is not an accept; a task the plan no longer has blocks nothing and is named in `waiting.orphanFindings`;
 * - openDefects: the `source: verify` proposals proposed, under discussion and not parked, or approved without a task;
 * - openProposals (H-2, fix 1): the proposals still to judge, every approval of any source without its task, and a proposal
 *   not yet approved here whose owner's mark approves its present text.
 * What waits for the person is `waiting` and never blocks: parked ideas, open questions (no answer, no answering note), the
 * blocked actions (given), the deferred findings of the plan's v2 blocks, the proposals that wait for the owner's mark (an
 * approving mark of an earlier text among them) and the approvals without it (L-18), the tasks blocked for the person and the
 * approvals the run could not place (a debt note of the run names them); a proposal of those lists is no open defect or
 * proposal. A missing input blocks as `inputs`, and what needs it is not computed: the plan's tasks without --plan or --db,
 * notes without --db, validators without --validate. `rounds` blocks below the count and (fix 2) in a cycle without the scout.
 */
export function saturationOf(i: SaturationFacts): SaturationReport {
  const missing = i.missing ?? [];
  const noTasks = missing.includes('--plan') || missing.includes('--db');
  const tasks = noTasks ? [] : i.plan.tasks;
  const states = noTasks ? {} : i.states;
  const notes = missing.includes('--db') ? [] : i.notes;
  const held = heldForPerson(tasks, states);
  const blockedTasks = tasks.filter(t => held.has(t.id)).map(t => t.id);
  const pendingTasks = tasks.filter(t => states[t.id]?.status !== 'done' && !held.has(t.id)).map(t => t.id);
  const validatorsFailed = missing.includes('--validate') ? [] : i.validators === null ? [NO_OUTPUT] : !i.validators.length ? [NO_VALIDATORS]
    : i.validators.filter(v => !v.ok).map(v => clean(v.validator, NAME_MAX) || '(unnamed)');
  const inPlan = new Set(tasks.map(t => t.id));
  const blocks = tasks.map(t => states[t.id]?.forge).filter(isV2);
  const openFindings = blocks.reduce((n, f) => n + openOf(f), 0);
  const deferred = blocks.reduce((n, f) => n + f.deferred.length, 0);
  // A listing's doc id, unlike a plan's, is anyone's: only an id a plan could hold is named (and parseRun reads it back).
  const orphanFindings = Object.keys(states).filter(id => {
    const f = states[id].forge;
    return !inPlan.has(id) && isPlanId(id) && isV2(f) && openOf(f) > 0;
  }).sort();
  const marks = i.marks ?? {};
  type P = SaturationFacts['proposals'][number];
  const undecided = (p: P) => p.status === 'proposed' || p.status === 'discussing';
  const approving = (p: P) => undecided(p) && p.taskId === undefined && (marks[p.id]?.status === 'approved' || marks[p.id]?.status === 'auto_approved');
  // Fix 2 (N-3): only a mark of the present text; one of an earlier text waits for the owner to mark it again.
  const markedOpen = (p: P) => approving(p) && marks[p.id]?.digest === proposalDigest(p.id, p);
  const waitsOwner = [...new Set([...(i.waitsOwner ?? []), ...i.proposals.filter(p => approving(p) && !markedOpen(p)).map(p => p.id)])].sort();
  const unowned = [...new Set(i.unowned ?? [])].sort();
  const approvedUntasked = (p: P) => isActionable(p) && p.taskId === undefined && !unowned.includes(p.id);
  const unplaced = i.proposals.filter(p => approvedUntasked(p) && namedByDebt(notes, p.id)).map(p => p.id);
  const untasked = (p: P) => approvedUntasked(p) && !unplaced.includes(p.id);
  const open = (p: P) => (p.status === 'proposed' || (p.status === 'discussing' && !p.parked)) && !waitsOwner.includes(p.id);
  const openDefects = i.proposals.filter(p => p.source === 'verify' && (open(p) || untasked(p))).map(p => p.id);
  const openProposals = [...new Set([...(i.toJudge ?? []), ...i.proposals.filter(p => untasked(p) || markedOpen(p)).map(p => p.id)])].sort();
  const parked = i.proposals.filter(p => p.status === 'discussing' && p.parked && !markedOpen(p)).map(p => p.id);
  const questions = notes.filter(n => n.type === 'question' && !n.answer && !n.answeredByNote).length;
  const blocking: SaturationBlocking[] = [];
  // T6B3-SAT-EXPLORE-ONLY: only an exploration round concludes; a cycle without the scout keeps `rounds`, whatever the count.
  if (i.dry < SATURATION_ROUNDS || i.explored === false) blocking.push('rounds');
  if (pendingTasks.length) blocking.push('pending-tasks');
  if (validatorsFailed.length) blocking.push('validators');
  if (openFindings) blocking.push('findings');
  if (openDefects.length) blocking.push('defects');
  if (openProposals.length) blocking.push('proposals');
  if (missing.length) blocking.push('inputs');
  return reportOf({
    at: i.at, rounds: i.dry, blocking, openFindings, questions, blocked: i.blocked, deferred, missing: [...missing],
    lists: { pendingTasks, validatorsFailed, openDefects, openProposals, parked, waitsOwner, unowned, blockedTasks, unplaced, orphanFindings },
  });
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

/** Fix 1, fix 2: whether `file` was written after `since` (the run's previous recorded cycle, or its start: lastCycle), so in
 *  this cycle. A validate file of an earlier cycle is stale, a missing input, and never reads green. One that cannot be stated
 *  is not stale: it reads as null. */
export function writtenAfter(file: string, since: string): boolean {
  try { return statSync(file).mtimeMs > Date.parse(since); } catch { return true; }
}

/** H-2: an event of something that passed: a judge's approval, or a v2 added (an `add` with `revises`, the trace an adapt
 *  leaves, since judge logs nothing for one: a proposal that passes with changes). */
const passes = (e: LedgerEvent): boolean => e.kind === 'proposal'
  && ((e.action === 'judge' && e.status === 'auto_approved') || (e.action === 'add' && typeof e.revises === 'string'));

/** T6B3-SAT-WINDOW: the run's last exploration round, the last of `events` (the ledger of run.json's directory) that is a recorded
 *  cycle (its number) with `explore`, since the run started; null before its first. */
export function lastExplore(events: readonly LedgerEvent[], startedAt: string): LedgerEvent | null {
  return lastCycle(events.filter(e => e.explore !== undefined), startedAt);
}

/** T6B3-SAT-EXPLORE-ONLY: the run's previous recorded cycle of any kind (a `cycle` event with its number, since the run
 *  started), the bar a validate file must be newer than; null before its first. */
export function lastCycle(events: readonly LedgerEvent[], startedAt: string): LedgerEvent | null {
  return events.filter(e => e.kind === 'cycle' && typeof e.cycle === 'number' && e.ts >= startedAt).at(-1) ?? null;
}

/**
 * H-2, T6B3-SAT-WINDOW: what passed in this exploration round, as the CLI counts it: the events of `root`'s ledger (the run's
 * proposals, its worktree: proposalsRootOf) that `passes` keeps, since the run's last exploration round (lastExplore, in the
 * ledger of `runRoot`, the directory of run.json) or, before its first, since the run started. A pass in a cycle between
 * (the critic judges every cycle) counts for the next round. One ledger for both is read by position, two by time. A round
 * whose batch was empty passes nothing: it is dry.
 */
export function explorePassed(runRoot: string, root: string, startedAt: string): number {
  const own = readEvents(root);
  const same = samePath(runRoot, root);
  const last = lastExplore(same ? own : readEvents(runRoot), startedAt);
  const since = !last ? own : same ? own.slice(own.lastIndexOf(last) + 1) : own.filter(e => e.ts > last.ts);
  return since.filter(e => e.ts >= startedAt && passes(e)).length;
}
