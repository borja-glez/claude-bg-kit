// forge swarm's state, kept in .forge/swarm.json and mirrored to the roadmap as meta/swarm. Pure, so the forge CLI,
// the roadmap page, lens and the band all bundle it. Every key is always written (null when unset), so an update
// of meta/swarm from the file never leaves stale values behind.

export const FRONT_STATUSES = ['running', 'queued', 'waiting', 'blocked', 'ready', 'integrated', 'conflict', 'launch-failed'] as const;
export type FrontStatus = (typeof FRONT_STATUSES)[number];
const STOP_REASONS = ['finished', 'stalled', 'stopped', 'budget'] as const;
export type SwarmStopReason = (typeof STOP_REASONS)[number];
const NOTICE_KINDS = ['main-dirty', 'launch-failed', 'conflict'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface WaitingFor { task: string; track: string; reason: 'not-done' | 'not-integrated' }
export interface FrontState {
  status: FrontStatus;
  session: string | null;
  launchedAt: string | null;
  currentTask: string | null;
  heartbeatAt: string | null;
  done: number;
  total: number;
  waitingFor: WaitingFor | null;
  detail: string | null;
}
export interface SwarmState {
  active: boolean;
  parallel: number;
  mergeAuthorized: boolean;
  project: string;
  base: string;
  coordinator: string;
  hookSession: string | null;
  startedAt: string;
  lastTickAt: string | null;
  lastBlockTick: string | null;
  sleepUntil: string | null;
  stopReason: SwarmStopReason | null;
  stallReason: string | null;
  notice: { kind: NoticeKind; track: string | null; at: string } | null;
  fronts: Record<string, FrontState>;
}

const MAX_FRONTS = 200;
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const iso = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);
const count = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);
const oneOf = <T extends string>(list: readonly T[], x: unknown): T | null => (list as readonly unknown[]).includes(x) ? x as T : null;

export const emptyFront = (): FrontState => ({
  status: 'queued', session: null, launchedAt: null, currentTask: null, heartbeatAt: null, done: 0, total: 0, waitingFor: null, detail: null,
});

function normalizeFront(x: unknown): FrontState | null {
  if (!isObj(x)) return null;
  const status = oneOf(FRONT_STATUSES, x.status);
  if (!status) return null;
  const w = isObj(x.waitingFor) ? x.waitingFor : null;
  const reason = w ? oneOf(['not-done', 'not-integrated'] as const, w.reason) : null;
  return {
    status,
    session: str(x.session), launchedAt: iso(x.launchedAt), currentTask: str(x.currentTask), heartbeatAt: iso(x.heartbeatAt),
    done: count(x.done), total: count(x.total),
    waitingFor: w && reason && str(w.task) && str(w.track) ? { task: str(w.task)!, track: str(w.track)!, reason } : null,
    detail: str(x.detail),
  };
}

/** null when a required field is missing or invalid; optional fields fall back to null, unknown fronts are dropped. */
export function normalizeSwarm(x: unknown): SwarmState | null {
  if (!isObj(x)) return null;
  const { project, base, coordinator } = { project: str(x.project), base: str(x.base), coordinator: str(x.coordinator) };
  const startedAt = iso(x.startedAt);
  const parallel = typeof x.parallel === 'number' && Number.isInteger(x.parallel) && x.parallel >= 1 && x.parallel <= 10 ? x.parallel : null;
  if (!project || !base || !coordinator || !startedAt || parallel === null || typeof x.active !== 'boolean') return null;
  const n = isObj(x.notice) ? x.notice : null;
  const kind = n ? oneOf(NOTICE_KINDS, n.kind) : null;
  const fronts: Record<string, FrontState> = {};
  if (isObj(x.fronts)) {
    for (const [id, f] of Object.entries(x.fronts).slice(0, MAX_FRONTS)) {
      const front = normalizeFront(f);
      if (front) fronts[id] = front;
    }
  }
  return {
    active: x.active, parallel, mergeAuthorized: x.mergeAuthorized === true, project, base, coordinator,
    hookSession: str(x.hookSession), startedAt, lastTickAt: iso(x.lastTickAt), lastBlockTick: iso(x.lastBlockTick),
    sleepUntil: iso(x.sleepUntil), stopReason: oneOf(STOP_REASONS, x.stopReason), stallReason: str(x.stallReason),
    notice: n && kind && iso(n.at) ? { kind, track: str(n.track), at: iso(n.at)! } : null,
    fronts,
  };
}

export function parseSwarm(text: string | null | undefined): SwarmState | null {
  if (typeof text !== 'string') return null;
  try { return normalizeSwarm(JSON.parse(text)); } catch { return null; }
}

export const swarmLive = (s: SwarmState): number => Object.values(s.fronts).filter(f => f.status === 'running').length;
