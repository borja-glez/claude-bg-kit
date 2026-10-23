import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { mainCheckout } from '../../local.js';
import { parseRun, readRunText } from '../../run.js';
import { blockedDecision, markNoted, notedCount, readBlocked } from '../../autonomous.js';
import { addDecision, decisionNoteId, decisionWrites, DecisionInputError } from '../../decisions.js';

export const command: Command = (args, ctx) => {
  const { io, flag, has, json } = ctx;
  const usage = 'usage: forge blocked list | blocked note [--session <SID>]';
  // The run is the main checkout's, active or not: at its stop what is still pending is noted.
  const main = mainCheckout(io.cwd);
  const run = parseRun(readRunText(main));
  const auto = run?.autonomous;
  switch (args[0]) {
    case 'list': {
      if (!auto) throw new UsageError('blocked list: there is no autonomous run in .forge/run.json');
      const all = readBlocked(main, auto.runId, Infinity);
      return json({ runId: auto.runId, blocked: all.slice(-1000), pending: Math.max(0, all.length - notedCount(main, auto.runId)) });
    }
    case 'note': {
      if (!auto) throw new UsageError('blocked note: there is no autonomous run in .forge/run.json');
      const session = flag('session');
      if (has('session') && (!session || !/^[A-Za-z0-9_\-.~:@+]{1,80}$/.test(session))) throw new UsageError('blocked note: --session needs the waypoint session id');
      const es = (run?.locale ?? '').toLowerCase().startsWith('es');
      // The whole file, not the list's last 1000: the count of what is noted indexes the file itself (M8).
      const all = readBlocked(main, auto.runId, Infinity);
      const start = notedCount(main, auto.runId);
      const decisions: number[] = [];
      const skipped: number[] = [];
      const publish = [];
      for (let i = start; i < all.length; i++) {
        // One bad record never wedges the rest: it is skipped, reported, and the count moves past it.
        try {
          const { n, event } = addDecision(main, blockedDecision(all[i], es), { ts: all[i].ts, runId: auto.runId });
          decisions.push(n);
          if (session) publish.push(...decisionWrites({ event, session, eid: decisionNoteId(event, session) }));
        } catch (e) {
          // T10-NARROW-CATCH: any other failure (a busy ledger, a full disk) keeps this record pending for the next note
          if (!(e instanceof DecisionInputError)) { if (i > start) markNoted(main, auto.runId, i); throw e; }
          skipped.push(i);
        }
      }
      if (all.length > start) markNoted(main, auto.runId, all.length);
      return json({ noted: decisions.length, decisions, skipped, ...(session ? { publish } : {}) });
    }
    default:
      throw new UsageError(usage);
  }
};
