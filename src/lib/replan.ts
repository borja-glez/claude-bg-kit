// 6b-3 Task 1: `waypoint replan`. It moves tasks between phases, orders phases and tasks, adds and edits phases, edits
// and retires tasks, and never renumbers an id. The operations change the nodes of the YAML document, never its text, so
// comments and the order of everything else stay. One history entry per replan stays in plan.yaml, and the result must
// pass parsePlan before the caller writes anything.
import { isMap, isScalar, isSeq, parseDocument, visit, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { clean } from './decisions.js';
import { parsePlan, PlanError, isPlanId } from './plan.js';
import { fitText } from './plan-history.js';
import { PHASE_GOAL_MAX, PLAN_HISTORY_MAX, type Plan, type PlanHistoryEntry, type PlanStatus } from './types.js';

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

type Raw = Record<string, unknown>;
const isObj = (x: unknown): x is Raw => !!x && typeof x === 'object' && !Array.isArray(x);
const planId = (x: unknown): x is string => typeof x === 'string' && isPlanId(x);
const text = (max: number) => (x: unknown): string | null => (typeof x === 'string' ? fitText(x, max) || null : null);
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
  if (Array.isArray(x)) return { ops: [], errors: ['ops: the file must be { "ops": [...] }, not a bare list'] };
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

/** The plan's lists as nodes: its phases and tasks (maps) and the phase list of each version. */
interface Nodes { phases: YAMLSeq; tasks: YAMLSeq; versions: YAMLSeq[] }

function nodesOf(doc: Document): Nodes {
  // m-2: an alias (`*name`) that an order or a retire moves before its anchor cannot be written back, so none is taken.
  let alias = false;
  visit(doc, { Alias: () => { alias = true; return visit.BREAK; } });
  if (alias) throw new ReplanError(['plan: it uses an alias (*name), which a replan cannot keep in place: write the value out in plan.yaml']);
  const maps = (s: unknown): s is YAMLSeq => isSeq(s) && s.items.every(isMap);
  const phases = doc.get('phases', true), tasks = doc.get('tasks', true), versions = doc.get('versions', true);
  if (!maps(phases) || !maps(tasks) || (versions !== undefined && !maps(versions))) {
    throw new ReplanError(['plan: phases, tasks and versions must be lists of maps']);
  }
  const lists: unknown[] = versions === undefined ? [] : versions.items.map(v => (v as YAMLMap).get('phases', true));
  if (!lists.every((l): l is YAMLSeq => isSeq(l) && l.items.every(isScalar))) throw new ReplanError(['plan: the phases of each version must be a list of ids']);
  return { phases, tasks, versions: lists };
}

const idOf = (n: unknown): string => (isMap(n) ? String(n.get('id')) : '');
const scalarOf = (n: unknown): string => (isScalar(n) ? String(n.value) : '');
const indexOf = (seq: YAMLSeq, id: string): number => seq.items.findIndex(n => idOf(n) === id);
const mapOf = (seq: YAMLSeq, id: string): YAMLMap | null => (seq.items.find(n => idOf(n) === id) as YAMLMap | undefined) ?? null;
/** A task's dependencies as written; none when it has no `depends_on` (the schema's default). */
const depsOf = (task: unknown): string[] => {
  const d = isMap(task) ? task.get('depends_on', true) : undefined;
  return isSeq(d) ? d.items.map(scalarOf) : [];
};

/** What keeps `given` from naming every one of `current` once, in some order: those missing, those that are none, those
 *  twice. `one` and `many` name what the list holds (a phase, phases). */
function notEachOnce(given: string[], current: string[], one: string, many: string): string | null {
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
    extra.length ? `${extra.join(', ')} ${extra.length === 1 ? `is not a ${one}` : `are not ${many}`}` : '',
    twice.size ? `${[...twice].join(', ')} twice` : '',
  ].filter(Boolean);
  return parts.length ? `the list must name every ${one} once: ${parts.join('; ')}` : null;
}

type Step = { change: string | null } | { issue: string };

/** One operation on the document's nodes: its change line (m-1: null when it changes nothing), or why it cannot be done. */
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
      // A phase without plan_status is committed, the schema's default.
      const now = (k: (typeof PHASE_FIELDS)[number]) => node.get(k) ?? (k === 'plan_status' ? 'committed' : undefined);
      const fields = PHASE_FIELDS.filter(k => op[k] !== undefined && op[k] !== now(k));
      if (!fields.length) return { change: null };
      for (const k of fields) node.set(k, op[k]);
      return { change: `${op.id}: ${fields.join(', ')}` };
    }
    case 'order-phases': {
      const wrong = notEachOnce(op.phases, n.phases.items.map(idOf), 'phase', 'phases');
      if (wrong) return { issue: wrong };
      const shape = () => JSON.stringify([n.phases.items.map(idOf), n.versions.map(l => l.items.map(scalarOf))]);
      const before = shape();
      const byId = new Map(n.phases.items.map(x => [idOf(x), x]));
      n.phases.items = op.phases.map(id => byId.get(id));
      // Each version keeps its phases, in the new order.
      const rank = (x: unknown) => op.phases.indexOf(scalarOf(x));
      for (const l of n.versions) l.items.sort((a, b) => rank(a) - rank(b));
      return { change: shape() === before ? null : `phases: ${op.phases.join(', ')}` };
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
      const wrong = notEachOnce(op.tasks, [...byId.keys()], `task of ${op.phase}`, `tasks of ${op.phase}`);
      if (wrong) return { issue: wrong };
      if ([...byId.keys()].join() === op.tasks.join()) return { change: null };
      op.tasks.forEach((id, k) => { n.tasks.items[slots[k]] = byId.get(id); });
      return { change: `${op.phase}: ${op.tasks.join(', ')}` };
    }
    case 'edit': {
      const node = mapOf(n.tasks, op.task);
      if (!node) return { issue: `task ${op.task} not found` };
      // N-3: dependencies are a set: the same tasks in another order are no change.
      const sameSet = (a: string[], b: string[]) => { const s = new Set(a); return s.size === new Set(b).size && b.every(x => s.has(x)); };
      const same = (k: (typeof TASK_FIELDS)[number]) => (k === 'depends_on' ? sameSet(depsOf(node), op.depends_on ?? []) : node.get(k) === op[k]);
      const fields = TASK_FIELDS.filter(k => op[k] !== undefined && !same(k));
      if (!fields.length) return { change: null };
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
      return { change: `−${op.task} (${fitText(op.why, PLAN_HISTORY_MAX.change - op.task.length - 4)})` };
    }
  }
}

/** parsePlan, its problems as a ReplanError. */
function checked(text: string): Plan {
  try { return parsePlan(text); } catch (e) {
    if (e instanceof PlanError) throw new ReplanError(e.issues);
    throw e;
  }
}

/** The plan as the roadmap and every agent read it: its history aside. */
const shapeOf = (p: Plan): string => JSON.stringify({ ...p, history: undefined });

/** m-3: the document as text, in the line endings of the file it came from. A document yaml cannot write is a ReplanError. */
function serialize(doc: Document, eol: string): string {
  let out: string;
  // lineWidth 0: no folding, so a long text the replan did not touch keeps its one line.
  try { out = doc.toString({ lineWidth: 0 }); } catch (e) { throw new ReplanError([`plan: yaml cannot write the result: ${(e as Error).message}`]); }
  return eol === '\n' ? out : out.replace(/\n/g, eol);
}

/** T6B3-RETIRED-IDS: each retired id joins the plan's `retired` list (uncapped, once each), which to-task mints past. */
function addRetired(doc: Document, ids: string[]): void {
  const list = doc.get('retired', true);
  if (!isSeq(list)) {
    const node = doc.createNode(ids);
    node.flow = true;
    doc.set('retired', node);
    return;
  }
  for (const id of ids) if (!list.items.some(x => scalarOf(x) === id)) list.items.push(doc.createNode(id));
}

/** M-2: an entry keeps PLAN_HISTORY_MAX.changes lines; past that, its last line says how many more there were. */
function entryChanges(all: string[]): string[] {
  const max = PLAN_HISTORY_MAX.changes;
  return all.length <= max ? all : [...all.slice(0, max - 1), `… ${all.length - max + 1} more`];
}

/** Adds the entry to the plan's history and keeps the last PLAN_HISTORY_MAX.entries items of its list. */
function addHistory(doc: Document, entry: PlanHistoryEntry): void {
  const history = doc.get('history', true);
  // addIn on a missing key would set the entry itself, not a list holding it; a history that is no list reads as none.
  if (!isSeq(history)) { doc.set('history', doc.createNode([entry])); return; }
  history.flow = false;
  doc.addIn(['history'], doc.createNode(entry));
  history.items.splice(0, Math.max(0, history.items.length - PLAN_HISTORY_MAX.entries));
}

/**
 * Applies the operations in order to the plan's text and adds one entry to its history: `{ text, changes }`, one line per
 * change (`T004: F2 → F3`, `phases: F1, F3, F2`, `F1: T003, T001, T002`, `+F3 Pulido`, `F3: name, goal`, `T006: done_when`,
 * `−T007 (<why>)`). A retired id joins `retired`. The why and each line are cleaned and clipped (M-1), never refused for
 * length. An operation that changes nothing gives no line, and a batch whose plan comes out the same gives the text as it
 * was, with no entry (m-1). Throws ReplanError with every problem: an id that does not exist, a new id already taken, an
 * order list incomplete or with extras, a retired task another still depends on once every operation is applied, an alias,
 * and those of parsePlan (cycles, references).
 */
export function applyReplan(text: string, ops: ReplanOp[], why: string, at: string): { text: string; changes: string[] } {
  if (!ops.length) throw new ReplanError([EMPTY]);
  if (ops.length > MAX_OPS) throw new ReplanError([TOO_MANY(ops.length)]);
  const reason = fitText(why, PLAN_HISTORY_MAX.why);
  if (!reason) throw new ReplanError(['why: empty (the why is part of the history)']);
  const before = checked(text);
  const doc = parseDocument(text);
  const nodes = nodesOf(doc);
  const issues: string[] = [];
  const changes: string[] = [];
  const retired: string[] = [];
  ops.forEach((op, i) => {
    const r = applyOp(doc, nodes, op, retired);
    if ('issue' in r) issues.push(`ops[${i}] ${op.op}: ${r.issue}`);
    else if (r.change !== null) changes.push(fitText(r.change, PLAN_HISTORY_MAX.change));
  });
  // A retire is checked against the plan after every operation: an edit of the same batch may lift the dependency.
  for (const id of retired) {
    const users = nodes.tasks.items.filter(t => depsOf(t).includes(id)).map(idOf);
    if (users.length) issues.push(`retire ${id}: ${users.join(', ')} still depend${users.length === 1 ? 's' : ''} on it`);
  }
  if (issues.length) throw new ReplanError(issues);
  if (!changes.length) return { text, changes: [] };
  if (retired.length) addRetired(doc, retired);
  // m-3, N-1: CRLF only when most of the file's line breaks are CRLF; one stray CRLF line leaves a file LF.
  const eol = (text.match(/\r\n/g) ?? []).length * 2 > (text.match(/\n/g) ?? []).length ? '\r\n' : '\n';
  // m-1: a move away and back, say, leaves the plan as it was: nothing to write, no history entry.
  if (shapeOf(checked(serialize(doc, eol))) === shapeOf(before)) return { text, changes: [] };
  addHistory(doc, { at, why: reason, changes: entryChanges(changes) });
  const next = serialize(doc, eol);
  checked(next);
  return { text: next, changes };
}
