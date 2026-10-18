// The rule for tool verification: never on Trivial or Small unless the task asks; on Medium and Large a
// surface is a candidate when the diff touches its `affects`, or always when it has none. Permission comes from
// local.yaml (denied drops the surface; unknown asks; an allowance covers its hash, see hashMatches). Missing and
// unknown tools are reported, never a reason to drop.
import { globMatch } from './validators.js';
import { hashMatches, type Draft, type Surface } from './surfaces.js';
import type { LocalState } from './local.js';

export interface Ask { question: string; options: string[] }
export interface PlanSurface {
  // hash: the surface's permission hash now, for `local set surfaces.<name> allowed --expect <hash>`.
  name: string; permission: 'allowed' | 'ask' | 'changed'; match: string | null; missing: string[]; unknown: string[]; hash: string;
  // What the question to the user shows (the CLI adds them): the change since the allowance (changed) and the question.
  // A diff cut at its cap says so (diffTruncated) and names the file holding all of it (null: it could not be written).
  diff?: string | null; diffTruncated?: true; diffFile?: string | null; commits?: string[]; ask?: Ask;
}
export interface VerifyPlan { eligible: boolean; surfaces: PlanSurface[]; drafts: { name: string; match: string }[]; reason: string }

const firstMatch = (globs: string[], changed: string[] | null): string | undefined =>
  changed?.find(f => globs.some(g => globMatch(g, f)));

export function verifyPlan(i: {
  path: string; asked: boolean; changed: string[] | null; surfaces: Surface[]; drafts: Draft[];
  local: Pick<LocalState, 'surfaces' | 'proposed'>; tools: (s: Surface) => { missing: string[]; unknown: string[] };
}): VerifyPlan {
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
    const permission = perm?.state !== 'allowed' ? 'ask' : hashMatches(perm.hash, s.hash) ? 'allowed' : 'changed';
    const { missing, unknown } = i.tools(s);
    surfaces.push({ name: s.name, permission, match, missing, unknown, hash: s.hash });
  }
  const drafts = i.drafts
    .filter(d => !i.surfaces.some(s => s.name === d.name) && !i.local.proposed.includes(d.name))
    .flatMap(d => { const m = firstMatch(d.affects, i.changed); return m === undefined ? [] : [{ name: d.name, match: m }]; });
  const eligible = surfaces.some(s => s.permission === 'allowed');
  const reason = i.changed === null ? 'the diff is unknown: only surfaces without affects are candidates'
    : surfaces.length ? surfaces.map(s => `${s.name}${s.match ? ` (${s.match})` : ''}`).join(', ') : 'no surface matches the diff';
  return { eligible, surfaces, drafts, reason };
}

/** The question about a surface that is not allowed, with the three fixed answers (allow, skip this time, deny). */
export function askFor(s: Pick<Surface, 'name' | 'title' | 'tools'>, permission: 'ask' | 'changed', es: boolean): Ask {
  const options = es ? ['Sí, siempre', 'No, esta vez', 'Nunca en este proyecto'] : ['Yes, always', 'Not this time', 'Never in this project'];
  if (permission === 'changed') return { question: es ? `¿Verifico ${s.name} con estas instrucciones?` : `Verify ${s.name} with these instructions?`, options };
  const tools = s.tools.length ? `, ${es ? 'con' : 'with'} ${s.tools.join(', ')}` : '';
  return { question: es ? `¿Verifico ${s.name} (${s.title}${tools})?` : `Verify ${s.name} (${s.title}${tools})?`, options };
}

/** A `git diff` of two blobs with the surface's file in its header instead of the blob ids (`a/` and `b/` prefixes). */
export function relabelDiff(diff: string, from: string, to: string, file: string): string {
  const lines = diff.split('\n');
  for (let i = 0; i < lines.length && !lines[i].startsWith('@@'); i++) {
    if (lines[i] === `diff --git a/${from} b/${to}`) lines[i] = `diff --git a/${file} b/${file}`;
    else if (lines[i] === `--- a/${from}`) lines[i] = `--- a/${file}`;
    else if (lines[i] === `+++ b/${to}`) lines[i] = `+++ b/${file}`;
  }
  return lines.join('\n');
}

/** At most `max` lines of `text`, then a line saying how many more there are. */
export function capLines(text: string, max: number, es: boolean): string {
  const lines = text.replace(/\n$/, '').split('\n');
  const more = lines.length - max;
  if (more <= 0) return text;
  const note = es ? `… (${more} ${more === 1 ? 'línea más' : 'líneas más'})` : `… (${more} more ${more === 1 ? 'line' : 'lines'})`;
  return `${[...lines.slice(0, max), note].join('\n')}\n`;
}

/** Kills each pid (its whole tree); `kill` returns false when the process is already gone. A pid <= 1, this
 *  process or its parent is never killed: it is reported as gone. */
export function cleanupPids(pids: number[], kill: (pid: number) => boolean, protect: number[] = [process.pid, process.ppid]): { killed: number[]; gone: number[] } {
  const killed: number[] = [], gone: number[] = [];
  for (const pid of pids) (pid > 1 && !protect.includes(pid) && kill(pid) ? killed : gone).push(pid);
  return { killed, gone };
}

/** POSIX kill target: the whole process group (`-pid`) only when `pid` leads it, else the single pid. */
export const killTarget = (pid: number, pgid: number | null): number => (pgid === pid ? -pid : pid);
