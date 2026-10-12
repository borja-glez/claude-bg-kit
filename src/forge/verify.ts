// The rule for tool verification (spec §5.1): never on Trivial or Small unless the task asks; on Medium and Large a
// surface is a candidate when the diff touches its `affects`, or always when it has none. Permission comes from
// local.yaml (denied drops the surface; unknown asks). Missing tools are reported, never a reason to drop.
import { globMatch } from './validators.js';
import type { Draft, Surface } from './surfaces.js';
import type { LocalState } from './local.js';

export interface PlanSurface { name: string; permission: 'allowed' | 'ask' | 'changed'; match: string | null; missing: string[] }
export interface VerifyPlan { eligible: boolean; surfaces: PlanSurface[]; drafts: { name: string; match: string }[]; reason: string }

const firstMatch = (globs: string[], changed: string[] | null): string | undefined =>
  changed?.find(f => globs.some(g => globMatch(g, f)));

export function verifyPlan(i: { path: string; asked: boolean; changed: string[] | null; surfaces: Surface[]; drafts: Draft[]; local: LocalState; missing: (s: Surface) => string[] }): VerifyPlan {
  if ((i.path === 'trivial' || i.path === 'small') && !i.asked) return { eligible: false, surfaces: [], drafts: [], reason: `${i.path}: no tool verification unless the task asks for it` };
  const surfaces: PlanSurface[] = [];
  for (const s of i.surfaces) {
    const perm = i.local.surfaces[s.name];
    if (perm?.state === 'denied') continue;
    let match: string | null = null;
    if (s.affects !== null) {
      const m = firstMatch(s.affects, i.changed);
      if (m === undefined) continue;
      match = m;
    }
    // An allowance covers the content it was given for: an edited surface (another commit, a PR) asks again.
    const permission = perm?.state !== 'allowed' ? 'ask' : perm.hash === s.hash ? 'allowed' : 'changed';
    surfaces.push({ name: s.name, permission, match, missing: i.missing(s) });
  }
  const drafts = i.drafts
    .filter(d => !i.surfaces.some(s => s.name === d.name) && !i.local.proposed.includes(d.name))
    .flatMap(d => { const m = firstMatch(d.affects, i.changed); return m === undefined ? [] : [{ name: d.name, match: m }]; });
  const eligible = surfaces.some(s => s.permission === 'allowed');
  const reason = i.changed === null ? 'the diff is unknown: only surfaces without affects are candidates'
    : surfaces.length ? surfaces.map(s => `${s.name}${s.match ? ` (${s.match})` : ''}`).join(', ') : 'no surface matches the diff';
  return { eligible, surfaces, drafts, reason };
}

/** Kills each pid (its whole tree); `kill` returns false when the process is already gone. */
export function cleanupPids(pids: number[], kill: (pid: number) => boolean): { killed: number[]; gone: number[] } {
  const killed: number[] = [], gone: number[] = [];
  for (const pid of pids) (kill(pid) ? killed : gone).push(pid);
  return { killed, gone };
}
