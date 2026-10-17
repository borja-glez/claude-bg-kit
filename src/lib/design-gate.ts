// The approval gate of auto mode (spec §5.5): from a design's changelog and its critiques, whether it can be approved
// without asking, and what the next critic must not raise again. Pure and deterministic, with no Node imports (the
// band's mod uses it too); the waypoint CLI reads the files.
import { entryKind, type ChangelogEntry } from './history.js';
import type { Critique, Proposal } from './critique.js';
import { changedSections, designBody } from './design.js';
import { clean } from './decisions.js';

/** The critique of one round: null when its file is not a valid critique. */
export interface GateCritique { round: number; critique: Critique | null }
/** A proposal of some round that was neither applied, resolved in an interview, folded in by a rewrite of its round, nor dismissed. */
export interface Pending { round: number; n: number; severity: Proposal['severity']; section: string; problem: string }
/** K3-05: a proposal the person set aside, with their reason when they gave one. */
export interface DismissedItem { n: number; reason?: string }
/** dismissed.json: round → the proposals the person set aside, by number. */
export type Dismissed = Record<number, DismissedItem[]>;
/** What the next critic must not raise again: set aside (with the reason), resolved in an interview, or already applied. */
export interface GateDismissed { round: number; n: number; section: string; problem: string; reason?: string }
export interface GateResolved { round: number; n: number; section: string; problem: string }
export interface GateApplied { round: number; n: number; section: string; change: string }
export interface Gate {
  version: number; rounds: number; latestRound: number | null; latestCritiqueVersion: number | null;
  criticalPending: { round: number; n: number }[]; majorPending: { round: number; n: number }[]; invalid: number[];
  needsVerify: boolean; canAutoApprove: boolean;
  pending: Pending[]; pendingCounts: { critical: number; major: number; minor: number };
  dismissed: GateDismissed[]; resolved: GateResolved[]; applied: GateApplied[];
  /** How many older entries each list left out (see GATE_LIST_MAX); present only when not 0. */
  dismissedMore?: number; resolvedMore?: number; appliedMore?: number;
}
/** K3-05: the longest reason kept for a dismissal, on one clean line. */
export const REASON_MAX = 300;
/** The newest entries kept in each list the gate hands the critic, and the code points kept of each of their texts. */
export const GATE_LIST_MAX = 40;
export const GATE_TEXT_MAX = 300;
/** A critique's text as one clean line of GATE_TEXT_MAX code points at most. */
const line = (s: string): string => Array.from(clean(s, Number.MAX_SAFE_INTEGER)).slice(0, GATE_TEXT_MAX).join('');

/** Notes written before `applied` and `rewrite` existed, in English or Spanish: "round 1: applied 1,3 — …",
 *  "ronda 1: aplicadas 1, 3 y 5 — …"; "round 2: rewrite — …", "ronda 2: reescritura — …". */
const APPLIED_NOTE = /\b(?:round|ronda)\s+(\d+)\s*:\s*(?:applied|aplicad[ao]s?)\s+(\d+(?:\s*(?:,|y|and)\s*\d+)*)/gi;
const REWRITE_NOTE = /^\s*(?:round|ronda)\s+(\d+)\s*:\s*(?:rewrite|reescritura|reescrit[ao])/i;
/** An entry without the structured fields: its note is the only record of what it applied. */
const legacy = (e: ChangelogEntry) => e.applied === undefined && e.rewrite === undefined;

/** The proposal numbers the changelog records as applied in round R: each entry's `applied`, else its old note. */
export function appliedIn(changelog: ChangelogEntry[], round: number): Set<number> {
  const out = new Set<number>();
  for (const e of changelog) {
    if (e.applied) { for (const n of e.applied[round] ?? []) out.add(n); continue; }
    if (!legacy(e)) continue;
    for (const m of e.note.matchAll(APPLIED_NOTE)) {
      if (Number(m[1]) !== round) continue;
      for (const n of m[2].split(/\s*(?:,|y|and)\s*/i)) if (/^\d+$/.test(n)) out.add(Number(n));
    }
  }
  return out;
}

/** Whether a rewrite folded in round R's proposals: an entry of round R with `rewrite: true`, or an old note "round R: rewrite". */
export function rewroteRound(changelog: ChangelogEntry[], round: number): boolean {
  return changelog.some(e => {
    if (e.round !== round) return false;
    if (e.rewrite === true) return true;
    if (!legacy(e)) return false;
    const m = REWRITE_NOTE.exec(e.note);
    return !!m && Number(m[1]) === round;
  });
}

/** K3-09: the version of the first changelog entry that applied proposal n of round R, or null. */
export function appliedVersion(changelog: ChangelogEntry[], round: number, n: number): number | null {
  for (const e of changelog) if (appliedIn([e], round).has(n)) return e.version;
  return null;
}

/** K3-02: the proposal numbers of round R that an interview resolved (the changelog's `resolved`). */
export function resolvedIn(changelog: ChangelogEntry[], round: number): Set<number> {
  return new Set(changelog.flatMap(e => (e.resolved ?? []).filter(x => x.round === round).map(x => x.n)));
}

/**
 * dismissed.json read tolerantly, in its two shapes: `{"1": [2, 5]}` (before K3-05) and `{"1": [{"n": 2, "reason": "…"},
 * {"n": 5}]}`. Junk is nothing dismissed; only positive integer numbers of numeric rounds count; a reason becomes one
 * clean line of REASON_MAX characters at most, and one that is not text, or is blank, is none.
 */
export function parseDismissed(text: string | null | undefined): Dismissed {
  let raw: unknown;
  try { raw = JSON.parse(text ?? ''); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Dismissed = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(k) || !Array.isArray(v)) continue;
    const byN = new Map<number, DismissedItem>();
    for (const x of v as unknown[]) {
      const item = x && typeof x === 'object' ? (x as { n?: unknown; reason?: unknown }) : null;
      const n = item ? item.n : x;
      if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) continue;
      const reason = item && typeof item.reason === 'string' ? clean(item.reason, REASON_MAX) : '';
      byN.set(n, reason ? { n, reason } : (byN.get(n) ?? { n }));
    }
    if (byN.size) out[Number(k)] = [...byN.values()].sort((a, b) => a.n - b.n);
  }
  return out;
}

/** `d` with `ns` of round R set aside: a number already there keeps its reason unless `reason` gives a new one. */
export function mergeDismissed(d: Dismissed, round: number, ns: number[], reason?: string): Dismissed {
  const why = reason ? clean(reason, REASON_MAX) : '';
  const byN = new Map((d[round] ?? []).map(x => [x.n, x] as const));
  for (const n of ns) byN.set(n, why ? { n, reason: why } : (byN.get(n) ?? { n }));
  return { ...d, [round]: [...byN.values()].sort((a, b) => a.n - b.n) };
}

/** Every proposal of every valid critique still waiting for a decision, by round then number. */
export function pendingProposals(changelog: ChangelogEntry[], critiques: GateCritique[], dismissed: Dismissed = {}): Pending[] {
  const out: Pending[] = [];
  for (const { round, critique } of [...critiques].sort((a, b) => a.round - b.round)) {
    if (!critique || rewroteRound(changelog, round)) continue;
    const decided = new Set([...appliedIn(changelog, round), ...resolvedIn(changelog, round), ...(dismissed[round] ?? []).map(x => x.n)]);
    for (const p of critique.proposals) {
      if (!decided.has(p.n)) out.push({ round, n: p.n, severity: p.severity, section: p.section, problem: p.problem });
    }
  }
  return out;
}

/** K3-06: the texts that tell whether a critic read the current body: the history by version and the design file. */
export interface GateTexts { history?: Record<number, string>; current?: string }

/**
 * K3-06: whether the design changed after its latest valid critique without any critic reading it: that critique is of
 * an older version and a later entry changed the body. The bodies decide (K3-03), so a change of the front matter alone,
 * such as an approval, is none. Without the texts, any later entry but an approval counts as a change. Without a
 * critique there is nothing to verify (a first round is due).
 */
export function needsVerifyOf(changelog: ChangelogEntry[], critiques: GateCritique[], texts: GateTexts = {}): boolean {
  const top = [...critiques].filter(c => c.critique !== null).sort((a, b) => b.round - a.round)[0]?.critique;
  if (!top) return false;
  const version = changelog[changelog.length - 1]?.version ?? 0;
  if (top.version >= version) return false;
  if (!changelog.some(e => e.version > top.version && entryKind(e) !== 'approve')) return false;
  const before = texts.history?.[top.version];
  const after = texts.current ?? texts.history?.[version];
  if (before === undefined || after === undefined) return true;
  const d = changedSections(designBody(before), designBody(after));
  return d.changed.length > 0 || d.removed.length > 0;
}

/**
 * Approvable without asking when the latest critique is valid and not of a version newer than the design's, no critical
 * nor major proposal of any round is left pending, and no applied change is unread by a critic (K3-06). A design with
 * no critique (one just imported) never is. It also lists, round by round, what the next critic must not raise again
 * (K3-04, K3-05, K3-02).
 */
export function designGate(changelog: ChangelogEntry[], critiques: GateCritique[], dismissed: Dismissed = {}, texts: GateTexts = {}): Gate {
  const version = changelog[changelog.length - 1]?.version ?? 0;
  const latestRound = critiques.length ? Math.max(...critiques.map(c => c.round)) : null;
  const latest = latestRound === null ? null : critiques.find(c => c.round === latestRound)?.critique ?? null;
  const pending = pendingProposals(changelog, critiques, dismissed);
  const criticalPending = pending.filter(p => p.severity === 'critical').map(p => ({ round: p.round, n: p.n }));
  const majorPending = pending.filter(p => p.severity === 'major').map(p => ({ round: p.round, n: p.n }));
  const needsVerify = needsVerifyOf(changelog, critiques, texts);
  const count = (s: Pending['severity']) => pending.filter(p => p.severity === s).length;
  const latestCritiqueVersion = latest?.version ?? null;
  const valid = [...critiques].sort((a, b) => a.round - b.round).flatMap(c => (c.critique ? [{ round: c.round, proposals: c.critique.proposals }] : []));
  const gone: GateDismissed[] = [];
  const solved: GateResolved[] = [];
  const done: GateApplied[] = [];
  for (const { round, proposals } of valid) {
    const applied = appliedIn(changelog, round);
    const resolved = resolvedIn(changelog, round);
    const set = new Map((dismissed[round] ?? []).map(x => [x.n, x] as const));
    for (const p of proposals) {
      const section = () => line(p.section);
      if (applied.has(p.n)) done.push({ round, n: p.n, section: section(), change: line(p.change) });
      if (resolved.has(p.n)) solved.push({ round, n: p.n, section: section(), problem: line(p.problem) });
      const x = set.get(p.n);
      if (x) gone.push({ round, n: p.n, section: section(), problem: line(p.problem), ...(x.reason ? { reason: x.reason } : {}) });
    }
  }
  // The critic's prompt must stay bounded: the newest GATE_LIST_MAX of each list (by round, then number), the rest counted.
  const newest = <T>(list: T[]) => list.slice(-GATE_LIST_MAX);
  const more = (list: unknown[]) => Math.max(0, list.length - GATE_LIST_MAX);
  return {
    version, rounds: valid.length, latestRound, latestCritiqueVersion, criticalPending, majorPending,
    invalid: critiques.filter(c => c.critique === null).map(c => c.round).sort((a, b) => a - b),
    needsVerify,
    canAutoApprove: latest !== null && criticalPending.length === 0 && majorPending.length === 0 && !needsVerify
      && latestCritiqueVersion !== null && latestCritiqueVersion <= version,
    pending, pendingCounts: { critical: count('critical'), major: count('major'), minor: count('minor') },
    dismissed: newest(gone), resolved: newest(solved), applied: newest(done),
    ...(more(gone) ? { dismissedMore: more(gone) } : {}),
    ...(more(solved) ? { resolvedMore: more(solved) } : {}),
    ...(more(done) ? { appliedMore: more(done) } : {}),
  };
}
