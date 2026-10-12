import { computeMetrics } from '../lib/metrics.js';
import { escalationCandidates, inboxFor } from '../lib/coordination.js';
import { parseCritique } from '../lib/critique.js';
import { parseDesign } from '../lib/design.js';
import { parseChangelog } from '../lib/history.js';
import { parsePlan } from '../lib/plan.js';
import { parseSwarm, swarmLive, type SwarmState } from '../lib/swarm-state.js';
import type { MessageDoc, States } from '../lib/types.js';

export interface ProjectEntry { name: string; hasSession: boolean; mtimeMs: number }
export interface BandFiles {
  plan?: string; session?: string; swarm?: string; design?: string; changelog?: string;
  states: Record<string, string>; messages: Record<string, string>; critiques: Record<string, string>;
}
// In work mode `cells` holds one letter per task of the track (or of the plan), in plan order: d done, a active,
// b blocked, p pending.
export type BandModel =
  // locale, when known, lets a reader of the band (lens) keep the project's language while no band is drawn.
  | { mode: 'none'; locale?: string }
  | { mode: 'work'; project: string; locale: string; sid: string; track: string | null; roadmapUrl: string | null;
      current: { id: string; title: string; startedAt?: string; estimateMin?: number } | null;
      trackDone: number; trackTotal: number; percent: number; inbox: number; escalation: boolean;
      phase: { index: number; total: number; name: string } | null; cells: string; swarm: boolean }
  | { mode: 'swarm'; project: string; locale: string; live: number; parallel: number; integrated: number; tracks: number;
      percent: number; conflicts: number; stalled: boolean; roadmapUrl: string | null }
  | { mode: 'design'; project: string; locale: string; version: number; round: number; proposals: number; critical: number; designUrl: string | null };

function json<T>(text: string | undefined): T | undefined {
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as T; } catch { return undefined; }
}
function parsed<T>(rows: Record<string, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, text] of Object.entries(rows)) { const v = json<T>(text); if (v && typeof v === 'object') out[id] = v; }
  return out;
}

// The project with a session wins (the newest when several have one), else the newest of all.
export function pickProject(entries: ProjectEntry[]): string | null {
  const withSession = entries.filter(e => e.hasSession);
  const pool = withSession.length ? withSession : entries;
  if (!pool.length) return null;
  return [...pool].sort((a, b) => b.mtimeMs - a.mtimeMs)[0].name;
}

export function buildBandModel(project: string, f: BandFiles): BandModel {
  try {
    if (f.plan !== undefined && f.swarm !== undefined) {
      const s = parseSwarm(f.swarm);
      // Only the coordinator of this project's swarm: a member (session.json has launchedBy) keeps its work band.
      const member = json<{ launchedBy?: unknown }>(f.session)?.launchedBy;
      const isMember = typeof member === 'string' && !!member;
      if (s && s.project === project && !isMember && (s.active || s.stopReason === 'stalled')) return swarmModel(project, f.plan, s, f);
    }
    if (f.plan !== undefined && f.session !== undefined) return workModel(project, f);
    if (f.design !== undefined) return designModel(project, f);
  } catch { /* any parse failure hides the band */ }
  const locale = knownLocale(f);
  return locale ? { mode: 'none', locale } : { mode: 'none' };
}

// The project's language from its plan, else its design, for a band that draws nothing.
function knownLocale(f: BandFiles): string | undefined {
  try { if (f.plan !== undefined) return parsePlan(f.plan).locale; } catch { /* try the design */ }
  try { if (f.design !== undefined) return parseDesign(f.design).meta.locale; } catch { /* none */ }
  return undefined;
}

const MAX_CELLS = 120;
const CELL: Record<string, string> = { done: 'd', in_progress: 'a', claimed: 'a', blocked: 'b', free: 'p', orphaned: 'b' };

function workModel(project: string, f: BandFiles): BandModel {
  let plan;
  try { plan = parsePlan(f.plan!); } catch { return { mode: 'none' }; }
  const session = json<{ sessionId?: string; track?: string | null; launchedBy?: string }>(f.session) ?? {};
  const sid = typeof session.sessionId === 'string' ? session.sessionId : 'main';
  const track = typeof session.track === 'string' ? session.track : null;
  const states = parsed<States[string]>(f.states) as States;
  const messages = parsed<MessageDoc>(f.messages);
  const m = computeMetrics(plan, states, Date.now());
  const own = plan.tasks.find(t => states[t.id]?.owner === sid && ['claimed', 'in_progress'].includes(states[t.id]?.status ?? ''));
  const byTrack = track ? m.byTrack[track] : undefined;
  // The phase of the session's task, else the first phase not done.
  const phaseAt = own ? plan.phases.findIndex(p => p.id === own.phase) : -1;
  const pi = phaseAt >= 0 ? phaseAt : plan.phases.findIndex(p => m.byPhase[p.id]?.status !== 'done');
  return {
    mode: 'work', project, locale: plan.locale, sid, track,
    roadmapUrl: plan.artifacts.roadmap ?? null,
    current: own ? { id: own.id, title: own.title, startedAt: states[own.id]?.startedAt, estimateMin: own.estimate_min } : null,
    trackDone: byTrack?.done ?? m.done, trackTotal: byTrack?.total ?? m.total,
    percent: m.percent,
    inbox: inboxFor(messages, sid).length,
    escalation: Object.values(messages).some(x => x.type === 'escalation' && x.status === 'open' && (x.from === sid || x.to === sid))
      || escalationCandidates(messages).some(c => c.sessions.includes(sid)),
    phase: pi >= 0 ? { index: pi + 1, total: plan.phases.length, name: plan.phases[pi].name } : null,
    cells: plan.tasks.filter(t => !track || t.track === track).slice(0, MAX_CELLS).map(t => CELL[states[t.id]?.status ?? 'free'] ?? 'p').join(''),
    swarm: typeof session.launchedBy === 'string' && !!session.launchedBy,
  };
}

function swarmModel(project: string, planText: string, s: SwarmState, f: BandFiles): BandModel {
  const plan = parsePlan(planText);
  const states = parsed<States[string]>(f.states) as States;
  const fronts = Object.values(s.fronts);
  return {
    mode: 'swarm', project, locale: plan.locale, live: swarmLive(s), parallel: s.parallel,
    integrated: fronts.filter(x => x.status === 'integrated').length, tracks: plan.tracks.length,
    percent: computeMetrics(plan, states, Date.now()).percent,
    conflicts: fronts.filter(x => x.status === 'conflict' || x.status === 'launch-failed').length,
    stalled: !s.active, roadmapUrl: plan.artifacts.roadmap ?? null,
  };
}

function designModel(project: string, f: BandFiles): BandModel {
  const d = parseDesign(f.design!);
  if (d.meta.status !== 'draft') return { mode: 'none', locale: d.meta.locale };
  let changelog: ReturnType<typeof parseChangelog> = [];
  try { changelog = parseChangelog(f.changelog ?? null); } catch { changelog = []; }
  const critiques = Object.entries(f.critiques)
    .map(([name, text]) => ({ n: Number(/^critique-r(\d+)\.json$/.exec(name)?.[1] ?? NaN), text }))
    .filter(c => Number.isFinite(c.n))
    .sort((a, b) => b.n - a.n);
  let latest: ReturnType<typeof parseCritique> | null = null;
  let round = 0;
  for (const c of critiques) { try { latest = parseCritique(c.text); round = c.n; break; } catch { /* skip invalid */ } }
  return {
    mode: 'design', project, locale: d.meta.locale,
    version: changelog.at(-1)?.version ?? 0,
    round,
    proposals: latest?.proposals.length ?? 0,
    critical: latest?.proposals.filter(p => p.severity === 'critical').length ?? 0,
    designUrl: d.meta.artifact ?? null,
  };
}
