// Helpers every view of the roadmap page shares: escaping, relative times, dates, labels and small marks. Values from the
// shared database are untrusted: whatever lands in an attribute or a lookup is whitelisted here.
import { escalationCandidates, liveness } from '../lib/coordination.js';
import { NOTE_TYPES } from '../lib/notes.js';
import { ownerCheck, type ApprovalDoc, type ProposalDoc } from '../lib/proposals.js';
import { TRACK_COLORS, type EventType, type MessageType, type NoteType, type TaskState, type TaskStatus } from '../lib/types.js';
import type { Dict } from './i18n.js';
import type { Model } from './model.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);
export const mins = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60000));
/** A usable past time in ms: a valid date not more than 2 min ahead of now (clock skew), else null. */
export const pastMs = (iso: string | null | undefined, now: number): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && t - now <= 2 * 60000 ? t : null;
};
export const ICON: Record<EventType, string> = { claimed: '◎', started: '▶', done: '✓', blocked: '⚠', unblocked: '↺', commit: '●', note: '✎', plan_changed: '≡', message: '✉' };
const STATUSES = ['free', 'claimed', 'in_progress', 'blocked', 'done', 'orphaned'] as const;
export const safeColor = (c: unknown): string => (TRACK_COLORS as readonly string[]).includes(c as string) ? (c as string) : 'blue';
export const safeStatus = (s: unknown): TaskStatus => (STATUSES as readonly string[]).includes(s as string) ? (s as TaskStatus) : 'free';
export const safeType = (t: unknown): EventType => (Object.prototype.hasOwnProperty.call(ICON, t as string) ? (t as EventType) : 'note');
const MSG_TYPES: readonly MessageType[] = ['overlap_warning', 'handoff_request', 'delegate', 'reply', 'escalation'];
export const safeMsgType = (t: unknown): MessageType => (MSG_TYPES as readonly string[]).includes(t as string) ? (t as MessageType) : 'reply';
export const safeNote = (t: unknown): NoteType => ((NOTE_TYPES as readonly string[]).includes(t as string) ? (t as NoteType) : 'idea');
export const oneOf = <T extends string>(list: readonly T[], v: unknown, dflt: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : dflt);
export const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
export const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** G-01: the kinds of relative text the 30 s tick rewrites in place. */
export type RelKind = 'ago' | 'lasts' | 'hb' | 'dur';
/** The text of a relative time: «hace X» (ago, hb), «lleva N min» (lasts) or «2 h 05 min» (dur); for a junk or future time, '—' (hb) or ''. */
export function relText(d: Dict, kind: RelKind, ts: string, now: number): string {
  const t = pastMs(ts, now);
  if (t === null) return kind === 'hb' ? '—' : '';
  return kind === 'lasts' ? d.lasts(mins(t, now)) : kind === 'dur' ? d.dur(mins(t, now)) : d.ago(mins(t, now));
}
/** A relative time the tick can rewrite: its kind and its timestamp travel with it. */
export const rel = (d: Dict, kind: RelKind, ts: string, now: number): string =>
  `<span data-rel="${kind}" data-ts="${esc(ts)}">${esc(relText(d, kind, ts, now))}</span>`;
export const hhmm = (iso: string | undefined) => { const t = iso ? new Date(iso) : null; return t && Number.isFinite(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '—'; };
export const liveDot = (l: 'alive' | 'silent' | 'stopped') => `<span class="dot live-${l}">●</span>`;

/** H-09: who runs a task: the role its session says, else the run's mode (subagents: the coordinator; sessions: an
 *  executor; manual: by hand); null without either. */
export function roleOf(m: Model, st: TaskState): 'coordinator' | 'executor' | 'manual' | null {
  const sid = st.exec?.by ?? st.owner;
  const own = sid ? m.sessions[sid]?.role : undefined;
  if (own) return own;
  const mode = st.exec?.mode;
  return mode === 'subagents' ? 'coordinator' : mode === 'sessions' ? 'executor' : mode === 'manual' ? 'manual' : null;
}

/** The «coordinadora · subagentes · agent · etapa · 7 min» line of a task with an exec block, with its liveness dot. */
export function execLine(m: Model, d: Dict, exec: NonNullable<TaskState['exec']>, role: ReturnType<typeof roleOf> = null): string {
  const l = liveness(m.now, exec.leaseUntil);
  const since = pastMs(exec.since, m.now);
  const parts = [role ? d.run.role[role] : null, d.run.mode[exec.mode] ?? exec.mode, exec.agent, d.run.stage[exec.stage] ?? exec.stage];
  return `${liveDot(l)} ${parts.filter(Boolean).map(p => esc(String(p))).join(' · ')}${since !== null ? ` · ${rel(d, 'lasts', exec.since, m.now)}` : ''}`;
}

/** An in-progress task whose executor's lease stopped. */
export const isOrphan = (m: Model, st: TaskState | undefined): boolean =>
  !!st?.exec && st.status === 'in_progress' && liveness(m.now, st.exec.leaseUntil) === 'stopped';

export function trackTag(m: Model, trackId?: string | null): string {
  const tr = m.plan.tracks.find(t => t.id === trackId);
  return tr ? `<span class="tag c-${safeColor(tr.color)}">${esc(tr.name)}</span>` : '';
}

export function fmt(iso: string, loc: string, withDate = true): string {
  const opts: Intl.DateTimeFormatOptions = withDate ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  try { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString(loc, opts); } catch { return ''; }
}

/** «Fin previsto: entre A y B» for a forecast range (insights.forecast), as the strip, the band and the analysis say it. */
export function forecastTitle(d: Dict, f: { from: number; to: number }, loc: string): string {
  return d.insights.forecastRange(fmt(new Date(f.from).toISOString(), loc), fmt(new Date(f.to).toISOString(), loc));
}

/** The verification marker next to a task: green when the evidence passed, red otherwise; empty without evidence. */
export function eviMark(m: Model, d: Dict, id: string): string {
  const ev = m.states[id]?.evidence;
  return ev ? `<span class="evi ${ev.result === 'pass' ? 'ok' : 'del'}" title="${esc(d.verify.title)}">▣</span>` : '';
}

/**
 * §4.1: why the owner's mark does not back an approval (approved or auto_approved, without a task yet), as ownerCheck says
 * it without the ledger's `last`, which the page does not have. Such a proposal never becomes a task. The page sorts the
 * cases itself (forge's ownerCheck calls both of them 'no-mark' or 'edited'):
 * - 'no-mark': no mark at all under its pid (an approval from before the marks existed, §4.1): the owner confirms it with
 *   [Confirmar].
 * - 'changed' (review I2, re-review N1): a mark exists and does not back it, of another status (a rejection someone
 *   turned into an approval, an approval turned into an auto-approval) or of other text: the decision changed after the
 *   owner took it. No one-click confirm: the owner decides it again with the text in view (Approve or Reject).
 * The one rule the proposal card, [Confirmar], the decision and «Te necesita» share. Null when the mark backs it, and until
 * the marks arrive (`approvals` undefined): the page does not warn about what it cannot know.
 */
export function unmarkedReason(pid: string, p: ProposalDoc, approvals: Readonly<Record<string, ApprovalDoc>> | undefined): 'no-mark' | 'changed' | null {
  if (!approvals || (p.status !== 'approved' && p.status !== 'auto_approved') || p.taskId !== undefined) return null;
  const a = Object.prototype.hasOwnProperty.call(approvals, pid) ? approvals[pid] : undefined;
  if (!a) return 'no-mark';
  return ownerCheck(pid, p, a) === 'ok' ? null : 'changed';
}
/** Whether the owner's mark does not back the approval, for either reason (unmarkedReason). */
export const unmarked = (pid: string, p: ProposalDoc, approvals: Readonly<Record<string, ApprovalDoc>> | undefined): boolean =>
  unmarkedReason(pid, p, approvals) !== null;

export function authorLabel(m: Model, d: Dict, author: string): string {
  if (m.me && author === m.me) return d.you;
  if (author === 'user') return d.aUser;
  if (author.startsWith('user:')) return m.profiles[author.slice(5)] || d.someUser;
  if (author.startsWith('session:')) return `${d.claude} · ${author.slice(8)}`;
  return author;
}

/** Sessions involved in an unresolved disagreement: escalation candidates or open escalation messages. */
export function escalatedSessions(m: Model): Set<string> {
  const out = new Set<string>();
  const byId = Object.fromEntries(m.messages.map(x => [x.id, x]));
  for (const c of escalationCandidates(byId)) c.sessions.forEach(s => out.add(s));
  for (const g of m.messages) if (g.type === 'escalation' && g.status === 'open') { out.add(g.from); out.add(g.to); }
  return out;
}
