import type { Command } from '../context.js';
import { existsSync, statSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readEvents } from '../../ledger.js';
import { planLocale } from '../../../lib/locale.js';
import { loadConfig, NAME } from '../../config.js';
import { parseVerifyFile } from '../../verdict.js';
import { UsageError } from '../errors.js';
import { readKeptAssets, runHolding } from '../../roadmap-sources.js';
import { eventsOf, isTask, resolveProject } from '../../task-ref.js';
import { mainCheckout } from '../../local.js';
import { surfaceFile } from '../../surfaces.js';
import { logVerifyResult, learnSurface, cleanupEvidence } from '../shared.js';

/** A screenshot above this is converted to JPEG before it is uploaded to the roadmap. */
const SHOT_MAX_BYTES = 2 * 1024 * 1024;

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, ts } = ctx;
  // Measure 10: what `## After the verdict` did in about ten steps, in one call. The skill keeps the upload of the
  // shots and the `update state/T` with their urls, and shows the proposals to the person.
  const task = flag('task'), dirArg = flag('dir'), evArg = flag('evidence');
  if (!task || !dirArg || !evArg) throw new UsageError('verify-close: --task, --dir and --evidence are required');
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-close: --locale must be es|en');
  const es = (loc ?? planLocale(io.cwd)) === 'es';
  const dir = path.resolve(io.cwd, dirArg);
  const evidence = path.resolve(io.cwd, evArg);
  const verifyPath = path.join(dir, 'verify.json');
  const v = parseVerifyFile(existsSync(verifyPath) ? readFileSync(verifyPath, 'utf8') : null);
  if (!v) throw new UsageError(`verify-close: ${dirArg}/verify.json is not a usable verify result (result pass|fail|blocked, checks, a reason when blocked)`);
  // 1. The learned notes of each surface, into the code checked (--cwd), as `surfaces learn` adds them.
  const notes = new Map<string, string[]>();
  for (const l of v.learned) notes.set(l.surface, [...(notes.get(l.surface) ?? []), l.note]);
  const learned: Record<string, number> = {};
  const skipped: { surface: string; reason: string }[] = [];
  const commit: string[] = [];
  for (const [name, list] of notes) {
    if (!NAME.test(name)) { skipped.push({ surface: name.slice(0, 80), reason: 'not a surface name' }); continue; }
    const r = learnSurface(io, repoDir, name, list, es ? 'Aprendido' : 'Learned');
    if ('reason' in r) { skipped.push({ surface: name, reason: r.reason }); continue; }
    learned[name] = r.count;
    commit.push(surfaceFile(name));
  }
  // 2. The processes the verify agent left running.
  const cleanup = cleanupEvidence(evidence);
  // 3. The result, once: closing again (or after review-close or verify-result logged it) adds no event.
  const passed = v.checks.filter(c => c.ok).length, total = v.checks.length;
  // The `evidence` field logVerifyResult writes: only for a `reviews-<n>-<k>` dir.
  const relDir = path.relative(io.cwd, dir).split(path.sep).join('/');
  const evRel = relDir.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
  const evField = evRel !== relDir ? evRel : undefined;
  const ledger = readEvents(io.cwd);
  const last = eventsOf(ledger, { project: resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger }), task })
    .filter(e => e.kind === 'verify' && isTask(e, task) && typeof e.result === 'string').at(-1);
  if (!last || last.result !== v.result || last.passed !== passed || last.total !== total || last.evidence !== evField) logVerifyResult(io.cwd, ts(), task, dir, v);
  // 4. Where the evidence goes, read now (the person may have changed it).
  let mode: 'upload' | 'local' = 'upload';
  try { mode = loadConfig(mainCheckout(io.cwd)).evidence; } catch { mode = 'upload'; }
  // 5. This pass's screenshots (inside the evidence dir only, by real path) and the asset ids of the previous pass.
  let realEvidence: string;
  try { realEvidence = realpathSync(evidence); } catch { realEvidence = evidence; }
  const inside = (f: string) => { const r = path.relative(realEvidence, f); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
  const shots = v.checks.filter(c => c.shot).flatMap(c => {
    const file = path.resolve(evidence, c.shot!);
    let real: string, bytes: number;
    try { real = realpathSync(file); bytes = statSync(real).size; } catch { return []; }
    if (!inside(real)) return [];
    return [{ file: path.relative(io.cwd, file).split(path.sep).join('/'), surface: c.surface, check: c.name, ok: c.ok, expected: c.expected,
      observed: c.observed, bytes, oversize: bytes > SHOT_MAX_BYTES }];
  });
  let previous: string[] = [];
  const db = flag('db');
  if (db) {
    const base = task.replace(/-\d+$/, '');
    let published: string[] = [];
    try {
      const st = JSON.parse(readFileSync(path.resolve(io.cwd, db, 'state', `${base}.json`), 'utf8')) as { evidence?: { shots?: { id?: unknown }[] } };
      published = (st.evidence?.shots ?? []).map(s => s?.id).filter((x): x is string => typeof x === 'string' && x.length > 0);
    } catch { published = []; }
    // M5: only the assets this checkout knows no screenshot of the task links any more: those its kept uploads hold for
    // another run or another brief (the evidence keeps every round of the brief in progress). An id it does not know,
    // or any id without a readable kept list, cannot be judged here and stays.
    const main = mainCheckout(io.cwd);
    const project = resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger });
    const runId = runHolding(main, base, project);
    const brief = Number(/-(\d+)$/.exec(task)?.[1] ?? NaN);
    const kept = readKeptAssets(main, { project, task: base }, ledger) ?? [];
    const linked = (a: { runId: string | null; round: string }) => a.runId === runId && Number(a.round.split('-')[0]) === brief;
    const live = new Set(kept.filter(linked).map(a => a.id));
    const stale = new Set(kept.filter(a => !linked(a)).map(a => a.id));
    previous = published.filter(id => stale.has(id) && !live.has(id));
  }
  const big = shots.filter(s => s.oversize).length;
  const learnedText = Object.entries(learned).map(([n, k]) => `${n} (${k})`).join(', ');
  const say = es
    ? `Verificación ${v.result}: ${passed}/${total} comprobaciones${learnedText ? `; aprendido en ${learnedText}` : ''}`
      + `${shots.length ? `; ${shots.length} captura(s)${big ? ` (${big} de más de 2 MB)` : ''}` : ''}.`
    : `Verification ${v.result}: ${passed}/${total} checks${learnedText ? `; learned in ${learnedText}` : ''}`
      + `${shots.length ? `; ${shots.length} screenshot(s)${big ? ` (${big} over 2 MB)` : ''}` : ''}.`;
  return json({
    task, result: v.result, passed, total, learned, ...(skipped.length ? { skipped } : {}), proposals: v.proposals, cleanup,
    evidence: { mode, dir: path.relative(io.cwd, evidence).split(path.sep).join('/'), shots, previous }, commit, say,
  });
};
