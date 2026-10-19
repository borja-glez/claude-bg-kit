import type { Command } from '../context.js';
import { existsSync, statSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readEvents, appendEvent, ledgerRoot } from '../../ledger.js';
import { updateExecution } from '../../execution.js';
import { readFlow, flowDirs } from '../../flow.js';
import { samePath } from '../../../lib/worktree.js';
import { planLocale } from '../../../lib/locale.js';
import { loadConfig, NAME } from '../../config.js';
import { parseVerifyFile } from '../../verdict.js';
import { UsageError } from '../errors.js';
import { readKeptAssets, runHolding } from '../../roadmap-sources.js';
import { eventsOf, isTask, resolveProject } from '../../task-ref.js';
import { mainCheckout } from '../../local.js';
import { surfaceFile, type NoteSkip } from '../../surfaces.js';
import { addProposal, defectProposal, defectUnsafe, ProposalInputError } from '../../proposals.js';
import type { ProposalDoc } from '../../../lib/proposals.js';
import { logVerifyResult, learnSurface, cleanupEvidence } from '../shared.js';

type DefectsOut = {
  added: { id: string; doc: ProposalDoc }[];
  skipped: { title: string; why: 'rejected' | 'open' | 'looks-secret' | 'looks-like-instruction'; similar: string }[];
};

/** A screenshot above this is converted to JPEG before it is uploaded to the roadmap. */
const SHOT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * --flow <folder> (K2-13) closes a flow pass instead: verify-flow, execution.json flow, and the failed checks.
 */
export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, ts } = ctx;
  // Measure 10: what `## After the verdict` did in about ten steps, in one call. The skill keeps the upload of the
  // shots and the `update state/T` with their urls, and shows the proposals to the person.
  // K2-13: --flow <folder> closes a flow pass: its verify.json and evidence/ are in that folder, its id is the pass's. It is
  // the coordinator's, and only a folder verify-plan --run opened (its flow.json in the run's own flow-<runId>-<n>).
  const flowArg = flag('flow');
  if (has('flow') && !flowArg) throw new UsageError('verify-close: --flow needs the folder of a flow pass');
  if (flowArg && !samePath(ledgerRoot(io.cwd), io.cwd)) throw new UsageError('verify-close: --flow is the coordinator\'s, from the main checkout');
  const flowDir = flowArg ? path.resolve(io.cwd, flowArg) : null;
  const read = flowDir ? readFlow(flowDir) : null;
  const pass = read && flowDir && path.basename(flowDir) === read.id && flowDirs(io.cwd, read.runId).some(d => samePath(d, flowDir)) ? read : null;
  if (flowArg && !pass) throw new UsageError(`verify-close: ${flowArg} is not a flow pass (no flow.json from FORGE verify-plan --run)`);
  const task = pass ? pass.id : flag('task');
  const dirArg = pass ? flowArg : flag('dir');
  const evArg = pass && flowArg ? path.join(flowArg, 'evidence') : flag('evidence');
  if (!task || !dirArg || !evArg) throw new UsageError('verify-close: --task, --dir and --evidence are required (or --flow <folder>)');
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
  const notesSkipped: { surface: string; note: string; why: NoteSkip }[] = [];
  for (const [name, list] of notes) {
    if (!NAME.test(name)) { skipped.push({ surface: name.slice(0, 80), reason: 'not a surface name' }); continue; }
    const r = learnSurface(io, repoDir, name, list, es ? 'Aprendido' : 'Learned', task);
    if ('reason' in r) { skipped.push({ surface: name, reason: r.reason }); continue; }
    // K2-11: the notes the filter dropped are named; a surface that gained none is neither learned nor committed.
    notesSkipped.push(...r.skipped.map(s => ({ surface: name, ...s })));
    if (!r.added) continue;
    learned[name] = r.count;
    commit.push(surfaceFile(name));
  }
  // 2. The processes the verify agent left running.
  const cleanup = cleanupEvidence(evidence, io.cwd);
  // 3. The result, once: closing again (or after review-close or verify-result logged it) adds no event.
  const passed = v.checks.filter(c => c.ok).length, total = v.checks.length;
  // The `evidence` field logVerifyResult writes: only for a `reviews-<n>-<k>` dir.
  const relDir = path.relative(io.cwd, dir).split(path.sep).join('/');
  const evRel = relDir.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
  const evField = evRel !== relDir ? evRel : undefined;
  const ledger = readEvents(io.cwd);
  if (pass) {
    // K2-13: a flow pass logs verify-flow, never verify (that would close a light task's status), once per result, and
    // is kept in execution.json for the next pass and for runs/<runId>.
    const logged = ledger.filter(e => e.kind === 'verify-flow' && e.dir === relDir).at(-1);
    if (!logged || logged.result !== v.result) {
      appendEvent(io.cwd, { ts: ts(), kind: 'verify-flow', runId: pass.runId, result: v.result, passed, total, dir: relDir });
    }
    updateExecution(mainCheckout(io.cwd), cur => (cur && cur.runId === pass.runId ? { ...cur, flow: { sha: pass.head, at: ts(), result: v.result } } : null));
  } else {
    const last = eventsOf(ledger, { project: resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger }), task })
      .filter(e => e.kind === 'verify' && isTask(e, task) && typeof e.result === 'string').at(-1);
    if (!last || last.result !== v.result || last.passed !== passed || last.total !== total || last.evidence !== evField) logVerifyResult(io.cwd, ts(), task, dir, v);
  }
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
  // 6. K2-12: each defect the agent saw outside the brief becomes a pending proposal in the main checkout (C7: only the
  // roadmap's owner approves it); one that repeats an open or rejected proposal is not added again. A defect's text comes
  // from an agent that read untrusted pages, so one that reads as an instruction or holds a secret is counted, not proposed.
  const shotOf = (shot: string | null): string | null => {
    if (!shot) return null;
    const file = path.resolve(evidence, shot);
    try { return inside(realpathSync(file)) ? path.relative(io.cwd, file).split(path.sep).join('/') : null; } catch { return null; }
  };
  const defects: DefectsOut = { added: [], skipped: [] };
  for (const d of v.defects) {
    const unsafe = defectUnsafe(d);
    // A secret is never echoed, not even in the title that names it.
    if (unsafe) { defects.skipped.push({ title: unsafe === 'looks-secret' ? '' : d.title.slice(0, 80), why: unsafe, similar: '' }); continue; }
    try {
      const r = addProposal(mainCheckout(io.cwd), defectProposal(d, task, shotOf(d.shot), es),
        { ts: ts(), author: 'forge:verify', now: io.now(), rand: io.rand ?? Math.random, from: 'verify' });
      if (r.ok) defects.added.push({ id: r.id, doc: r.doc });
      else defects.skipped.push({ title: d.title.slice(0, 80), why: r.why, similar: r.similar });
    } catch (e) { if (!(e instanceof ProposalInputError)) throw e; }
  }
  const defectsText = defects.added.length
    ? (es ? `; ${defects.added.length} defecto(s) propuesto(s)` : `; ${defects.added.length} defect(s) proposed`) : '';
  const big = shots.filter(s => s.oversize).length;
  const learnedText = Object.entries(learned).map(([n, k]) => `${n} (${k})`).join(', ');
  const say = es
    ? `Verificación ${v.result}: ${passed}/${total} comprobaciones${learnedText ? `; aprendido en ${learnedText}` : ''}`
      + `${shots.length ? `; ${shots.length} captura(s)${big ? ` (${big} de más de 2 MB)` : ''}` : ''}${defectsText}.`
    : `Verification ${v.result}: ${passed}/${total} checks${learnedText ? `; learned in ${learnedText}` : ''}`
      + `${shots.length ? `; ${shots.length} screenshot(s)${big ? ` (${big} over 2 MB)` : ''}` : ''}${defectsText}.`;
  return json({
    task, result: v.result, passed, total, learned, ...(skipped.length ? { skipped } : {}),
    ...(notesSkipped.length ? { notesSkipped } : {}), proposals: v.proposals, defects, cleanup,
    ...(pass ? {
      flow: { runId: pass.runId, sha: pass.head, result: v.result },
      failed: v.checks.filter(c => !c.ok).map(c => ({ surface: c.surface, check: c.name, expected: c.expected, observed: c.observed, env: c.env })),
    } : {}),
    evidence: { mode, dir: path.relative(io.cwd, evidence).split(path.sep).join('/'), shots, previous }, commit, say,
  });
};
