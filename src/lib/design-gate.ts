// The approval gate of auto mode (spec §5.5): from a design's changelog and its critiques, whether it can be approved
// without asking. Pure and deterministic; the waypoint CLI reads the files.
import type { ChangelogEntry } from './history.js';
import type { Critique } from './critique.js';

/** One critique-r<N>.json: null when the file is not a valid critique. */
export interface GateCritique { round: number; critique: Critique | null }
export interface Gate {
  version: number; rounds: number; latestRound: number | null; latestCritiqueVersion: number | null;
  criticalPending: number[]; invalid: number[]; canAutoApprove: boolean;
}

/** The proposal numbers changelog notes record as applied in round R ("round R: applied 1,3 — …", as `apply` writes). */
export function appliedIn(changelog: ChangelogEntry[], round: number): Set<number> {
  const out = new Set<number>();
  for (const e of changelog) {
    for (const m of e.note.matchAll(/round\s+(\d+)\s*:\s*applied\s+([\d\s,]+)/gi)) {
      if (Number(m[1]) !== round) continue;
      for (const n of m[2].split(/[\s,]+/)) if (/^\d+$/.test(n)) out.add(Number(n));
    }
  }
  return out;
}

/**
 * Approvable without asking when the latest critique is valid, none of its critical proposals is left unapplied, and
 * it is not of a version newer than the design's. A design with no critique (one just imported) never is.
 */
export function designGate(changelog: ChangelogEntry[], critiques: GateCritique[]): Gate {
  const version = changelog[changelog.length - 1]?.version ?? 0;
  const latestRound = critiques.length ? Math.max(...critiques.map(c => c.round)) : null;
  const latest = latestRound === null ? null : critiques.find(c => c.round === latestRound)?.critique ?? null;
  const applied = latestRound === null ? new Set<number>() : appliedIn(changelog, latestRound);
  const criticalPending = latest ? latest.proposals.filter(p => p.severity === 'critical' && !applied.has(p.n)).map(p => p.n) : [];
  const latestCritiqueVersion = latest?.version ?? null;
  return {
    version, rounds: critiques.filter(c => c.critique !== null).length, latestRound, latestCritiqueVersion, criticalPending,
    invalid: critiques.filter(c => c.critique === null).map(c => c.round).sort((a, b) => a - b),
    canAutoApprove: latest !== null && criticalPending.length === 0 && latestCritiqueVersion !== null && latestCritiqueVersion <= version,
  };
}
