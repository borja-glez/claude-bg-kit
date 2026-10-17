// The agents lens hears of and the task each one works on (wave 3, §4.2): the task its prompt names, else its parent's,
// its workflow, its state and its tool in flight; and the tasks this session touched with forge.cjs. Pure:
// register.tsx feeds it the engine's events and keeps the lists in module memory. It only observes a spawn: it never
// rewrites nor refuses one.
import { isSafeId } from '../lib/execution-state.js';
import { cleanText } from '../lib/forge-status.js';

export const LINKS_MAX = 100;
/** An agent that ended stays this long (finished.ts keeps finished ones as long); a workflow's, 15 minutes. */
export const DONE_LINK_MS = 5 * 60_000;
export const WORKFLOW_DONE_MS = 15 * 60_000;
/** A workflow's agent no list names lives until its turn ends, or this long at most. */
export const WORKFLOW_AGENT_TTL_MS = 2 * 3600_000;
/** Only this much of a prompt is read. */
export const PROMPT_SCAN = 8192;
export const OWN_TASKS_MAX = 100;
const PARENT_DEPTH = 5;

export interface AgentLink {
  id: string; type: string; description: string; since: number;
  task: string | null; brief: number | null; project: string | null;
  via: 'contract' | 'task-id' | 'work-path' | 'description' | 'parent' | null;
  parentId: string | null;
  workflow: { runId: string; index: number } | null;
  status: 'running' | 'waiting' | 'idle' | 'done';
  tool: { name: string; since: number } | null;
  /** When it ended, the clock its pruning runs on; null while it lives. */
  endedAt: number | null;
}
export type TaskOf = { task: string; brief: number | null; project: string | null; via: AgentLink['via'] };

// Ids are at most 120 characters, as isSafeId, taskLine and the plan projects.
// The contract line (E-02): `forge-task: <T>-<n>`, with ` @<project>` for a plan task. [ \t] so a match never crosses a line.
const CONTRACT = /^forge-task:[ \t]*([A-Za-z0-9._-]{1,120}?)(?:-(\d{1,4}))?(?:[ \t]+@([A-Za-z0-9._-]{1,120}))?[ \t]*$/m;
const TASK_ID = /^[ \t]*Task id:[ \t]*([A-Za-z0-9._-]{1,120}?)(?:-(\d{1,4}))?[ \t]*$/mi;
// .forge/work/<T>/… or .forge/work/<project>/<T>/…, and brief-<n>.md after it when it is there.
const WORK = /\.forge\/work\/([A-Za-z0-9._-]{1,120})(?:\/([A-Za-z0-9._-]{1,120}))?(?:\/([A-Za-z0-9._-]{1,120}))?/;
// A segment under a task's folder that is no task: a review round, the evidence, a twin's folder or a file.
const ARTIFACT = /^(?:reviews-\d|evidence$|shadow$)|\.(?:md|txt|json|patch)$/;
const BRIEF_FILE = /^brief-(\d{1,4})\.md$/;
const NOT_TASKS = new Set(['run', 'infinite']);
const LIVE = new Set(['running', 'pending', 'waiting', 'idle']);

// `<t>-<n>`: the whole id when it is a known task (as routeEvent does), else task t and brief n; null when unsafe.
function pick(t: string, n: string | undefined, known: ReadonlySet<string>): { task: string; brief: number | null } | null {
  const full = n !== undefined ? `${t}-${n}` : t;
  if (n !== undefined && known.has(full)) return isSafeId(full) ? { task: full, brief: null } : null;
  return isSafeId(t) ? { task: t, brief: n !== undefined ? Number(n) : null } : null;
}

function workPath(text: string): Omit<TaskOf, 'via'> | null {
  const m = WORK.exec(text);
  if (!m) return null;
  const [, a, b, c] = m;
  if (NOT_TASKS.has(a)) return null;
  const nested = b !== undefined && !ARTIFACT.test(b);
  const project = nested ? a : null;
  const task = nested ? b : a;
  const file = nested ? c : b;
  if (!isSafeId(task) || (project !== null && !isSafeId(project))) return null;
  const n = file !== undefined ? BRIEF_FILE.exec(file)?.[1] : undefined;
  return { task, brief: n !== undefined ? Number(n) : null, project };
}

/**
 * E-02: the task an agent works on, from the first 8 KB of its prompt: the contract line `forge-task:`, else a
 * `Task id:` line, else a work path `.forge/work/…`, else the first word of its description that is a known task.
 * Ids that are not safe are ignored; null when nothing matches.
 */
export function taskOfPrompt(prompt: string, description: string, known: ReadonlySet<string>): TaskOf | null {
  const text = (typeof prompt === 'string' ? prompt : '').slice(0, PROMPT_SCAN).replace(/\r\n?/g, '\n');
  const c = CONTRACT.exec(text);
  if (c && (c[3] === undefined || isSafeId(c[3]))) {
    const r = pick(c[1], c[2], known);
    if (r) return { ...r, project: c[3] ?? null, via: 'contract' };
  }
  const t = TASK_ID.exec(text);
  if (t) {
    const r = pick(t[1], t[2], known);
    if (r) return { ...r, project: null, via: 'task-id' };
  }
  const w = workPath(text.replace(/\\/g, '/'));
  if (w) return { ...w, via: 'work-path' };
  const words = (typeof description === 'string' ? description : '').slice(0, 240).split(/[\s:·,;()[\]]+/);
  const word = words.find(x => x && known.has(x) && isSafeId(x));
  return word ? { task: word, brief: null, project: null, via: 'description' } : null;
}

/** The task of the nearest ancestor that has one, five levels up at most. */
function parentTask(links: readonly AgentLink[], parentId: string | null): Omit<TaskOf, 'via'> | null {
  let id = parentId;
  for (let depth = 0; id && depth < PARENT_DEPTH; depth++) {
    const p = links.find(l => l.id === id);
    if (!p) return null;
    if (p.task) return { task: p.task, brief: p.brief, project: p.project };
    id = p.parentId;
  }
  return null;
}

/** At most LINKS_MAX: the oldest that ended go first, then the oldest of all. */
function capped(list: AgentLink[]): AgentLink[] {
  if (list.length <= LINKS_MAX) return list;
  const order = [
    ...list.filter(l => l.status === 'done').sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0)),
    ...[...list].sort((a, b) => a.since - b.since),
  ];
  const drop = new Set<string>();
  for (const l of order) {
    if (list.length - drop.size <= LINKS_MAX) break;
    drop.add(l.id);
  }
  return list.filter(l => !drop.has(l.id));
}

export interface SpawnSeen { id: string; type: string; description: string; prompt: string; parentId: string | null; workflow: { runId: string; index: number } | null; now: number }

/** agent.spawn: the agent with the task its prompt names, else its parent's (`via: 'parent'`). An id seen again is replaced. */
export function linkSpawn(links: readonly AgentLink[], s: SpawnSeen, known: ReadonlySet<string>): AgentLink[] {
  if (!s.id) return [...links];
  const own = taskOfPrompt(s.prompt, s.description, known);
  const up = own ? null : parentTask(links, s.parentId);
  const link: AgentLink = {
    id: s.id, type: cleanText(String(s.type ?? '')), description: cleanText(String(s.description ?? '')), since: s.now,
    task: own?.task ?? up?.task ?? null, brief: own?.brief ?? up?.brief ?? null, project: own?.project ?? up?.project ?? null,
    via: own?.via ?? (up ? 'parent' : null), parentId: s.parentId, workflow: s.workflow, status: 'running', tool: null, endedAt: null,
  };
  return capped([...links.filter(l => l.id !== s.id), link]);
}

export interface ListedAgent { id: string; type: string; description: string; status: string; parentId: string | null }

const statusOf = (s: string): AgentLink['status'] =>
  s === 'idle' ? 'idle' : s === 'waiting' ? 'waiting' : s === 'running' || s === 'pending' ? 'running' : 'done';

/**
 * E-09: $.agent.list() is the truth for the agents it lists: their state (a teammate `idle` between turns waits, it is
 * not gone) and their parent; one it no longer lists has ended, except a workflow's (no list names those). One listed
 * that lens never saw spawn (it loaded later) is added, its task from its description or its parent.
 */
export function syncListed(links: readonly AgentLink[], list: readonly ListedAgent[], now: number, known: ReadonlySet<string>): AgentLink[] {
  const listed = new Map(list.map(a => [a.id, a]));
  const out: AgentLink[] = links.map(l => {
    const a = listed.get(l.id);
    if (a) {
      const status = statusOf(a.status);
      return { ...l, status, parentId: a.parentId ?? l.parentId, endedAt: status === 'done' ? l.endedAt ?? now : null, ...(status === 'done' ? { tool: null } : {}) };
    }
    return l.workflow || l.status === 'done' ? l : { ...l, status: 'done' as const, tool: null, endedAt: now };
  });
  for (const a of list) {
    if (links.some(l => l.id === a.id) || !LIVE.has(a.status)) continue;
    const own = taskOfPrompt('', a.description, known);
    const up = own ? null : parentTask(out, a.parentId);
    out.push({
      id: a.id, type: cleanText(a.type), description: cleanText(a.description), since: now,
      task: own?.task ?? up?.task ?? null, brief: own?.brief ?? up?.brief ?? null, project: own?.project ?? up?.project ?? null,
      via: own?.via ?? (up ? 'parent' : null), parentId: a.parentId, workflow: null, status: statusOf(a.status), tool: null, endedAt: null,
    });
  }
  return capped(out);
}

/** turn.complete of an agent: a workflow's agent has ended (with `any`, any agent: SubagentStop). */
export function endAgent(links: readonly AgentLink[], id: string, now: number, opts: { any?: boolean } = {}): AgentLink[] {
  return links.map(l => (l.id === id && l.status !== 'done' && (l.workflow || opts.any) ? { ...l, status: 'done' as const, tool: null, endedAt: now } : l));
}

/** E-11: the tool an agent runs now (tool.call with its agentId), or none once it returned. */
export function setTool(links: readonly AgentLink[], id: string, tool: { name: string; since: number } | null): AgentLink[] {
  return links.map(l => (l.id === id ? { ...l, tool: tool ? { name: cleanText(tool.name), since: tool.since } : null } : l));
}

/** A workflow's agent alive past WORKFLOW_AGENT_TTL_MS has ended; one that ended goes after DONE_LINK_MS (a workflow's, WORKFLOW_DONE_MS). */
export function pruneLinks(links: readonly AgentLink[], now: number): AgentLink[] {
  return links.flatMap(l => {
    if (l.workflow && l.status !== 'done' && now - l.since > WORKFLOW_AGENT_TTL_MS) return [{ ...l, status: 'done' as const, tool: null, endedAt: now }];
    if (l.status === 'done' && l.endedAt !== null && now - l.endedAt > (l.workflow ? WORKFLOW_DONE_MS : DONE_LINK_MS)) return [];
    return [l];
  });
}

const OWN_TASK = /forge\.cjs\b[^\n]*?(?:--task[ \t]+|swarm[ \t]+task[ \t]+)["']?([A-Za-z0-9._-]{1,120})/;

/** E-06: the task a forge.cjs command of this session works on (`--task <id>` or `swarm task <id>`), or null. */
export function ownTaskOf(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  const m = OWN_TASK.exec(command.slice(0, PROMPT_SCAN));
  return m && isSafeId(m[1]) ? m[1] : null;
}

/** The list with `id` last (the newest), at most OWN_TASKS_MAX; unchanged without an id. */
export function addOwnTask(list: readonly string[], id: string | null): string[] {
  if (!id) return [...list];
  return [...list.filter(t => t !== id), id].slice(-OWN_TASKS_MAX);
}

/** The tasks a description can name: the forge activities and the slots of the execution of the last model. */
export function knownTasks(m: { activities?: readonly { kind: string; task: string | null }[]; execution?: { slots: readonly { task: string }[] } | null } | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const a of m?.activities ?? []) if (a.kind === 'forge' && a.task) out.add(a.task);
  for (const s of m?.execution?.slots ?? []) out.add(s.task);
  return out;
}
