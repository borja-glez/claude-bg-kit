import type { Command } from '../context.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents } from '../../ledger.js';
import { parseRun, recordCycle, recordExplore, readRunText, saveRun, type RunState } from '../../run.js';
import { UsageError } from '../errors.js';
import { infinitePublish } from '../../infinite-doc.js';
import { mainCheckout } from '../../local.js';
import { proposalsRootOf, runRootOf, runReply, unownedReasons } from '../shared.js';
import { explorePassed, lastExplore, readValidateFile, saturationOf, writtenAfter, SATURATION_ROUNDS } from '../../saturation.js';
import { SATURATION_INPUTS, type SaturationInput, type SaturationReport } from '../../../lib/forge-run.js';
import { parsePlan } from '../../../lib/plan.js';
import type { Plan, PlanView } from '../../../lib/types.js';
import { readDocs } from '../../../lib/read-docs.js';
import { normalizeNote } from '../../../lib/notes.js';
import { stateDoc } from '../../../page/normalize.js';
import { loadApprovals, loadProposals } from '../../proposals.js';
import { judgeQueue } from '../../judge.js';
import { readBlocked } from '../../autonomous.js';

type Flag = (name: string) => string | undefined;
type Inputs = { plan: Plan | null; db: string | null; validate: string | null };
const NO_PLAN: PlanView = { tracks: [], phases: [], tasks: [], versions: [] };

/** 6b-3: the inputs the cycle was given, read before anything is written. A --db without its state listing refuses the cycle
 *  (M-11: it would read as nothing pending); fix 1: a --plan that does not read or parse is a missing input, as one not given. */
function cycleInputs(cwd: string, flag: Flag): Inputs {
  const plan = flag('plan');
  let doc: Plan | null = null;
  if (plan !== undefined) {
    try { doc = parsePlan(readFileSync(path.resolve(cwd, plan), 'utf8')); } catch { doc = null; }
  }
  const db = flag('db') === undefined ? null : path.resolve(cwd, flag('db')!);
  if (db && !existsSync(path.join(db, 'state'))) throw new UsageError(`cycle: ${flag('db')} has no state listing: list state first`);
  return { plan: doc, db, validate: flag('validate') === undefined ? null : path.resolve(cwd, flag('validate')!) };
}

/**
 * The saturation report of a cycle whose run's `dry` reached SATURATION_ROUNDS: from the run's proposals and marks (its
 * worktree, L-12; loaded once), the listings of --db, the --validate file and the actions the guard blocked. L-10, fix 1: an
 * input not given or not read, and a validate file not written after `since` (the last exploration round), is named missing.
 */
function reportFor(o: { runRoot: string; main: string; run: RunState; dry: number; at: string; now: Date; since: string } & Inputs): SaturationReport {
  const fresh = o.validate !== null && writtenAfter(o.validate, o.since);
  const have: Record<SaturationInput, boolean> = { '--plan': o.plan !== null, '--db': o.db !== null, '--validate': fresh };
  const missing = SATURATION_INPUTS.filter(f => !have[f]);
  const root = proposalsRootOf(o.runRoot);
  const proposals = loadProposals(root);
  const marks = loadApprovals(root);
  const queue = judgeQueue(root, proposals);
  return saturationOf({
    dry: o.dry, at: o.at, plan: o.plan ?? NO_PLAN,
    states: o.db ? readDocs(path.join(o.db, 'state'), stateDoc).docs : {},
    validators: fresh && o.validate ? readValidateFile(o.validate) : null,
    proposals, marks,
    notes: o.db ? Object.values(readDocs(path.join(o.db, 'notes'), normalizeNote).docs) : [],
    blocked: o.run.autonomous ? readBlocked(o.main, o.run.autonomous.runId, Infinity).length : 0,
    toJudge: queue.pending, waitsOwner: queue.waitsOwner, unowned: Object.keys(unownedReasons(root, o.now, proposals, marks)),
    ...(missing.length ? { missing } : {}),
  });
}

export const command: Command = (args, ctx) => {
  const { io, flag, has, json, ts } = ctx;
  const progress = flag('progress');
  if (progress !== 'yes' && progress !== 'no') throw new UsageError('cycle: --progress yes|no is required');
  let error: string | undefined;
  if (flag('error-file') !== undefined) {
    try { error = readFileSync(path.resolve(io.cwd, flag('error-file')!), 'utf8'); } catch { throw new UsageError('cycle: cannot read --error-file'); }
  }
  // 6b-3 H-2: --explore says the scout ran this cycle. What passed, the CLI counts from the ledger, so it takes no number.
  const explore = has('explore');
  if (explore && flag('explore') !== undefined) throw new UsageError('cycle: --explore takes no value: the CLI counts what passed from the ledger');
  const given = SATURATION_INPUTS.map(f => f.slice(2)).filter(f => has(f));
  for (const f of given) if (flag(f) === undefined) throw new UsageError(`cycle: --${f} needs a value`);
  const runRoot = runRootOf(io.cwd);
  const current = parseRun(readRunText(runRoot));
  if (!current?.active) throw new UsageError('cycle: no active run (forge infinite start)');
  if ((explore || given.length) && !current.autonomous) {
    throw new UsageError('cycle: --explore, --plan, --db and --validate are for an autonomous run (infinite start --profile)');
  }
  const inputs = cycleInputs(io.cwd, flag);
  const main = mainCheckout(io.cwd);
  const at = ts();
  // T6B3-SAT-WINDOW: the last exploration round, read before this cycle's own event is appended. Its time is the window of what
  // passed and the time a validate file must be newer than (the run's start before the first round).
  const since = (current.autonomous ? lastExplore(readEvents(runRoot), current.startedAt)?.ts : undefined) ?? current.startedAt;
  let next = recordCycle(current, { progress: progress === 'yes', ...(error !== undefined ? { error } : {}) });
  let round: { passed: number; dry: number } | null = null;
  if (explore) {
    const passed = explorePassed(runRoot, proposalsRootOf(runRoot), current.startedAt);
    next = recordExplore(next, passed);
    round = { passed, dry: next.explore!.dry };
  }
  // Fix 1: past the count every cycle computes the report again, with the scout or without it, so it stays fresh; only a round
  // changes `dry`. Below the count (a round that passed something included) there is none.
  const dry = next.explore?.dry;
  if (dry !== undefined) next = { ...next, saturation: dry < SATURATION_ROUNDS ? null : reportFor({ runRoot, main, run: next, dry, at, now: io.now(), since, ...inputs }) };
  saveRun(runRoot, next);
  appendEvent(runRoot, { ts: at, kind: 'cycle', cycle: next.cycle, progress: progress === 'yes', ...(next.lastError ? { error: next.lastError } : {}),
    ...(round ? { explore: round } : {}) });
  return json({ ...next, reply: runReply(runRoot, next), publish: { infinite: infinitePublish(main, next, io.now()) } });
};
