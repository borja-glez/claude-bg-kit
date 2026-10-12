export type TaskStatus = 'free' | 'claimed' | 'in_progress' | 'blocked' | 'done' | 'orphaned';
export type PlanStatus = 'committed' | 'provisional';
export const TRACK_COLORS = ['blue', 'mauve', 'teal', 'pink', 'sky', 'flamingo'] as const;
export type TrackColor = (typeof TRACK_COLORS)[number];

export interface PlanTask {
  id: string;
  title: string;
  track: string;
  phase: string;
  category?: string;
  includes?: string;
  done_when: string;
  verification?: string;
  depends_on: string[];
  zones: string[];
  estimate_min?: number;
}
export interface PlanPhase { id: string; name: string; plan_status: PlanStatus }
export interface PlanTrack { id: string; name: string; color: TrackColor }
export interface PlanVersion { id: string; phases: string[] }
export interface Plan {
  project: string;
  locale: string;
  version: string;
  artifacts: { roadmap?: string; design?: string };
  versions: PlanVersion[];
  tracks: PlanTrack[];
  phases: PlanPhase[];
  tasks: PlanTask[];
}
/** What the page and metrics need — satisfied by Plan and by planViewFromDocs(). */
export type PlanView = Pick<Plan, 'tracks' | 'phases' | 'tasks' | 'versions'>;

export interface Commit { sha: string; ts: string; title: string; add: number; del: number }
export interface TaskState {
  status: TaskStatus;
  owner?: string;
  claimedAt?: string;
  startedAt?: string;
  doneAt?: string;
  blockedBy?: string[];
  commits?: Commit[];
  summary?: string;
  zonesTouched?: string[];
  forge?: { path: string; phase: string; agent?: string; validators?: { name: string; ok: boolean }[]; verdict?: { action: string; score: number | null }; round?: number; cap?: number };
  evidence?: {
    surfaces: string[]; result: 'pass' | 'fail' | 'blocked'; passed: number; total: number; local?: string; pending?: boolean; reason?: string;
    shots: { url?: string; id?: string; surface: string; check: string; ok: boolean; expected?: string; observed?: string }[];
  };
}
export type States = Record<string, TaskState | undefined>;

export interface SessionDoc {
  name: string;
  track?: string | null;
  currentTask?: string;
  heartbeatAt: string;
  /** ISO time: a lease that keeps the session non-idle during a long step (capped, see isIdle). */
  busyUntil?: string;
  branch?: string;
  agentName?: string;
  worktree?: string;
  /** The coordinator SID when a forge swarm launched this session. */
  launchedBy?: string;
  status: 'active' | 'idle';
}
export type MessageType = 'overlap_warning' | 'handoff_request' | 'delegate' | 'reply' | 'escalation';
export interface MessageDoc {
  ts: string;
  from: string;
  to: string;
  type: MessageType;
  taskId?: string;
  text: string;
  status: 'open' | 'resolved';
  replyTo?: string;
}
export type EventType = 'claimed' | 'started' | 'done' | 'blocked' | 'unblocked' | 'commit' | 'note' | 'plan_changed' | 'message';
export interface EventDoc {
  ts: string;
  type: EventType;
  sessionId: string;
  taskId?: string;
  text?: string;
  add?: number;
  del?: number;
  sha?: string;
}
export interface MetaDoc {
  name: string;
  locale: string;
  version: string;
  planHash: string;
  tracks: PlanTrack[];
  versions: PlanVersion[];
  phaseOrder: string[];
  metrics: { tests?: number; lastCommit?: { sha: string; ts: string } };
  syncedAt: string;
}
/** meta/infinite: forge's infinite run as the roadmap shows it (its own doc, so the meta/project sync never overwrites it). */
export interface InfiniteDoc {
  active: boolean;
  cycle: number;
  budget: { cycles?: number; hours?: number };
  startedAt: string;
  lastCycleAt: string | null;
}
export interface PhaseDoc { id: string; name: string; plan_status: PlanStatus; order: number; tasks: PlanTask[] }

export type NoteType = 'decision' | 'idea' | 'debt' | 'question';
export interface NoteDoc {
  ts: string;
  type: NoteType;
  author: string;
  text: string;
  taskId?: string;
  answer?: string;
  answeredBy?: string;
  answeredAt?: string;
  proposalId?: string;
}
