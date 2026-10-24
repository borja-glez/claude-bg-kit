import type { Command } from '../context.js';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from '../../ledger.js';
import { factsOf, markReviewed, phaseStatus, readReviewed } from '../../phases.js';
import { heldTasks } from '../../replan-check.js';
import { parseRun, startRun, stopReason, readRunText, saveRun, stopFile, type RunState } from '../../run.js';
import { UNBOUND_WARNING } from '../../hook.js';
import { isLocale } from '../../../lib/forge-run.js';
import { claudeSessionId, noClaudeSession } from '../../../lib/claude-session.js';
import { UsageError } from '../errors.js';
import { infinitePublish } from '../../infinite-doc.js';
import { mainCheckout } from '../../local.js';
import { activeProfileAt, prepareProfile, profileArgs, profileBlock, readableRun } from '../../profile.js';
import { autonomousFor, recordSessions } from '../../autonomous.js';
import { loadConfig, type ForgeConfig } from '../../config.js';
import { resetDelegation, trustFor, type TrustState } from '../../trust.js';
import { activeProductRun, planOf, stopContext, unownedOf, runRootOf, runReply } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, flag, has, json, ts } = ctx;
  const sub = args[0];
  if (sub === 'prepare') {
    const { profile, name } = profileArgs('infinite prepare', flag('profile'), flag('name'));
    readableRun(runRootOf(io.cwd), 'infinite prepare');
    // From inside an active run's worktree (its own session included), nothing is prepared: the swarm start refusal's check.
    const inside = activeProfileAt(io.cwd);
    if (inside) throw new UsageError(`infinite prepare: ${io.cwd} is inside the worktree of the active autonomous run ${inside.runId}; prepare a profile from outside it`);
    const out = prepareProfile(mainCheckout(io.cwd), io.cwd, profile, name, ts());
    // M-10: where the session goes next, by path, since the start runs only from there.
    const next = `enter the worktree ${out.worktree} (EnterWorktree with this path), then run infinite start --profile ${profile} --name ${name} from it`;
    return json({ ...out, project: name, next });
  }
  if (sub === 'start') {
    const num = (name: string, valid: (n: number) => boolean, what: string) => {
      if (!has(name)) return undefined;
      const v = flag(name);
      const n = v !== undefined && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
      if (!valid(n)) throw new UsageError(`infinite start: --${name} must be ${what}`);
      return n;
    };
    const posInt = (n: number) => Number.isInteger(n) && n > 0;
    const cycles = num('cycles', posInt, 'a positive integer');
    const hours = num('hours', n => Number.isFinite(n) && n > 0, 'a positive number');
    const queueMax = num('queue-max', posInt, 'a positive integer');
    const locale = flag('locale');
    if (has('locale') && !isLocale(locale)) throw new UsageError('infinite start: --locale must be a language code (es, en, pt-BR…)');
    if (cycles === undefined && hours === undefined) throw new UsageError('infinite start: a budget is required (--cycles N and/or --hours H)');
    // C1, K5-03: the run is bound to the session that starts it; only that session's Stop hook chains its cycles.
    const session = claudeSessionId(flag('session'), io.env ?? process.env);
    if (!session) throw new UsageError(noClaudeSession('infinite start', '--session'));
    // 6b-2: --profile and --name go together; a --name alone is refused rather than starting a run no guard judges.
    const profiled = has('profile') || has('name') ? profileArgs('infinite start', flag('profile'), flag('name')) : null;
    // An active run blocks a new one only while nothing stops it and a session drives it: a run whose stop reason
    // is already due (e.g. its session died after a budget ran out or a stop was asked), or one left without a
    // session by forge 0.15 (no Stop hook chains its cycles any more), is replaced.
    // K2-01: the run lives in the main checkout, whichever worktree starts it; an older run left in this
    // directory still counts as the active one.
    const runRoot = runRootOf(io.cwd);
    // m-3: a profile never replaces a run.json the guard holds closed (it does not read, or its block does not parse).
    const current = profiled ? readableRun(runRoot, 'infinite start') : parseRun(readRunText(runRoot));
    if (profiled) {
      // L-9, m-2: an active autonomous run, of any runId and whatever its stop reason, is continued, never restarted (its own
      // session cannot give itself a fresh budget); and the sessions of a stopped one stay its own, still guarded.
      if (current?.active && current.autonomous) {
        throw new UsageError(`infinite start: a run is active: continue it, or stop it and start from a new conversation (autonomous run ${current.autonomous.runId})`);
      }
      if (autonomousFor(runRoot, { session_id: session })) {
        throw new UsageError('infinite start: this conversation belongs to a stopped autonomous run and stays guarded; open a new conversation to start a profile');
      }
    }
    if (current?.active && current.sessionId !== null
      && stopReason(current, stopContext(runRoot, io.now())) === null) throw new UsageError('infinite start: a run is already active (forge stop, or forge infinite status)');
    const main = mainCheckout(io.cwd);
    const autonomous = profiled ? profileBlock(main, io.cwd, profiled.profile, profiled.name) : null;
    const budget = { ...(cycles !== undefined ? { cycles } : {}), ...(hours !== undefined ? { hours } : {}) };
    const run: RunState = { ...startRun(io.now(), budget, queueMax, session, locale ?? null), ...(autonomous ? { autonomous } : {}) };
    // A block parseRun refuses would make the guard deny every call of the run: never written.
    if (autonomous && !parseRun(JSON.stringify(run))?.autonomous) throw new UsageError(`infinite start: the autonomous block of ${autonomous.runId} does not read back; check its start.json`);
    forgeDir(main);
    rmSync(stopFile(main), { force: true });
    // H-1: the session ids are on disk before run.json names them, so a run.json that does not read still guards them.
    if (autonomous) recordSessions(main, autonomous.runId, [session], autonomous.worktree);
    // T6B2-TRUST-RESET: before the run is active, so no earlier run of this id lends it a trust or a refusal.
    if (autonomous) resetDelegation(autonomous.worktree, autonomous.runId);
    saveRun(main, run);
    // 6b-2 M-1: once the run is on disk, it trusts its worktree's commands (trustFor) and prints that `trust`; a config
    // that does not load runs nothing, and one without commands needs no trust: no `trust` then. A set the run's guard or the
    // person refused is `blocked`, with no note: nobody is asked (T6B2-REFUSED-IN-RUN, H-4).
    let trust: { state: TrustState; hash: string; blocked?: true; note?: false } | null = null;
    if (autonomous) {
      let config: ForgeConfig | null = null;
      try { config = loadConfig(autonomous.worktree); } catch { config = null; }
      const t = config ? trustFor(autonomous.worktree, config, ts()) : null;
      if (t?.hash) trust = { state: t.state, hash: t.hash, ...(t.blocked ? { blocked: true as const, note: false as const } : {}) };
    }
    return json({ ...run, publish: { infinite: infinitePublish(main, run, io.now()) }, ...(trust ? { trust } : {}) });
  }
  if (sub === 'phase') {
    // 6b-3, spec «Fases que se replanifican»: the first phase of the plan, in its order, whose tasks the roadmap's state says are
    // all done and that was not reviewed yet (src/forge/phases.ts); --mark records its review. Only a product run reviews its
    // phases (L-16: a spike has no phase review). H-6: the reviewed phases are phases.json's, in the main checkout.
    // T6B3-REPLAN-HELD: `held` is what replan-check would refuse to change, by the same rule, from this checkout (the run's
    // worktree, where the session runs both), for the phase review.
    const main = mainCheckout(io.cwd);
    const { runId } = activeProductRun(io.cwd, 'infinite phase', 'reviews its phases', main).autonomous;
    const planArg = flag('plan');
    const db = flag('db');
    if (!planArg || !db) throw new UsageError('usage: forge infinite phase --plan <plan.yaml> --db <DB> [--mark <phase>]');
    const facts = factsOf(io.cwd, db, 'infinite phase');
    let text: string;
    try { text = readFileSync(path.resolve(io.cwd, planArg), 'utf8'); } catch { throw new UsageError(`infinite phase: cannot read ${planArg}`); }
    const plan = planOf(text, planArg, 'infinite phase: ');
    const mark = flag('mark');
    if (has('mark') && !(mark && plan.phases.some(ph => ph.id === mark))) throw new UsageError(`infinite phase: --mark ${mark ?? ''} is not a phase of ${planArg}`);
    // Final fix F-M4: `reviewed`, the phases already reviewed, which a re-plan never moves a task into.
    const reviewed = mark ? markReviewed(main, runId, mark) : readReviewed(main, runId);
    return json({ ...phaseStatus(plan, facts.done, reviewed), held: heldTasks(io.cwd, plan, facts), reviewed });
  }
  if (sub === 'status') {
    const runRoot = runRootOf(io.cwd);
    const text = readRunText(runRoot);
    const run = parseRun(text);
    const reason = run?.active ? stopReason(run, stopContext(runRoot, io.now())) : null;
    // §4.6: an active run no session drives (one forge 0.15 started) says so.
    const unbound = !!run?.active && run.sessionId === null;
    // G-08: meta/infinite as the roadmap takes it, for the skill to send as it is.
    const publish = run ? { infinite: infinitePublish(mainCheckout(io.cwd), run, io.now()) } : null;
    return json({ present: text !== null, valid: run !== null, run, stopReason: reason, reply: runReply(runRoot, run),
      ...(unbound ? { unbound: true, warning: UNBOUND_WARNING } : {}), unowned: unownedOf(runRoot, io.now()), publish });
  }
  throw new UsageError('usage: forge infinite <prepare --profile spike|product --name N|start --cycles N|--hours H [--queue-max N] [--session ID] [--locale CODE] [--profile P --name N]|phase --plan P --db D [--mark F]|status>');
};
