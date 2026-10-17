// Step 4 of §4.6: what lens says in one line where its band and its pane do not reach: the status line under the
// prompt, the spinner's message, a mode label, toasts when this session's work moves, and a notification when a run of
// its own ends. Pure: register.tsx calls it with the last model built; nothing here reads a file.
import type { PanelModel } from './model.js';
import type { Role } from './activities.js';
import { fitParts, joinParts, type BandPart } from '../mod/band-fit.js';
import { fmtUsd } from './view.js';
import { activityTag, ownInProgress } from './lens-band.js';

type Row = PanelModel['activities'][number];
type Findings = { critical: number; important: number; minor: number };

export interface SurfaceTexts {
  stage: Readonly<Record<string, string>>; validating: string; integrating: string; integratedN: string;
  subagentsN: (n: number) => string;
  toastAccepted: (task: string, round: number | null) => string;
  toastVerdict: (task: string, action: string, counts: string) => string;
  toastRound: (task: string, n: number) => string;
  toastIntegrated: (task: string, done: number, total: number) => string;
  runFinished: (done: number, total: number) => string;
  runStopped: (why: string) => string;
}

/** The status line is fitted to this many columns. */
export const STATUS_COLUMNS = 100;
/** A run of its own that ran this long or more is notified when it ends. */
export const RUN_NOTIFY_AFTER_S = 20 * 60;
const VALIDATING = new Set(['prep', 'review-prep', 'validate']);

/** «T002 revisar r2», «T003 validando»: a task in progress in words, as the status line and the spinner say it. */
export function activityText(a: Row, t: SurfaceTexts): string {
  const doing = a.job
    ? (VALIDATING.has(a.job.name) ? t.validating : a.job.name === 'integrate' ? t.integrating : a.job.name)
    : a.stage ? t.stage[a.stage] ?? a.stage : null;
  return [a.task, doing, a.round ? `r${a.round}` : null].filter(Boolean).join(' ');
}

/** Whether this session has work of its own going on: a forge task in progress, or a run it owns still active. */
export function ownActive(m: PanelModel | null | undefined, role: Role): boolean {
  return !!m && (ownInProgress(m).length > 0 || (role === 'owner' && m.execution?.active === true));
}

/** The status line, «lens · T002 revisar r2 · 3 subagentes · 1,20 $», fitted to 100 columns; null without work of its own. */
export function statusText(m: PanelModel | null | undefined, t: SurfaceTexts, role: Role): string | null {
  if (!m || !ownActive(m, role)) return null;
  const parts: BandPart[] = [{ key: 'head', text: 'lens', prio: 9 }];
  for (const a of ownInProgress(m)) parts.push({ key: `slot:${a.key}`, text: activityText(a, t), short: activityTag(a), prio: 4 });
  const run = role === 'owner' && m.execution?.active ? m.execution : null;
  if (run) parts.push({ key: 'run', text: `► ${run.integrated}/${run.total} ${t.integratedN}`, short: `► ${run.integrated}/${run.total}`, prio: 5 });
  if (m.subagents.length) parts.push({ key: 'agents', text: t.subagentsN(m.subagents.length), short: `◎ ${m.subagents.length}`, prio: 6 });
  if (m.usage) parts.push({ key: 'cost', text: fmtUsd((m.usage.session ?? m.usage).costUsd, m.locale), prio: 7 });
  return joinParts(fitParts(parts, STATUS_COLUMNS).shown);
}

/** The spinner's message while a turn runs: «T002 · revisar r2», for the expanded task of this session, else its first. */
export function spinnerText(m: PanelModel | null | undefined, t: SurfaceTexts): string | null {
  const acts = ownInProgress(m);
  const a = acts.find(x => x.expanded) ?? acts[0];
  if (!a?.task) return null;
  const rest = activityText({ ...a, task: null }, t);
  return rest ? `${a.task} · ${rest}` : a.task;
}

/** The mode labels lens adds: «forge auto» for a task of its own in auto mode, «∞ 2/5» while the infinite run is active. */
export function modeLabels(m: PanelModel | null | undefined): string[] {
  if (!m) return [];
  const out: string[] = [];
  if (ownInProgress(m).some(a => a.autonomy === 'auto')) out.push('forge auto');
  const inf = m.infinite;
  if (inf?.active) out.push(`∞ ${inf.cycle}${inf.cyclesMax !== null ? `/${inf.cyclesMax}` : ''}`);
  return out;
}

// K4-05: the findings by severity, as the verdict chip says them; never the score.
const counts = (f: Findings | null | undefined): string =>
  (f ? [`${f.critical} C`, `${f.important} I`, ...(f.minor > 0 ? [`${f.minor} m`] : [])].join(' · ') : '');

/**
 * What moved between two models, for this session's own work only: a new verdict (never its score), a review round
 * from the second on, and, in a run it owns, a task integrated; and a run of its own that ran 20 minutes or more and
 * stopped, for a notification. No previous model, nothing moved.
 */
export function surfaceEvents(prev: PanelModel | null, next: PanelModel, role: Role, t: SurfaceTexts): { toasts: string[]; ended: { runId: string; text: string } | null } {
  if (!prev) return { toasts: [], ended: null };
  const toasts: string[] = [];
  const before = new Map(prev.activities.map(a => [a.key, a] as const));
  for (const a of next.activities) {
    if (a.kind !== 'forge' || a.owner !== 'own' || !a.task) continue;
    const b = before.get(a.key);
    if (!b) continue;
    const v = a.verdict;
    if (v && (!b.verdict || b.verdict.action !== v.action || (b.verdict.round ?? null) !== (v.round ?? null))) {
      toasts.push(v.action === 'accept' ? t.toastAccepted(a.task, v.round ?? a.round ?? null) : t.toastVerdict(a.task, v.action, counts(v.findings)));
    }
    if (a.round !== null && a.round >= 2 && a.round !== b.round) toasts.push(t.toastRound(a.task, a.round));
  }
  const x = next.execution;
  const y = prev.execution;
  const same = role === 'owner' && !!x && !!y && x.runId === y.runId;
  if (same && x!.integrated > y!.integrated) {
    const seen = new Set((y!.finished ?? []).map(f => f.task));
    const task = (x!.finished ?? []).find(f => !seen.has(f.task))?.task;
    if (task) toasts.push(t.toastIntegrated(task, x!.integrated, x!.total));
  }
  let ended: { runId: string; text: string } | null = null;
  if (same && y!.active && !x!.active && (x!.elapsedSeconds ?? 0) >= RUN_NOTIFY_AFTER_S) {
    const done = x!.total > 0 && x!.integrated >= x!.total;
    ended = { runId: x!.runId, text: done ? t.runFinished(x!.integrated, x!.total) : t.runStopped(x!.stallReason ?? x!.stopReason ?? '') };
  }
  return { toasts, ended };
}
