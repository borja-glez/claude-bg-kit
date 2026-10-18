import type { Command } from '../context.js';
import { rmSync } from 'node:fs';
import { forgeDir } from '../../ledger.js';
import { parseRun, startRun, stopReason, readRunText, saveRun, stopFile, type RunState } from '../../run.js';
import { UNBOUND_WARNING } from '../../hook.js';
import { isLocale } from '../../../lib/forge-run.js';
import { claudeSessionId, noClaudeSession } from '../../../lib/claude-session.js';
import { UsageError } from '../errors.js';
import { infinitePublish } from '../../infinite-doc.js';
import { mainCheckout } from '../../local.js';
import { stopContext, unownedOf, runRootOf, runReply } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, flag, has, json } = ctx;
  const sub = args[0];
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
    // An active run blocks a new one only while nothing stops it and a session drives it: a run whose stop reason
    // is already due (e.g. its session died after a budget ran out or a stop was asked), or one left without a
    // session by forge 0.15 (no Stop hook chains its cycles any more), is replaced.
    // K2-01: the run lives in the main checkout, whichever worktree starts it; an older run left in this
    // directory still counts as the active one.
    const runRoot = runRootOf(io.cwd);
    const current = parseRun(readRunText(runRoot));
    if (current?.active && current.sessionId !== null
      && stopReason(current, stopContext(runRoot, io.now())) === null) throw new UsageError('infinite start: a run is already active (forge stop, or forge infinite status)');
    const main = mainCheckout(io.cwd);
    forgeDir(main);
    rmSync(stopFile(main), { force: true });
    const run: RunState = startRun(io.now(), { ...(cycles !== undefined ? { cycles } : {}), ...(hours !== undefined ? { hours } : {}) }, queueMax, session, locale ?? null);
    saveRun(main, run);
    return json({ ...run, publish: { infinite: infinitePublish(main, run, io.now()) } });
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
  throw new UsageError('usage: forge infinite <start --cycles N|--hours H [--queue-max N] [--session ID] [--locale CODE]|status>');
};
