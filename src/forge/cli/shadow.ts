import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import { DEFAULT_SHADOW_BRIEFS, buildCase, readShadow, renderShadowReport, saveShadow, shadowReport, startShadow, stopShadow } from '../shadow.js';
import { parseReview, repoRelative, type Finding, type Review } from '../verdict.js';

// `FORGE shadow start|stop|report|collect`: opens, closes and reports the shadow test kept in `.forge/shadow.json` of the main
// checkout (shadow.ts), the same file from every worktree.
// review.ts dispatches here.

type Result = { code: number; stdout: string; stderr: string };
const USAGE = 'usage: forge shadow start [--tasks <N>] [--reset] | stop | report [--locale es|en] | collect --task <id>-<n> --dir <review dir>';

const json = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });

type TwinKey = 'correctness' | 'security' | 'perf';
export interface TwinsCollected {
  shadow: TwinKey[];
  shadowSkipped: { reviewer: TwinKey; reason: 'missing' | 'unparseable' | 'incomplete'; file: string }[];
  shadowPending: { reviewer: TwinKey; file: string }[];
}
const KEY_OF_ROLE: Record<string, TwinKey> = { 'review-correctness': 'correctness', 'review-security': 'security', 'review-perf': 'perf' };
const rel = (cwd: string, p: string) => path.relative(cwd, p).split(path.sep).join('/') || '.';

/** The twins a review plan spawned (its `twin: true` entries), by reviewer. */
function twinsOf(plan: unknown): TwinKey[] {
  const spawn = plan && typeof plan === 'object' ? (plan as { spawn?: unknown }).spawn : undefined;
  return (Array.isArray(spawn) ? spawn as Record<string, unknown>[] : [])
    .filter(x => !!x && typeof x === 'object' && x.twin === true)
    .map(x => (x.name === 'correctness' || x.name === 'security' || x.name === 'perf' ? x.name as TwinKey : typeof x.role === 'string' ? KEY_OF_ROLE[x.role] : undefined))
    .filter((x): x is TwinKey => !!x);
}

/**
 * The shadow twins of a review (C-11, moved from review-close): each twin whose file is in `shadow/` is paired with its
 * high reviewer and the case saved in .forge/shadow.json, replacing the one an earlier collection of this review saved.
 * A twin with no file yet is pending (`FORGE shadow collect` saves it when it is back); a missing high file, or an
 * unparseable or draft file, the twin's or its high reviewer's, saves no case. It never touches the verdict.
 */
export function collectTwins(task: string, roundDir: string, plan: unknown, deps: { cwd: string; repoDir: string }): TwinsCollected {
  const out: TwinsCollected = { shadow: [], shadowSkipped: [], shadowPending: [] };
  const pairs: { k: TwinKey; high: Review; xhigh: Review }[] = [];
  for (const k of twinsOf(plan)) {
    const highFile = path.join(roundDir, `${k}.json`), twinFile = path.join(roundDir, 'shadow', `${k}.json`);
    if (!existsSync(twinFile)) { out.shadowPending.push({ reviewer: k, file: rel(deps.cwd, twinFile) }); continue; }
    if (!existsSync(highFile)) { out.shadowSkipped.push({ reviewer: k, reason: 'missing', file: rel(deps.cwd, highFile) }); continue; }
    const high = parseReview(readFileSync(highFile, 'utf8'));
    const xhigh = parseReview(readFileSync(twinFile, 'utf8'));
    const bad = xhigh.invalid ? twinFile : high.invalid ? highFile : null;
    if (bad) { out.shadowSkipped.push({ reviewer: k, reason: 'unparseable', file: rel(deps.cwd, bad) }); continue; }
    const draft = xhigh.incomplete ? twinFile : high.incomplete ? highFile : null;
    if (draft) { out.shadowSkipped.push({ reviewer: k, reason: 'incomplete', file: rel(deps.cwd, draft) }); continue; }
    pairs.push({ k, high, xhigh });
    out.shadow.push(k);
  }
  if (pairs.length) {
    const local = (fs: Finding[]) => fs.map(f => (f.file ? { ...f, file: repoRelative(f.file, deps.repoDir) } : f));
    const state = readShadow(deps.cwd) ?? { remaining: 0, cases: [] };
    let cases = state.cases;
    for (const { k, high, xhigh } of pairs) {
      cases = [...cases.filter(c => c.task !== task || c.reviewer !== k), buildCase(task, k, local(high.findings), local(xhigh.findings))];
    }
    saveShadow(deps.cwd, { ...state, cases });
  }
  return out;
}

function flagOf(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v === undefined || v.startsWith('--') ? undefined : v;
}

const STATUS = {
  es: { none: 'Prueba en sombra: no iniciada', open: (n: number) => `Prueba en sombra: abierta, quedan ${n} briefs`, closed: 'Prueba en sombra: cerrada' },
  en: { none: 'Shadow test: not started', open: (n: number) => `Shadow test: open, ${n} briefs left`, closed: 'Shadow test: closed' },
};

/** `args` starts with the subcommand; `deps.cwd` is forge's own dir, whose main checkout keeps `.forge/shadow.json`; `deps.repoDir` the code's, for the findings' paths. */
export function shadowCommand(args: string[], deps: { cwd: string; repoDir: string }): Result {
  const cwd = deps.cwd;
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
    case 'collect': {
      // C-11: the twins of a review that came back after review-close.
      const task = flagOf(args, 'task'), dirArg = flagOf(args, 'dir');
      if (!task || !/^.+-\d{1,4}$/.test(task) || !dirArg) throw new UsageError('shadow collect: --task <id>-<n> and --dir <its review dir, reviews-<n>-<round>> are required');
      const roundDir = path.resolve(cwd, dirArg);
      let plan: unknown;
      try { plan = JSON.parse(readFileSync(path.join(roundDir, 'review-plan.json'), 'utf8')); } catch { plan = undefined; }
      if (!plan || typeof plan !== 'object') throw new UsageError(`shadow collect: no review-plan.json in ${dirArg}`);
      return json(collectTwins(task, roundDir, plan, deps));
    }
    default:
      throw new UsageError(USAGE);
  }
}
