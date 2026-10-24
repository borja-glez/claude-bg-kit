// 6b-3 Task 1: `waypoint replan`. It moves tasks between phases, orders phases and tasks, adds and edits phases, edits
// and retires tasks, and never renumbers an id. The operations change the nodes of the YAML document, never its text, so
// comments and the order of everything else stay. One history entry per replan stays in plan.yaml, and the result must
// pass parsePlan before the caller writes anything.
import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { clean } from './decisions.js';
import { parsePlan, PlanError, isPlanId } from './plan.js';
import { PHASE_GOAL_MAX, PLAN_HISTORY_MAX, type PlanHistoryEntry, type PlanStatus } from './types.js';

export type ReplanOp =
  | { op: 'add-phase'; id: string; name: string; goal?: string; after?: string; plan_status?: PlanStatus }
  | { op: 'edit-phase'; id: string; name?: string; goal?: string; plan_status?: PlanStatus }
  | { op: 'order-phases'; phases: string[] }
  | { op: 'move'; task: string; phase: string }
  | { op: 'order-tasks'; phase: string; tasks: string[] }
  | { op: 'edit'; task: string; title?: string; done_when?: string; depends_on?: string[]; estimate_min?: number }
  | { op: 'retire'; task: string; why: string };

const REPLAN_OPS: readonly ReplanOp['op'][] = ['add-phase', 'edit-phase', 'order-phases', 'move', 'order-tasks', 'edit', 'retire'];
/** M-1: the most operations one replan takes; each gives at most one change line. */
export const MAX_OPS = 50;
/** The texts an operation brings, cleaned to one line and clipped: a phase name or task title, a done_when, a retire's why. */
const TEXT_MAX = { name: 200, doneWhen: 500, why: 200 } as const;
const PHASE_FIELDS = ['name', 'goal', 'plan_status'] as const;
const TASK_FIELDS = ['title', 'done_when', 'depends_on', 'estimate_min'] as const;
// L-22: keeping the plan is a decision with no replan call.
const EMPTY = 'ops: empty (keeping the plan as it is needs no replan)';
const TOO_MANY = (n: number) => `ops: ${n} operations, at most ${MAX_OPS}`;

export class ReplanError extends Error {
  constructor(public issues: string[]) {
    super(`replan: refused, the plan is unchanged:\n- ${issues.join('\n- ')}`);
    this.name = 'ReplanError';
  }
}

/** M-1: `clean` (one line, no control or bidi characters), then clipped by whole characters to `max` UTF-16 units, the
 *  length the plan's schema counts, so a clipped text always passes it. */
function fit(s: string, max: number): string {
  const t = clean(s, max);
  if (t.length <= max) return t;
  let out = '';
  for (const ch of t) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

type Raw = Record<string, unknown>;
const isObj = (x: unknown): x is Raw => !!x && typeof x === 'object' && !Array.isArray(x);
const planId = (x: unknown): x is string => typeof x === 'string' && isPlanId(x);
const text = (max: number) => (x: unknown): string | null => (typeof x === 'string' ? fit(x, max) || null : null);
const idList = (x: unknown): string[] | null => (Array.isArray(x) && x.every(planId) ? x : null);
const status = (x: unknown): PlanStatus | null => (x === 'committed' || x === 'provisional' ? x : null);
const minutes = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const dropUndefined = <T extends object>(x: T): T => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as T;

/** One operation from untrusted JSON, or what is wrong with it (and its kind, when known). Other keys are ignored. */
function readOp(o: unknown): ReplanOp | { error: string; kind?: string } {
  if (!isObj(o)) return { error: 'not an object' };
  const kind = o.op;
  if (typeof kind !== 'string' || !(REPLAN_OPS as readonly string[]).includes(kind)) {
    return { error: `unknown op ${typeof kind === 'string' ? JSON.stringify(clean(kind, 40)) : '(none)'}` };
  }
  const wrong: string[] = [];
  const id = (k: string): string => {
    const v = o[k];
    if (planId(v)) return v;
    wrong.push(`${k} must be a plan id`);
    return '';
  };
  const required = (k: string, max: number): string => {
    const v = text(max)(o[k]);
    if (v === null) wrong.push(`${k} must be a non-empty text`);
    return v ?? '';
  };
  const order = (k: string): string[] => {
    const v = idList(o[k]);
    if (!v?.length) wrong.push(`${k} must be a non-empty list of plan ids`);
    return v ?? [];
  };
  // An optional field: absent it is undefined; present it must read.
  const optional = <T>(k: string, read: (x: unknown) => T | null, what: string): T | undefined => {
    if (o[k] === undefined) return undefined;
    const v = read(o[k]);
    if (v === null) wrong.push(`${k} ${what}`);
    return v ?? undefined;
  };
  const optText = (k: string, max: number) => optional(k, text(max), 'must be a non-empty text');
  const optStatus = () => optional('plan_status', status, 'must be committed or provisional');
  const none = (fields: readonly string[]) => {
    if (fields.every(f => o[f] === undefined)) wrong.push(`nothing to change: give ${fields.join(', ')}`);
  };
  let op: ReplanOp;
  const k = kind as ReplanOp['op'];
  switch (k) {
    case 'add-phase':
      op = {
        op: k, id: id('id'), name: required('name', TEXT_MAX.name), goal: optText('goal', PHASE_GOAL_MAX),
        after: optional('after', x => (planId(x) ? x : null), 'must be a plan id'), plan_status: optStatus(),
      };
      break;
    case 'edit-phase':
      op = { op: k, id: id('id'), name: optText('name', TEXT_MAX.name), goal: optText('goal', PHASE_GOAL_MAX), plan_status: optStatus() };
      none(PHASE_FIELDS);
      break;
    case 'order-phases':
      op = { op: k, phases: order('phases') };
      break;
    case 'move':
      op = { op: k, task: id('task'), phase: id('phase') };
      break;
    case 'order-tasks':
      op = { op: k, phase: id('phase'), tasks: order('tasks') };
      break;
    case 'edit': {
      const deps = optional('depends_on', idList, 'must be a list of plan ids');
      op = {
        op: k, task: id('task'), title: optText('title', TEXT_MAX.name), done_when: optText('done_when', TEXT_MAX.doneWhen),
        depends_on: deps && [...new Set(deps)], estimate_min: optional('estimate_min', minutes, 'must be a positive number of minutes'),
      };
      none(TASK_FIELDS);
      break;
    }
    case 'retire':
      op = { op: k, task: id('task'), why: required('why', TEXT_MAX.why) };
      break;
  }
  return wrong.length ? { error: wrong.join('; '), kind: k } : dropUndefined(op);
}

/** The operations of `{ "ops": [...] }` (L-1: the other keys of the file, such as a phase review's summary, are ignored).
 *  Each operation that is unknown or malformed is an error with its position; an empty list and more than MAX_OPS are one. */
export function normalizeOps(x: unknown): { ops: ReplanOp[]; errors: string[] } {
  const list = isObj(x) ? x.ops : undefined;
  if (!Array.isArray(list)) return { ops: [], errors: ['ops: not a list'] };
  if (!list.length) return { ops: [], errors: [EMPTY] };
  if (list.length > MAX_OPS) return { ops: [], errors: [TOO_MANY(list.length)] };
  const ops: ReplanOp[] = [];
  const errors: string[] = [];
  list.forEach((o, i) => {
    const r = readOp(o);
    if ('error' in r) errors.push(`ops[${i}]${r.kind ? ` ${r.kind}` : ''}: ${r.error}`);
    else ops.push(r);
  });
  return { ops, errors };
}

/** The plan's lists as nodes: its phases and tasks (plain maps) and the phase list of each version. */
interface Nodes { phases: YAMLSeq; tasks: YAMLSeq; versions: YAMLSeq[] }

function nodesOf(doc: Document): Nodes {
  const maps = (s: unknown): s is YAMLSeq => isSeq(s) && s.items.every(isMap);
  const phases = doc.get('phases', true), tasks = doc.get('tasks', true), versions = doc.get('versions', true);
  if (!maps(phases) || !maps(tasks) || (versions !== undefined && !maps(versions))) {
    throw new ReplanError(['plan: phases, tasks and versions must be lists of plain maps (no aliases)']);
  }
  const lists: unknown[] = versions === undefined ? [] : versions.items.map(v => (v as YAMLMap).get('phases', true));
  if (!lists.every((l): l is YAMLSeq => isSeq(l) && l.items.every(isScalar))) throw new ReplanError(['plan: the phases of each version must be a plain list']);
  return { phases, tasks, versions: lists };
}

const idOf = (n: unknown): string => (isMap(n) ? String(n.get('id')) : '');
const scalarOf = (n: unknown): string => (isScalar(n) ? String(n.value) : '');
const indexOf = (seq: YAMLSeq, id: string): number => seq.items.findIndex(n => idOf(n) === id);
const mapOf = (seq: YAMLSeq, id: string): YAMLMap | null => (seq.items.find(n => idOf(n) === id) as YAMLMap | undefined) ?? null;

/** What keeps `given` from being every one of `current` once, in some order: those missing, those that are none, those twice. */
function notEachOnce(given: string[], current: string[], what: string): string | null {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of given) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  const missing = current.filter(id => !seen.has(id));
  const extra = [...seen].filter(id => !current.includes(id));
  const parts = [
    missing.length ? `missing ${missing.join(', ')}` : '',
    extra.length ? `${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} not ${what}` : '',
    twice.size ? `${[...twice].join(', ')} twice` : '',
  ].filter(Boolean);
  return parts.length ? `the list must name each ${what} once: ${parts.join('; ')}` : null;
}

type Step = { change: string | null } | { issue: string };

/** One operation on the document's nodes: its change line (null when it changes nothing), or why it cannot be done. */
function applyOp(doc: Document, n: Nodes, op: ReplanOp, retired: string[]): Step {
  switch (op.op) {
    case 'add-phase': {
      if (indexOf(n.phases, op.id) >= 0) return { issue: `phase ${op.id} already exists` };
      let at = n.phases.items.length;
      if (op.after !== undefined) {
        const i = indexOf(n.phases, op.after);
        if (i < 0) return { issue: `phase ${op.after} not found` };
        at = i + 1;
      }
      const node = doc.createNode(dropUndefined({ id: op.id, name: op.name, plan_status: op.plan_status, goal: op.goal }));
      // Written like the phase next to it: the plans write phases as one-line maps.
      const like = n.phases.items[at - 1] ?? n.phases.items[at];
      if (isMap(like) && like.flow) node.flow = true;
      n.phases.items.splice(at, 0, node);
      // In the version that holds `after`, right after it; else at the end of the last version.
      const home = op.after === undefined ? undefined : n.versions.find(l => l.items.some(x => scalarOf(x) === op.after));
      const list = home ?? n.versions.at(-1);
      if (list) list.items.splice(home ? home.items.findIndex(x => scalarOf(x) === op.after) + 1 : list.items.length, 0, doc.createNode(op.id));
      return { change: `+${op.id} ${op.name}` };
    }
    case 'edit-phase': {
      const node = mapOf(n.phases, op.id);
      if (!node) return { issue: `phase ${op.id} not found` };
      const fields = PHASE_FIELDS.filter(k => op[k] !== undefined);
      for (const k of fields) node.set(k, op[k]);
      return { change: `${op.id}: ${fields.join(', ')}` };
    }
    case 'order-phases': {
      const wrong = notEachOnce(op.phases, n.phases.items.map(idOf), 'a phase');
      if (wrong) return { issue: wrong };
      const byId = new Map(n.phases.items.map(x => [idOf(x), x]));
      n.phases.items = op.phases.map(id => byId.get(id));
      // Each version keeps its phases, in the new order.
      const rank = (x: unknown) => op.phases.indexOf(scalarOf(x));
      for (const l of n.versions) l.items.sort((a, b) => rank(a) - rank(b));
      return { change: `phases: ${op.phases.join(', ')}` };
    }
    case 'move': {
      const node = mapOf(n.tasks, op.task);
      if (!node) return { issue: `task ${op.task} not found` };
      if (indexOf(n.phases, op.phase) < 0) return { issue: `phase ${op.phase} not found` };
      const from = String(node.get('phase'));
      if (from === op.phase) return { change: null };
      node.set('phase', op.phase);
      return { change: `${op.task}: ${from} → ${op.phase}` };
    }
    case 'order-tasks': {
      if (indexOf(n.phases, op.phase) < 0) return { issue: `phase ${op.phase} not found` };
      // The places the phase's tasks hold in the list take them in the new order; every other task stays where it is.
      const slots = n.tasks.items.flatMap((x, i) => (isMap(x) && String(x.get('phase')) === op.phase ? [i] : []));
      const byId = new Map(slots.map(i => [idOf(n.tasks.items[i]), n.tasks.items[i]]));
      const wrong = notEachOnce(op.tasks, [...byId.keys()], `a task of ${op.phase}`);
      if (wrong) return { issue: wrong };
      op.tasks.forEach((id, k) => { n.tasks.items[slots[k]] = byId.get(id); });
      return { change: `${op.phase}: ${op.tasks.join(', ')}` };
    }
    case 'edit': {
      const node = mapOf(n.tasks, op.task);
      if (!node) return { issue: `task ${op.task} not found` };
      const fields = TASK_FIELDS.filter(k => op[k] !== undefined);
      for (const k of fields) {
        if (k !== 'depends_on') { node.set(k, op[k]); continue; }
        const deps = doc.createNode(op.depends_on ?? []);
        deps.flow = true;
        node.set(k, deps);
      }
      return { change: `${op.task}: ${fields.join(', ')}` };
    }
    case 'retire': {
      const i = indexOf(n.tasks, op.task);
      if (i < 0) return { issue: `task ${op.task} not found` };
      n.tasks.items.splice(i, 1);
      retired.push(op.task);
      // The why is clipped to the room the line leaves it, so the line keeps its closing parenthesis.
      return { change: `−${op.task} (${fit(op.why, PLAN_HISTORY_MAX.change - op.task.length - 4)})` };
    }
  }
}

/** parsePlan, its problems as a ReplanError. */
function checked(text: string): void {
  try { parsePlan(text); } catch (e) {
    if (e instanceof PlanError) throw new ReplanError(e.issues);
    throw e;
  }
}

/** M-2: an entry keeps PLAN_HISTORY_MAX.changes lines; past that, its last line says how many more there were. */
function entryChanges(all: string[]): string[] {
  const max = PLAN_HISTORY_MAX.changes;
  return all.length <= max ? all : [...all.slice(0, max - 1), `… ${all.length - max + 1} more`];
}

/** Adds the entry to the plan's history and keeps the last PLAN_HISTORY_MAX.entries. */
function addHistory(doc: Document, entry: PlanHistoryEntry): void {
  const history = doc.get('history', true);
  // addIn on a missing key would set the entry itself, not a list holding it.
  if (!isSeq(history)) { doc.set('history', doc.createNode([entry])); return; }
  history.flow = false;
  doc.addIn(['history'], doc.createNode(entry));
  history.items.splice(0, Math.max(0, history.items.length - PLAN_HISTORY_MAX.entries));
}

/**
 * Applies the operations in order to the plan's text and adds one entry to its history: `{ text, changes }`, one line per
 * change (`T004: F2 → F3`, `phases: F1, F3, F2`, `F1: T003, T001, T002`, `+F3 Pulido`, `F3: name, goal`, `T006: done_when`,
 * `−T007 (<why>)`). The why and each line are cleaned and clipped (M-1), never refused for length. A batch that changes
 * nothing gives the text as it was, with no entry. Throws ReplanError with every problem: an id that does not exist, a new id
 * already taken, an order list incomplete or with extras, a retired task another still depends on once every operation is
 * applied, and those of parsePlan (cycles, references).
 */
export function applyReplan(text: string, ops: ReplanOp[], why: string, at: string): { text: string; changes: string[] } {
  if (!ops.length) throw new ReplanError([EMPTY]);
  if (ops.length > MAX_OPS) throw new ReplanError([TOO_MANY(ops.length)]);
  const reason = fit(why, PLAN_HISTORY_MAX.why);
  if (!reason) throw new ReplanError(['why: empty (the why is part of the history)']);
  checked(text);
  const doc = parseDocument(text);
  const nodes = nodesOf(doc);
  const issues: string[] = [];
  const changes: string[] = [];
  const retired: string[] = [];
  ops.forEach((op, i) => {
    const r = applyOp(doc, nodes, op, retired);
    if ('issue' in r) issues.push(`ops[${i}] ${op.op}: ${r.issue}`);
    else if (r.change !== null) changes.push(fit(r.change, PLAN_HISTORY_MAX.change));
  });
  // A retire is checked against the plan after every operation: an edit of the same batch may lift the dependency.
  const tasks = (doc.toJS() as { tasks: { id: string; depends_on?: string[] }[] }).tasks;
  for (const id of retired) {
    const users = tasks.filter(t => t.depends_on?.includes(id)).map(t => t.id);
    if (users.length) issues.push(`retire ${id}: ${users.join(', ')} still depend${users.length === 1 ? 's' : ''} on it`);
  }
  if (issues.length) throw new ReplanError(issues);
  if (!changes.length) return { text, changes };
  addHistory(doc, { at, why: reason, changes: entryChanges(changes) });
  // lineWidth 0: no folding, so a long text the replan did not touch keeps its one line.
  const next = doc.toString({ lineWidth: 0 });
  checked(next);
  return { text: next, changes };
}
