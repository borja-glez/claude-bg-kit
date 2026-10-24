import type { Command } from '../context.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { parseRun, readRunText } from '../../run.js';
import { lastMarket, marketNote, readMarket, saveMarket } from '../../market.js';
import { runRootOf } from '../shared.js';

/** A waypoint session id, as `--session` takes it. */
const SESSION = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;

export const command: Command = (args, ctx) => {
  const { io, flag, has, json, ts } = ctx;
  const usage = 'usage: forge market note --file <market.json> --session <SID> [--locale es|en] | market last';
  // 6b-3: the reports live in .forge/market of the checkout this runs in (a profile's worktree), beside its proposals.
  switch (args[0]) {
    case 'note': {
      const file = flag('file');
      if (!file) throw new UsageError('market note: --file is required');
      const session = flag('session');
      if (!session || !SESSION.test(session)) throw new UsageError('market note: --session needs the waypoint session id');
      const locale = flag('locale');
      if (has('locale') && locale !== 'es' && locale !== 'en') throw new UsageError('market note: --locale is es or en');
      let text: string;
      try { text = readFileSync(path.resolve(io.cwd, file), 'utf8'); } catch { throw new UsageError(`market note: cannot read ${file}`); }
      const report = readMarket(text);
      if (!report) throw new UsageError(`market note: ${file} is not a market report (a JSON object with a summary)`);
      // L-7: without --locale, the run's, as judge takes it.
      const es = (locale ?? parseRun(readRunText(runRootOf(io.cwd)))?.locale ?? '').toLowerCase().startsWith('es');
      const at = ts();
      const saved = saveMarket(io.cwd, report, at);
      return json({ file: saved, findings: report.findings.length, noWeb: report.noWeb, publish: [marketNote(report, at, session, es)] });
    }
    case 'last':
      return json({ file: lastMarket(io.cwd) });
    default:
      throw new UsageError(usage);
  }
};
