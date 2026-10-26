// w8 W2: what the plan sync needs written, worked out on text by the CLI so the session never writes it. In a background
// session that has not entered a worktree Claude Code refuses every Write, Edit and out_dir inside the shared checkout
// (bgIsolation), and a session in a track worktree must not write into the main checkout: the CLI writes the roadmap URL
// into plan.yaml (setRoadmapText), adds a delegated task to it (addTaskText), reads the versions the session listed
// (parseVersions) and turns a listing read into the conversation into documents (parseListing). Pure but for
// backgroundGuard, which reads the environment and a few files: run.ts reads and writes the files.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document } from 'yaml';
import { parsePlan, PlanError } from '../lib/plan.js';
import type { Known } from '../lib/sync.js';

/**
 * Fix round 1 (Important 2): whether this is a background session of Claude Code in a repository's main checkout, where
 * Claude Code refuses every Write, Edit and out_dir (bgIsolation), with the job's temp folder it may write to. The CLI
 * inherits the session's environment: `CLAUDE_JOB_DIR` (and `CLAUDE_CODE_SESSION_KIND=bg`, when it is passed on). The
 * guard is off with `CLAUDE_BG_ISOLATION=none`, or `worktree.bgIsolation: none` in the checkout's .claude/settings.local.json,
 * .claude/settings.json or the user's settings.json (in that order of precedence), and in a linked worktree (its `.git`
 * is a file) or outside a repository. Null when there is no guard.
 */
export function backgroundGuard(env: Record<string, string | undefined>, cwd: string): { jobTmp: string } | null {
  const job = env.CLAUDE_JOB_DIR;
  if (!job || (env.CLAUDE_CODE_SESSION_KIND !== undefined && env.CLAUDE_CODE_SESSION_KIND !== 'bg')) return null;
  let root: string | null = null;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const git = path.join(dir, '.git');
    if (existsSync(git)) {
      try { if (statSync(git).isDirectory()) root = dir; } catch { root = null; }
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  if (!root) return null;
  const isolation = env.CLAUDE_BG_ISOLATION;
  if (isolation === 'none') return null;
  if (isolation !== 'worktree') {
    const user = env.CLAUDE_CONFIG_DIR ?? path.join(env.USERPROFILE ?? env.HOME ?? '', '.claude');
    for (const file of [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(user, 'settings.json')]) {
      let mode: unknown;
      try { mode = (JSON.parse(readFileSync(file, 'utf8')) as { worktree?: { bgIsolation?: unknown } } | null)?.worktree?.bgIsolation; } catch { continue; }
      if (mode === 'none') return null;
      if (mode === 'worktree') break;
    }
  }
  return { jobTmp: path.join(job, 'tmp') };
}

/** A collection name, as clean-cache takes it. */
export const COLLECTION = /^[a-z_]{1,32}$/;
/** A document id that names a file on every system: the ArtifactData id characters but `:` (Windows), never `.` or `..`. */
const FILE_ID = /^[A-Za-z0-9_.~@+-]{1,200}$/;
const fileId = (id: string): boolean => FILE_ID.test(id) && id !== '.' && id !== '..';

export class PlanFileError extends Error {
  constructor(public issues: string[]) {
    super(issues.join('; '));
    this.name = 'PlanFileError';
  }
}

/** The document as text, in the line endings of the file it came from (as replan writes it). */
function serialize(doc: Document, text: string): string {
  const out = doc.toString({ lineWidth: 0 });
  const crlf = (text.match(/\r\n/g) ?? []).length * 2 > (text.match(/\n/g) ?? []).length;
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

/** Whether `url` is a web link a plan may hold as its roadmap: http(s), read by `new URL`, one line. */
export function isWebLink(url: string | undefined): url is string {
  if (!url || !/^https?:\/\/\S+$/i.test(url)) return false;
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

type AnyPair = { key: unknown; value: unknown };
const keyOf = (p: AnyPair): string => (isScalar(p.key) ? String(p.key.value) : String(p.key));
const rangeOf = (n: unknown): [number, number] | null => {
  const r = (n as { range?: unknown } | null)?.range;
  return Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' ? [r[0], r[1]] : null;
};

/**
 * The plan's text with `artifacts.roadmap` set to `url`, edited where that value sits, so no other byte of the plan
 * changes (yaml's own writer would respace every flow list of it): a flow `artifacts: {…}` keeps its other entries and
 * gets `roadmap`, a block one gets its `roadmap:` line set or added, and a plan without `artifacts` gets the line
 * `artifacts: { roadmap: "<url>" }` after `version`. The URL is written as a double-quoted scalar. Unchanged (changed
 * false) when the plan holds that URL already. Throws PlanError when the plan does not validate, or when the edit would
 * change anything else of it.
 */
export function setRoadmapText(text: string, url: string): { text: string; changed: boolean } {
  const before = parsePlan(text);
  if (before.artifacts.roadmap === url) return { text, changed: false };
  const doc = parseDocument(text);
  const root = doc.contents;
  if (!isMap(root)) throw new PlanError(['(root): the plan is not a mapping']);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const q = JSON.stringify(url);
  const splice = (at: number, end: number, s: string) => text.slice(0, at) + s + text.slice(end);
  // Where the line holding a node's end ends: a node written over several lines (a block scalar) ends after its last
  // line break already.
  const lineEnd = (at: number) => (text[at - 1] === '\n' ? at : lineEndAfter(text, at));
  const pair = (root.items as AnyPair[]).find(p => keyOf(p) === 'artifacts');
  let out: string;
  if (!pair) {
    const version = (root.items as AnyPair[]).find(p => keyOf(p) === 'version');
    const end = rangeOf(version?.value);
    const line = `artifacts: { roadmap: ${q} }`;
    if (end) {
      const at = lineEnd(end[1]);
      out = splice(at, at, `${at === text.length && !text.endsWith('\n') ? eol : ''}${line}${eol}`);
    } else out = `${text}${text.endsWith('\n') ? '' : eol}${line}${eol}`;
  } else if (isMap(pair.value) && pair.value.flow) {
    const r = rangeOf(pair.value);
    if (!r) throw new PlanError(['artifacts: cannot find it in the plan']);
    const entries = (pair.value.items as AnyPair[]).filter(p => keyOf(p) !== 'roadmap').map(p => {
      const k = rangeOf(p.key), v = rangeOf(p.value);
      if (!k || !v) throw new PlanError(['artifacts: cannot find its entries in the plan']);
      return text.slice(k[0], v[1]);
    });
    out = splice(r[0], r[1], `{ ${[...entries, `roadmap: ${q}`].join(', ')} }`);
  } else if (isMap(pair.value)) {
    const items = pair.value.items as AnyPair[];
    const roadmap = items.find(p => keyOf(p) === 'roadmap');
    const v = rangeOf(roadmap?.value);
    if (roadmap && v) out = splice(v[0], v[1], q);
    else {
      const first = rangeOf(items[0]?.key), last = rangeOf(items.at(-1)?.value);
      if (!first || !last) throw new PlanError(['artifacts: cannot find its entries in the plan']);
      const indent = first[0] - (text.lastIndexOf('\n', first[0]) + 1);
      const at = lineEnd(last[1]);
      out = splice(at, at, `${at === text.length && !text.endsWith('\n') ? eol : ''}${' '.repeat(indent)}roadmap: ${q}${eol}`);
    }
  } else throw new PlanError(['artifacts: must be a mapping']);
  const after = parsePlan(out);
  const rest = (p: typeof before) => JSON.stringify({ ...p, artifacts: { ...p.artifacts, roadmap: undefined } });
  if (after.artifacts.roadmap !== url || rest(after) !== rest(before)) throw new PlanError(['artifacts.roadmap: could not be set without changing the rest of the plan']);
  return { text: out, changed: true };
}

/** The fields a plan task takes (src/lib/plan.ts), in the order the new task is written. */
const TASK_KEYS = ['id', 'title', 'track', 'phase', 'category', 'includes', 'done_when', 'verification', 'depends_on', 'zones',
  'estimate_min', 'delicate', 'design_ref', 'review_focus'] as const;

/** The index after the line break that ends the line holding `at`, or the end of the text. */
const lineEndAfter = (text: string, at: number): number => { const i = text.indexOf('\n', at); return i < 0 ? text.length : i + 1; };

/** A value of a new task as one line of YAML: a list in flow style, a scalar as yaml writes it, or as a JSON string. */
function valueLine(v: unknown): string {
  if (Array.isArray(v)) return stringify(v, { collectionStyle: 'flow', flowCollectionPadding: false, lineWidth: 0 }).trim();
  const s = stringify(v, { lineWidth: 0 }).trim();
  return s.includes('\n') ? JSON.stringify(v) : s;
}

/**
 * The plan's text with one task added at the end of `tasks` (as forge's to-task adds one), from untrusted JSON: an object
 * with only the fields a plan task takes. In a block list the task's lines go after the last task, at its indentation,
 * so no other byte of the plan changes; a flow list is rewritten by yaml. The result must validate (its id new and not
 * retired, its track, phase and dependencies known) and hold the plan as it was plus that task, or nothing is returned:
 * throws PlanFileError with every problem.
 */
export function addTaskText(text: string, raw: unknown): { text: string; id: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PlanFileError(['the task must be a JSON object']);
  const o = raw as Record<string, unknown>;
  const unknown = Object.keys(o).filter(k => !(TASK_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new PlanFileError([`unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map(k => JSON.stringify(k.slice(0, 40))).join(', ')}`]);
  if (typeof o.id !== 'string') throw new PlanFileError(['id: a task id is required']);
  const keys = TASK_KEYS.filter(k => o[k] !== undefined);
  let before: ReturnType<typeof parsePlan>;
  try { before = parsePlan(text); } catch (e) {
    if (e instanceof PlanError) throw new PlanFileError(e.issues);
    throw e;
  }
  const doc = parseDocument(text);
  const tasks = isMap(doc.contents) ? (doc.contents.items as AnyPair[]).find(p => keyOf(p) === 'tasks')?.value : undefined;
  if (!isSeq(tasks)) throw new PlanFileError(['the plan has no tasks list']);
  let out: string;
  const first = rangeOf(tasks.items[0]), last = rangeOf(tasks.items.at(-1));
  if (!tasks.flow && first && last) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lineStart = text.lastIndexOf('\n', first[0]) + 1;
    const dash = text.slice(lineStart, first[0]).indexOf('-');
    const pad = ' '.repeat(Math.max(0, dash));
    const lines = keys.map((k, i) => `${pad}${i === 0 ? '- ' : '  '}${k}: ${valueLine(o[k])}`);
    // The last task's node ends after its line break (or at the end of a file without one): the new lines go there.
    const at = text[last[1] - 1] === '\n' ? last[1] : lineEndAfter(text, last[1]);
    out = text.slice(0, at) + (text[at - 1] === '\n' || at === 0 ? '' : eol) + lines.join(eol) + eol + text.slice(at);
  } else {
    doc.addIn(['tasks'], doc.createNode(Object.fromEntries(keys.map(k => [k, o[k]]))));
    out = serialize(doc, text);
  }
  let after: ReturnType<typeof parsePlan>;
  try { after = parsePlan(out); } catch (e) {
    if (e instanceof PlanError) throw new PlanFileError(e.issues);
    throw e;
  }
  const added = after.tasks.at(-1);
  if (added?.id !== o.id || JSON.stringify({ ...after, tasks: after.tasks.slice(0, -1) }) !== JSON.stringify(before)) {
    throw new PlanFileError(['the task could not be added without changing the rest of the plan']);
  }
  return { text: out, id: o.id };
}

/**
 * The versions a session listed, as `sync --versions` takes them: collection → document id → version, e.g.
 * `{"meta":{"project":3},"plan":{},"state":{"T001":5}}`. Throws PlanFileError when it is anything else.
 */
export function parseVersions(json: string): Known {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new PlanFileError(['--versions is not JSON']); }
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!obj(raw)) throw new PlanFileError(['--versions must map each collection to its documents\' versions']);
  const out: Known = {};
  for (const [c, docs] of Object.entries(raw)) {
    if (!COLLECTION.test(c) || !obj(docs)) throw new PlanFileError([`--versions: ${JSON.stringify(c.slice(0, 40))} is no collection with its documents' versions`]);
    out[c] = {};
    for (const [id, v] of Object.entries(docs)) {
      if (!Number.isInteger(v) || (v as number) < 1) throw new PlanFileError([`--versions: ${c}/${id.slice(0, 80)} must be a positive whole version`]);
      out[c][id] = v as number;
    }
  }
  return out;
}

export interface ListedDoc { id: string; data: Record<string, unknown>; version: number }

/**
 * The documents of an ArtifactData listing of `collection` read into the conversation (no out_dir), as the session
 * saved it: the tool's text, «N documents from collection "x": === BEGIN ARTIFACT DB … === {…} {…} === END … ===», or
 * «No documents matched in collection "x".». Each top-level JSON object with a string `id`, an object `data` and a
 * positive whole `version` is a document; one whose id names no file is skipped and named in `skipped`. Fix round 1
 * (Minor 4): the header must be there, name `collection`, and count every document the file holds, so a copy into the
 * wrong file or one cut short throws instead of passing for the listing.
 */
export function parseListing(text: string, collection: string): { docs: ListedDoc[]; skipped: string[] } {
  const heads = [...text.matchAll(/\b(\d+) documents? from collection "([^"\n]*)"|\bno documents matched in collection "([^"\n]*)"/gi)]
    .map(m => ({ count: m[1] !== undefined ? Number(m[1]) : 0, of: m[2] ?? m[3] ?? '' }));
  if (!heads.length) throw new PlanFileError(['no listing header («N documents from collection …»): save the text ArtifactData list printed, as it is']);
  const other = heads.find(h => h.of !== collection);
  if (other) throw new PlanFileError([`the listing is of collection ${JSON.stringify(other.of)}, not ${JSON.stringify(collection)}: save each collection's listing to its own file`]);
  const docs: ListedDoc[] = [];
  const skipped: string[] = [];
  for (const v of topLevelObjects(text)) {
    const d = v as { id?: unknown; data?: unknown; version?: unknown };
    if (typeof d.id !== 'string' || !d.data || typeof d.data !== 'object' || Array.isArray(d.data) || !Number.isInteger(d.version) || (d.version as number) < 1) continue;
    if (!fileId(d.id)) { skipped.push(d.id.slice(0, 80)); continue; }
    docs.push({ id: d.id, data: d.data as Record<string, unknown>, version: d.version as number });
  }
  const said = heads.reduce((n, h) => n + h.count, 0);
  const held = docs.length + skipped.length;
  if (said !== held) throw new PlanFileError([`the listing says ${said} document${said === 1 ? '' : 's'} and the file holds ${held}: save the whole result, as it is`]);
  return { docs, skipped };
}

/**
 * Each top-level JSON object of `text`, parsed: outside an object nothing is read as JSON (prose quotes pair with
 * nothing), inside one strings and their escapes are, so a brace in a string never closes it. A brace that opens no JSON
 * object (prose) is passed over, and the scan goes on right after it.
 */
function topLevelObjects(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = j; break; }
    }
    if (end < 0) continue;
    try { out.push(JSON.parse(text.slice(i, end + 1))); i = end; } catch { /* prose: go on after this brace */ }
  }
  return out;
}
