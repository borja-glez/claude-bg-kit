// G-24: «Te necesita», what the person has to do now: open questions, proposals to decide, approvals without the owner's
// mark and decisions changed after their mark, the owner's or forge's policy's (only to the owner), open escalations,
// external blocks with their reason, recent deferred findings, a stalled run, an infinite run without its coordinator and
// a page older than the plan's waypoint. Pure: the page decides each entry from
// its model; the view says what to do and links the object. Nothing here changes shared state. The questions, the
// proposals and the stopped run come out of needsYou (src/lib/needs-you.ts), the rule that lens and the band share.
import { liveness } from '../lib/coordination.js';
import { isPlanId } from '../lib/ids.js';
import { needsYou, RUN_HALTS } from '../lib/needs-you.js';
import type { ForgeDocV2 } from '../lib/roadmap-doc.js';
import { withinRunTtl } from '../lib/run-ttl.js';
import type { MessageDoc, NoteDoc, TaskState } from '../lib/types.js';
import { compareVersions, WAYPOINT_VERSION } from '../lib/waypoint-version.js';
import { unmarkedReason } from './html.js';
import type { Model } from './model.js';

/** §4.3: what stops a run without closing it; each one names itself in «Te necesita» and in the banner of Ejecuciones (C33). */
export const HALTS = RUN_HALTS;
export type Halt = (typeof HALTS)[number];

/** How long the deferred findings of a done task stay in «Te necesita» (§2, decisión menor). */
export const DEFERRED_DAYS = 7;
const DAY_MS = 86_400_000;

export type Need =
  | { kind: 'question'; note: NoteDoc & { id: string } }
  | { kind: 'proposals'; count: number }
  | { kind: 'unowned'; count: number }
  /** Decisions that changed after their mark; `policy` when the mark was forge's policy's, not the owner's (carry 4b-3). */
  | { kind: 'changed'; count: number; policy: boolean }
  | { kind: 'escalation'; message: MessageDoc & { id: string } }
  | { kind: 'external'; task: string; title: string; reason: string | null }
  | { kind: 'deferred'; findings: number; tasks: { id: string; doneAt: string }[] }
  | { kind: 'stalled'; runId: string; reason: string | null; stop: Halt }
  | { kind: 'infinite'; since: string }
  | { kind: 'stale-page'; page: string; plan: string };

const forgeV2 = (st: TaskState | undefined): ForgeDocV2 | null => {
  const f = st?.forge;
  return f && 'v' in f && f.v === 2 ? f : null;
};

/** A done task whose deferred findings still ask for a look: not merged, done in the last 7 days. */
function recentDeferred(m: Model, id: string): { doneAt: string; findings: number } | null {
  const st = m.states[id];
  const f = forgeV2(st);
  if (!st || st.status !== 'done' || !st.doneAt || !f || !f.deferred.length || f.integration?.merged === true) return null;
  const at = Date.parse(st.doneAt);
  if (!Number.isFinite(at) || m.now - at > DEFERRED_DAYS * DAY_MS || at - m.now > DAY_MS) return null;
  return { doneAt: st.doneAt, findings: f.deferred.length };
}

/** The entries of «Te necesita», in the order of the table of §4.6.1. */
export function needsOf(m: Model, pageVersion: string = WAYPOINT_VERSION): Need[] {
  const out: Need[] = [];
  // The questions, the open proposals and the stopped run are needsYou's (the rule lens and the band share). The records
  // go in by position, not by id: the page's own order of m.notes is what comes out, and an id never has to match back.
  const r = m.run;
  const shared = needsYou({
    now: m.now,
    notes: Object.fromEntries(m.notes.map((n, i) => [String(i), n])),
    proposals: Object.fromEntries(m.proposals.map((p, i) => [String(i), p])),
    run: r ? { runId: r.runId, active: r.active, stopReason: r.stopReason ?? null, stallReason: r.stallReason ?? null,
      startedAt: r.startedAt ?? null, lastStepAt: r.lastStepAt ?? null, closedAt: r.closedAt ?? null, coordinatorOpen: null } : undefined,
  }).filter(n => !n.unverified);
  const asked = new Set(shared.filter(n => n.kind === 'question').map(n => Number(n.id)));
  m.notes.forEach((n, i) => { if (asked.has(i)) out.push({ kind: 'question', note: n }); });
  const open = shared.filter(n => n.kind === 'proposal').length;
  if (open) out.push({ kind: 'proposals', count: open });
  // §4.1: only to the owner, the approvals that will not count until they carry the owner's mark (the one shared predicate):
  // those without a mark, to confirm, and apart (review I2, re-review N1) those whose decision changed after the owner took
  // it (other text or another status), to decide again.
  if (m.isOwner === true) {
    const why = m.proposals.map(p => unmarkedReason(p.id, p, m.approvals));
    const unowned = why.filter(r => r === 'no-mark').length;
    // C26, carry 4b-3: a decision forge's policy took that changed afterwards was not the owner's; it goes on its own line.
    const changed = m.proposals.filter((_, i) => why[i] === 'changed');
    const policy = changed.filter(p => m.approvals && Object.hasOwn(m.approvals, p.id) && m.approvals[p.id]!.by === 'forge:policy').length;
    if (unowned) out.push({ kind: 'unowned', count: unowned });
    if (changed.length > policy) out.push({ kind: 'changed', count: changed.length - policy, policy: false });
    if (policy) out.push({ kind: 'changed', count: policy, policy: true });
  }
  for (const g of m.messages) if (g.type === 'escalation' && g.status === 'open') out.push({ kind: 'escalation', message: g });
  for (const t of m.plan.tasks) {
    const st = m.states[t.id];
    if (st?.status === 'blocked' && st.blockedBy?.includes('external')) out.push({ kind: 'external', task: t.id, title: t.title, reason: st.blockedReason ?? null });
  }
  const deferred = m.plan.tasks.flatMap(t => {
    const r = recentDeferred(m, t.id);
    return r && m.seenDeferred?.[t.id] !== r.doneAt ? [{ id: t.id, ...r }] : [];
  });
  if (deferred.length) out.push({ kind: 'deferred', findings: deferred.reduce((n, x) => n + x.findings, 0), tasks: deferred.map(({ id, doneAt }) => ({ id, doneAt })) });
  // §4.3: a run that stopped without being closed, within its 24 h.
  const stop = r ? HALTS.find(x => x === r.stopReason) : undefined;
  if (r && stop && shared.some(n => n.kind === 'run' || n.kind === 'untrusted-commands')) out.push({ kind: 'stalled', runId: r.runId, reason: r.stallReason ?? null, stop });
  // G-08: an active infinite run whose coordinator's lease stopped, within its 24 h (the same rule, carry 7).
  const c = m.infinite?.active === true ? m.infinite.coordinator : null;
  if (c && liveness(m.now, c.leaseUntil) === 'stopped' && withinRunTtl(m.now, Date.parse(c.leaseUntil))) out.push({ kind: 'infinite', since: c.seenAt });
  // G-13: the plan was synced by a newer waypoint than the one that built this page.
  const synced = m.meta?.waypointVersion;
  if (synced && compareVersions(pageVersion, synced) < 0) out.push({ kind: 'stale-page', page: pageVersion, plan: synced });
  return out;
}

/** The key of the viewer's seen marks in localStorage. */
export const seenKey = (project: string): string => `wp-seen-deferred:${project}`;

/** The seen marks a localStorage value holds (task → doneAt); anything else is left out. */
export function parseSeen(raw: string | null): Record<string, string> {
  let v: unknown;
  try { v = raw ? JSON.parse(raw) : null; } catch { return {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(v as Record<string, unknown>)) {
    if (isPlanId(id) && typeof at === 'string' && at.length <= 40 && Number.isFinite(Date.parse(at))) out[id] = at;
  }
  return out;
}

/** The marks that still mean something: the task is still a recent, unmerged, done task with the same doneAt. */
export function pruneSeen(seen: Record<string, string>, m: Model): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(seen)) if (recentDeferred(m, id)?.doneAt === at) out[id] = at;
  return out;
}
