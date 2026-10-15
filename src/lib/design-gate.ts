// The approval gate of auto mode (spec §5.5): from a design's changelog and its critiques, whether it can be approved
// without asking. Pure and deterministic, with no Node imports (the band's mod uses it too); the waypoint CLI reads the files.
import type { ChangelogEntry } from './history.js';
import type { Critique, Proposal } from './critique.js';

/** One critique-r<N>.json: null when the file is not a valid critique. */
export interface GateCritique { round: number; critique: Critique | null }
/** A proposal of some round that was neither applied, folded in by a rewrite of its round, nor dismissed. */
export interface Pending { round: number; n: number; severity: Proposal['severity']; section: string }
/** dismissed.json: round → the proposal numbers the person set aside, sorted. */
export type Dismissed = Record<number, number[]>;
export interface Gate {
  version: number; rounds: number; latestRound: number | null; latestCritiqueVersion: number | null;
  criticalPending: { round: number; n: number }[]; invalid: number[]; canAutoApprove: boolean;
  pending: Pending[]; pendingCounts: { critical: number; major: number; minor: number };
}

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

/** dismissed.json read tolerantly: junk is nothing dismissed, and only positive integer numbers of numeric rounds count. */
export function parseDismissed(text: string | null | undefined): Dismissed {
  let raw: unknown;
  try { raw = JSON.parse(text ?? ''); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Dismissed = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(k) || !Array.isArray(v)) continue;
    const ns = v.filter((n): n is number => Number.isInteger(n) && n > 0);
    if (ns.length) out[Number(k)] = [...new Set(ns)].sort((a, b) => a - b);
  }
  return out;
}

/** `d` with `ns` added to round R, sorted and without duplicates. */
export function mergeDismissed(d: Dismissed, round: number, ns: number[]): Dismissed {
  return { ...d, [round]: [...new Set([...(d[round] ?? []), ...ns])].sort((a, b) => a - b) };
}

/** Every proposal of every valid critique still waiting for a decision, by round then number. */
export function pendingProposals(changelog: ChangelogEntry[], critiques: GateCritique[], dismissed: Dismissed = {}): Pending[] {
  const out: Pending[] = [];
  for (const { round, critique } of [...critiques].sort((a, b) => a.round - b.round)) {
    if (!critique || rewroteRound(changelog, round)) continue;
    const applied = appliedIn(changelog, round);
    const gone = new Set(dismissed[round] ?? []);
    for (const p of critique.proposals) {
      if (!applied.has(p.n) && !gone.has(p.n)) out.push({ round, n: p.n, severity: p.severity, section: p.section });
    }
  }
  return out;
}

/**
 * Approvable without asking when the latest critique is valid, no critical proposal of any round is left pending, and
 * the latest critique is not of a version newer than the design's. A design with no critique (one just imported) never is.
 */
export function designGate(changelog: ChangelogEntry[], critiques: GateCritique[], dismissed: Dismissed = {}): Gate {
  const version = changelog[changelog.length - 1]?.version ?? 0;
  const latestRound = critiques.length ? Math.max(...critiques.map(c => c.round)) : null;
  const latest = latestRound === null ? null : critiques.find(c => c.round === latestRound)?.critique ?? null;
  const pending = pendingProposals(changelog, critiques, dismissed);
  const criticalPending = pending.filter(p => p.severity === 'critical').map(p => ({ round: p.round, n: p.n }));
  const count = (s: Pending['severity']) => pending.filter(p => p.severity === s).length;
  const latestCritiqueVersion = latest?.version ?? null;
  return {
    version, rounds: critiques.filter(c => c.critique !== null).length, latestRound, latestCritiqueVersion, criticalPending,
    invalid: critiques.filter(c => c.critique === null).map(c => c.round).sort((a, b) => a - b),
    canAutoApprove: latest !== null && criticalPending.length === 0 && latestCritiqueVersion !== null && latestCritiqueVersion <= version,
    pending, pendingCounts: { critical: count('critical'), major: count('major'), minor: count('minor') },
  };
}
