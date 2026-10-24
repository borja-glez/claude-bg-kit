import type { Command } from '../context.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '../../ledger.js';
import { parseRun, recordCycle, recordExplore, readRunText, saveRun, type RunState } from '../../run.js';
import { UsageError } from '../errors.js';
import { infinitePublish } from '../../infinite-doc.js';
import { mainCheckout } from '../../local.js';
import { proposalsRootOf, runRootOf, runReply, unownedReasons } from '../shared.js';
import { explorePassed, missingReport, readValidateFile, saturationOf, SATURATION_ROUNDS } from '../../saturation.js';
import { SATURATION_INPUTS, type SaturationReport } from '../../../lib/forge-run.js';
import { parsePlan, PlanError } from '../../../lib/plan.js';
import type { Plan } from '../../../lib/types.js';
import { readDocs } from '../../../lib/read-docs.js';
import { normalizeNote } from '../../../lib/notes.js';
import { stateDoc } from '../../../page/normalize.js';
import { loadProposals } from '../../proposals.js';
import { pendingForJudge, waitingForOwner } from '../../judge.js';
import { readBlocked } from '../../autonomous.js';

type Flag = (name: string) => string | undefined;

/** 6b-3: the inputs --explore was given, read before anything is written: a --plan that does not parse, or a --db without its
 *  state listing (M-11: it would read as nothing pending), refuses the cycle. A --validate file is read when the report is. */
function exploreInputs(cwd: string, flag: Flag): { plan: Plan | null; db: string | null; validate: string | null } {
  const plan = flag('plan');
  let doc: Plan | null = null;
  if (plan !== undefined) {
    let text: string;
    try { text = readFileSync(path.resolve(cwd, plan), 'utf8'); } catch { throw new UsageError(`cycle: cannot read plan ${plan}`); }
    try { doc = parsePlan(text); } catch (e) {
      if (e instanceof PlanError) throw new UsageError(`cycle: ${plan}: ${e.issues.join('; ')}`);
      throw e;
    }
  }
  const db = flag('db') === undefined ? null : path.resolve(cwd, flag('db')!);
  if (db && !existsSync(path.join(db, 'state'))) throw new UsageError(`cycle: ${flag('db')} has no state listing: list state first`);
  return { plan: doc, db, validate: flag('validate') === undefined ? null : path.resolve(cwd, flag('validate')!) };
}

/** The saturation report of a round whose `dry` reached SATURATION_ROUNDS, from the run's proposals (its worktree, L-12), the
 *  listings of --db, the --validate file and the actions the guard blocked; L-10: without an input, one that names it. */
function reportFor(o: { runRoot: string; main: string; run: RunState; dry: number; at: string; now: Date } & ReturnType<typeof exploreInputs>): SaturationReport {
  if (!o.plan || !o.db || !o.validate) {
    const given = { '--plan': o.plan, '--db': o.db, '--validate': o.validate };
    return missingReport(o.dry, o.at, SATURATION_INPUTS.filter(f => given[f] === null));
  }
  const root = proposalsRootOf(o.runRoot);
  return saturationOf({
    dry: o.dry, at: o.at, plan: o.plan,
    states: readDocs(path.join(o.db, 'state'), stateDoc).docs,
    validators: readValidateFile(o.validate),
    proposals: loadProposals(root),
    notes: Object.values(readDocs(path.join(o.db, 'notes'), normalizeNote).docs),
    blocked: o.run.autonomous ? readBlocked(o.main, o.run.autonomous.runId, Infinity).length : 0,
    toJudge: pendingForJudge(root), waitsOwner: waitingForOwner(root), unowned: Object.keys(unownedReasons(root, o.now)),
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
  if (given.length && !explore) throw new UsageError('cycle: --plan, --db and --validate go with --explore');
  for (const f of given) if (flag(f) === undefined) throw new UsageError(`cycle: --${f} needs a value`);
  const runRoot = runRootOf(io.cwd);
  const current = parseRun(readRunText(runRoot));
  if (!current?.active) throw new UsageError('cycle: no active run (forge infinite start)');
  if (explore && !current.autonomous) throw new UsageError('cycle: --explore is for an autonomous run (infinite start --profile)');
  const inputs = explore ? exploreInputs(io.cwd, flag) : null;
  const main = mainCheckout(io.cwd);
  const at = ts();
  let next = recordCycle(current, { progress: progress === 'yes', ...(error !== undefined ? { error } : {}) });
  let round: { passed: number; dry: number } | null = null;
  if (inputs) {
    // Counted before this cycle's own event is appended: the round is what passed since the last one.
    const passed = explorePassed(runRoot, proposalsRootOf(runRoot), current.startedAt);
    next = recordExplore(next, passed);
    const dry = next.explore!.dry;
    round = { passed, dry };
    // A round that passed something, or one below the count, leaves no report.
    next = { ...next, saturation: dry < SATURATION_ROUNDS ? null : reportFor({ runRoot, main, run: next, dry, at, now: io.now(), ...inputs }) };
  }
  saveRun(runRoot, next);
  appendEvent(runRoot, { ts: at, kind: 'cycle', cycle: next.cycle, progress: progress === 'yes', ...(next.lastError ? { error: next.lastError } : {}),
    ...(round ? { explore: round } : {}) });
  return json({ ...next, reply: runReply(runRoot, next), publish: { infinite: infinitePublish(main, next, io.now()) } });
};
