import { UsageError } from './errors.js';
import { DEFAULT_SHADOW_BRIEFS, readShadow, renderShadowReport, shadowReport, startShadow, stopShadow } from '../shadow.js';

// `FORGE shadow start|stop|report`: opens, closes and reports the shadow test kept in `<cwd>/.forge/shadow.json`.
// review.ts dispatches here.

type Result = { code: number; stdout: string; stderr: string };
const USAGE = 'usage: forge shadow start [--tasks <N>] [--reset] | stop | report [--locale es|en]';

const json = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });

function flagOf(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v === undefined || v.startsWith('--') ? undefined : v;
}

const STATUS = {
  es: { none: 'Prueba en sombra: no iniciada', open: (n: number) => `Prueba en sombra: abierta, quedan ${n} briefs`, closed: 'Prueba en sombra: cerrada' },
  en: { none: 'Shadow test: not started', open: (n: number) => `Shadow test: open, ${n} briefs left`, closed: 'Shadow test: closed' },
};

/** `args` starts with the subcommand; `cwd` is forge's own dir, where `.forge/shadow.json` lives. */
export function shadowCommand(args: string[], cwd: string): Result {
  const sub = args[0];
  switch (sub) {
    case 'start': {
      let tasks = DEFAULT_SHADOW_BRIEFS;
      if (args.includes('--tasks')) {
        const v = flagOf(args, 'tasks');
        if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1) throw new UsageError('shadow start: --tasks must be a positive integer');
        tasks = Number(v);
      }
      const s = startShadow(cwd, tasks, { reset: args.includes('--reset') });
      return json({ remaining: s.remaining, cases: s.cases.length });
    }
    case 'stop': {
      const s = stopShadow(cwd);
      return json({ remaining: 0, cases: s ? s.cases.length : 0 });
    }
    case 'report': {
      const locale = flagOf(args, 'locale');
      if (args.includes('--locale') && locale !== 'es' && locale !== 'en') throw new UsageError('shadow report: --locale must be es or en');
      const lang = locale === 'en' ? 'en' : 'es';
      const s = readShadow(cwd);
      const t = STATUS[lang];
      const status = !s ? t.none : s.remaining > 0 ? t.open(s.remaining) : t.closed;
      return { code: 0, stdout: `${status}\n\n${renderShadowReport(shadowReport(s?.cases ?? []), lang)}`, stderr: '' };
    }
    default:
      throw new UsageError(USAGE);
  }
}
