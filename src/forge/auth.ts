// I-03: the authorizations the person gives with an answer of theirs. forge prints a question (`ask`), the skill asks it
// with AskUserQuestion exactly as printed, and the hook `answer` (PostToolUse on AskUserQuestion) records the answer in
// .forge/execution/auth/<authId>.json of the main checkout: a `--yes` alone is never one.
// - `merge` lets `swarm merge --yes` merge a run into a branch that is not forge's: answered yes by the session that
//   merges, less than 60 minutes ago; the merge it allows uses it.
// - `merge-on-finish` lets `swarm start --merge-on-finish` set mergeOnFinish. It is tied to the run id, with no session and
//   no expiry, because the start question is answered in the design session and the run starts in another after /clear.
//   One asked before the run exists (auto mode at launch) has no run id and is tied to the session that asked instead.
// Writing these files by hand gets past it: this closes the casual path (adding --yes), not a deliberate forgery.
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { isRunBranch, isSafeId } from '../lib/execution-state.js';
import { writeJsonAtomic } from './jobs.js';
import { mainCheckout } from './local.js';

export type AuthKind = 'merge' | 'merge-on-finish';
export interface AuthOption { label: string; description: string }
export interface AuthAsk { question: string; header: string; options: AuthOption[]; multiSelect: false }
export interface AuthRecord {
  authId: string; kind: AuthKind; runId: string | null; target: string; question: string; yes: string; createdAt: string;
  /** C1 id of the session that asked: on a merge record, and on a merge-on-finish record without a run; else null. */
  session: string | null;
  answeredAt?: string; answer?: 'yes' | 'no'; answeredBy?: string | null; usedAt?: string;
}
export type MergeAuthReason = 'no session id' | 'no answer recorded' | 'answered no' | 'expired' | 'other session' | 'other run' | 'other branch' | 'already used';
export type MofReason = 'no answer recorded' | 'answered no' | 'other run' | 'other branch' | 'already used';

/** A merge record allows the merge for this long after its answer. */
export const MERGE_AUTH_TTL_MS = 60 * 60_000;
/** The records read: the ones written last. */
const MAX_RECORDS = 200;
/** A record takes a few kilobytes at most (a question of 4000 characters); a bigger file is not one. */
const MAX_RECORD_BYTES = 64 * 1024;
const TRANSCRIPT_TAIL = 2 * 1024 * 1024;
const TRANSCRIPT_LINES = 400;
/** AskUserQuestion asks at most four questions; more are not looked at. */
const MAX_QUESTIONS = 16;
const AUTH_ID = /^(?:merge|mof)-[A-Za-z0-9_.-]{1,120}-[0-9a-z]{4}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const authDir = (root: string) => path.join(mainCheckout(root), '.forge', 'execution', 'auth');
/** A branch forge owns (forge/run-<p>, forge/infinite-<date>): merging into it needs no answer of the person. */
export const isForgeBranch = (b: string) => b.startsWith('forge/');

const iso = (x: unknown): string | undefined => (typeof x === 'string' && ISO_INSTANT.test(x) && !Number.isNaN(Date.parse(x)) ? x : undefined);
const text = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length > 0 && x.length <= max ? x : null);
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function normalizeAuth(x: unknown): AuthRecord | null {
  if (!isObject(x)) return null;
  const o = x;
  const kind = o.kind === 'merge' || o.kind === 'merge-on-finish' ? o.kind : null;
  const authId = text(o.authId, 200);
  // The id names the file and says the kind: merge-… for a merge, mof-… for a merge on finish.
  if (!kind || !authId || !AUTH_ID.test(authId) || !authId.startsWith(kind === 'merge' ? 'merge-' : 'mof-')) return null;
  const runId = o.runId === null ? null : isSafeId(o.runId) ? o.runId : undefined;
  const target = text(o.target, 120);
  const question = text(o.question, 4000);
  const yes = text(o.yes, 200);
  const createdAt = iso(o.createdAt);
  if (runId === undefined || !target || !isRunBranch(target) || !question || !yes || !createdAt) return null;
  return {
    authId, kind, runId, target, question, yes, createdAt, session: isSafeId(o.session) ? o.session : null,
    ...(iso(o.answeredAt) ? { answeredAt: iso(o.answeredAt) } : {}),
    ...(o.answer === 'yes' || o.answer === 'no' ? { answer: o.answer } : {}),
    ...(o.answeredBy === null || isSafeId(o.answeredBy) ? { answeredBy: o.answeredBy as string | null } : {}),
    ...(iso(o.usedAt) ? { usedAt: iso(o.usedAt) } : {}),
  };
}

/**
 * The files of `dir` worth reading, by name: plain files named <authId>.json of a record's size, the MAX_RECORDS
 * written last (a sort by name would drop the newest once there are more).
 */
function recordFiles(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const found: { name: string; mtime: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || !AUTH_ID.test(name.slice(0, -'.json'.length))) continue;
    try {
      const st = lstatSync(path.join(dir, name));
      if (st.isFile() && st.size <= MAX_RECORD_BYTES) found.push({ name, mtime: st.mtimeMs });
    } catch { /* gone meanwhile */ }
  }
  found.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found.slice(0, MAX_RECORDS).map(f => f.name).sort();
}

/** The records of an auth directory; one that does not read back, or whose file name is not its authId, is skipped. */
function readAuthsIn(dir: string): AuthRecord[] {
  const out: AuthRecord[] = [];
  for (const n of recordFiles(dir)) {
    try {
      const r = normalizeAuth(JSON.parse(readFileSync(path.join(dir, n), 'utf8')));
      if (r && `${r.authId}.json` === n) out.push(r);
    } catch { /* skipped */ }
  }
  return out;
}

/** Writes a record atomically under its authId; one that would not read back (a bad id, branch or date) throws. */
function writeAuthIn(dir: string, r: AuthRecord): void {
  const rec = normalizeAuth(r);
  if (!rec) throw new Error('auth: not an authorization record');
  writeJsonAtomic(path.join(dir, `${rec.authId}.json`), rec);
}

/** The records of the main checkout; one that does not read back, or whose file name is not its authId, is skipped. */
export const readAuths = (root: string): AuthRecord[] => readAuthsIn(authDir(root));

export function writeAuth(root: string, r: AuthRecord): void {
  writeAuthIn(authDir(root), r);
}

/** merge-<runId>-<4 base36> or mof-<runId>-<4 base36>; a merge-on-finish without a run says `launch`. */
export function newAuthId(kind: AuthKind, runId: string | null, rand: () => number): string {
  const n = Math.floor(rand() * 36 ** 4) % 36 ** 4;
  return `${kind === 'merge' ? 'merge' : 'mof'}-${runId ?? 'launch'}-${n.toString(36).padStart(4, '0')}`;
}

/** The question of a merge of `branch` into `target` now, and its yes label. */
export function mergeAsk(authId: string, branch: string, target: string, es: boolean): { ask: AuthAsk; yes: string } {
  const yes = es ? 'Sí, intégrala' : 'Yes, merge it';
  return {
    yes,
    ask: {
      question: es ? `¿Integro ${branch} en ${target}? [${authId}]` : `Do I merge ${branch} into ${target}? [${authId}]`,
      header: es ? 'Integrar' : 'Merge',
      options: [
        { label: yes, description: es ? `forge fusiona ${branch} en ${target} ahora` : `forge merges ${branch} into ${target} now` },
        { label: 'No', description: es ? `${branch} se queda como está` : `${branch} stays as it is` },
      ],
      multiSelect: false,
    },
  };
}

/** The start question of a run that may merge into `target` by itself when it ends (no first), and its yes label. */
export function mofAsk(authId: string, target: string, es: boolean, isDefault: boolean): { ask: AuthAsk; yes: string } {
  const yes = es ? `Sí, intégrala en ${target}` : `Yes, merge it into ${target}`;
  const where = isDefault
    ? (es ? `${target} es la rama por defecto del repositorio` : `${target} is the repository's default branch`)
    : (es ? `forge integra la rama de ejecución en ${target} al acabar` : `forge merges the run branch into ${target} when it ends`);
  return {
    yes,
    ask: {
      question: es
        ? `Cuando todo esté hecho y la revisión final pase, ¿integro la rama de ejecución en ${target} sin preguntarte? [${authId}]`
        : `When everything is done and the final review passes, do I merge the run branch into ${target} without asking you? [${authId}]`,
      header: es ? 'Al acabar' : 'On finish',
      options: [
        { label: es ? 'No, la reviso yo (Recomendado)' : 'No, I will review it (Recommended)', description: es ? 'al acabar te pregunto antes de integrar' : 'when it ends I ask you before merging' },
        { label: yes, description: where },
      ],
      multiSelect: false,
    },
  };
}

/**
 * A question that waits for its answer: the open record of the same kind, run, branch and session (a merge one younger
 * than MERGE_AUTH_TTL_MS) when its question still reads the same, else a new record under an id no file has.
 */
export function pendingAuth(root: string, o: {
  kind: AuthKind; runId: string | null; target: string; session: string | null; now: Date; rand: () => number;
  build: (authId: string) => { ask: AuthAsk; yes: string };
}): { authId: string; ask: AuthAsk } {
  const dir = authDir(root);
  const recs = readAuthsIn(dir);
  const nowMs = o.now.getTime();
  const open = recs.find(r => r.kind === o.kind && r.runId === o.runId && r.target === o.target && r.session === o.session && !r.answer && !r.usedAt
    && (o.kind !== 'merge' || nowMs - Date.parse(r.createdAt) < MERGE_AUTH_TTL_MS));
  if (open) {
    const b = o.build(open.authId);
    if (b.ask.question === open.question) return { authId: open.authId, ask: b.ask };
  }
  const taken = (id: string) => existsSync(path.join(dir, `${id}.json`));
  let authId = newAuthId(o.kind, o.runId, o.rand);
  if (!AUTH_ID.test(authId)) throw new Error('auth: the run id cannot name an authorization');
  for (let i = 0; i < 8 && taken(authId); i++) authId = newAuthId(o.kind, o.runId, Math.random);
  if (taken(authId)) throw new Error('auth: no free authorization id');
  const b = o.build(authId);
  writeAuthIn(dir, { authId, kind: o.kind, runId: o.runId, target: o.target, question: b.ask.question, yes: b.yes, createdAt: o.now.toISOString(), session: o.session });
  return { authId, ask: b.ask };
}

const answeredMs = (r: AuthRecord) => Date.parse(r.answeredAt ?? r.createdAt);
/** A record that does not allow anything (a no, or one used) sorts first among those answered at the same instant. */
const denies = (r: AuthRecord) => (r.answer !== 'yes' || r.usedAt ? 1 : 0);
const newestFirst = (a: AuthRecord, b: AuthRecord) =>
  answeredMs(b) - answeredMs(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || denies(b) - denies(a);

/** Whether `swarm merge --yes` may merge run `runId` into `target` for the session `session`, and why not. */
export function checkMergeAuth(recs: AuthRecord[], o: { runId: string; target: string; session: string | null; now: number }):
  { ok: true; record: AuthRecord } | { ok: false; reason: MergeAuthReason } {
  if (!o.session) return { ok: false, reason: 'no session id' };
  const answered = recs.filter(r => r.kind === 'merge' && r.answer);
  const r = answered.filter(x => x.runId === o.runId && x.target === o.target).sort(newestFirst)[0];
  if (!r) {
    const open = answered.filter(x => x.answer === 'yes' && !x.usedAt);
    return { ok: false, reason: open.some(x => x.runId !== o.runId) ? 'other run' : open.some(x => x.target !== o.target) ? 'other branch' : 'no answer recorded' };
  }
  if (r.usedAt) return { ok: false, reason: 'already used' };
  if (r.answer !== 'yes') return { ok: false, reason: 'answered no' };
  if (!r.answeredAt || o.now - Date.parse(r.answeredAt) > MERGE_AUTH_TTL_MS) return { ok: false, reason: 'expired' };
  if (r.answeredBy !== o.session) return { ok: false, reason: 'other session' };
  return { ok: true, record: r };
}

/** Whether `swarm start --merge-on-finish` may set mergeOnFinish for run `runId` into `target`, and why not. */
export function checkMofAuth(recs: AuthRecord[], o: { runId: string; target: string; session: string | null }):
  { ok: true; record: AuthRecord } | { ok: false; reason: MofReason } {
  const mof = recs.filter(r => r.kind === 'merge-on-finish');
  const r = mof.filter(x => x.answer && (x.runId === o.runId || (x.runId === null && o.session !== null && x.session === o.session))).sort(newestFirst)[0];
  if (!r) return { ok: false, reason: mof.some(x => x.answer === 'yes' && !x.usedAt && x.runId !== null && x.runId !== o.runId) ? 'other run' : 'no answer recorded' };
  if (r.usedAt) return { ok: false, reason: 'already used' };
  if (r.answer !== 'yes') return { ok: false, reason: 'answered no' };
  if (r.target !== o.target) return { ok: false, reason: 'other branch' };
  return { ok: true, record: r };
}

/** Marks a record used by the merge or the start it allowed; a merge-on-finish without a run is tied to that run now. */
export function useAuth(root: string, r: AuthRecord, at: string, runId?: string): void {
  writeAuth(root, { ...r, usedAt: at, ...(r.runId === null && runId ? { runId } : {}) });
}

/** The questions of an AskUserQuestion call, as asked. */
function questionsOf(toolInput: unknown): string[] {
  const qs = isObject(toolInput) ? toolInput.questions : null;
  if (!Array.isArray(qs)) return [];
  return qs.slice(0, MAX_QUESTIONS).map(q => (isObject(q) ? q.question : null)).filter((q): q is string => typeof q === 'string');
}

/** The answers of an AskUserQuestion result: question → the chosen label, or the person's own text. */
function answersOf(x: unknown): Map<string, string> | null {
  const a = isObject(x) ? x.answers : null;
  if (!isObject(a)) return null;
  const out = new Map<string, string>();
  for (const [q, v] of Object.entries(a)) if (typeof v === 'string') out.set(q, v);
  return out;
}

/** The tool_use_id values of a transcript line's message (a tool result names the call it answers). */
function toolUseIds(message: unknown): string[] {
  const content = isObject(message) ? message.content : null;
  return Array.isArray(content) ? content.map(c => (isObject(c) ? c.tool_use_id : null)).filter((id): id is string => typeof id === 'string') : [];
}

/**
 * When the hook input carries no answers: the latest AskUserQuestion result in the last 2 MiB of the transcript (a
 * .jsonl file given by its full path), and when the input names its call (`tool_use_id`), only that call's result.
 */
function answersFromTranscript(file: unknown, toolUseId: unknown): Map<string, string> | null {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return null;
  const call = typeof toolUseId === 'string' && toolUseId ? toolUseId : null;
  let tail: string;
  try {
    // Never a pipe or a device: opening one could wait.
    if (!statSync(file).isFile()) return null;
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, TRANSCRIPT_TAIL);
      const buf = Buffer.alloc(len);
      let off = 0;
      while (off < len) {
        const n = readSync(fd, buf, off, len - off, size - len + off);
        if (n <= 0) break;
        off += n;
      }
      tail = buf.subarray(0, off).toString('utf8');
    } finally { closeSync(fd); }
  } catch { return null; }
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - TRANSCRIPT_LINES; i--) {
    if (!lines[i].includes('"answers"')) continue;
    try {
      const line = JSON.parse(lines[i]) as { toolUseResult?: unknown; message?: unknown };
      if (call && !toolUseIds(line.message).includes(call)) continue;
      // The result of AskUserQuestion lists its questions; another tool's result is not an answer.
      if (!isObject(line.toolUseResult) || !Array.isArray(line.toolUseResult.questions)) continue;
      const a = answersOf(line.toolUseResult);
      if (a) return a;
    } catch { /* a line cut by the tail */ }
  }
  return null;
}

/**
 * `forge hook answer` (PostToolUse on AskUserQuestion): records the person's answer to each pending record whose
 * question is one of those asked, word for word. The yes label is a yes; anything else (the no, the person's own text)
 * is a no. It prints nothing and fails open: bad input, another tool or event, no pending record or any error records
 * nothing.
 */
export function hookAnswer(io: { cwd: string; stdin?: string; env?: Record<string, string | undefined>; now: () => Date }): string {
  try {
    const o = JSON.parse(io.stdin ?? '') as unknown;
    if (!isObject(o) || o.tool_name !== 'AskUserQuestion' || o.hook_event_name !== 'PostToolUse') return '';
    const asked = questionsOf(o.tool_input);
    if (!asked.length) return '';
    const projectDir = io.env?.CLAUDE_PROJECT_DIR?.trim();
    const root = projectDir || (typeof o.cwd === 'string' && o.cwd ? o.cwd : io.cwd);
    const dir = authDir(root);
    if (!existsSync(dir)) return '';
    const pending = readAuthsIn(dir).filter(r => !r.answer && !r.usedAt && asked.includes(r.question));
    if (!pending.length) return '';
    const answers = answersOf(o.tool_response) ?? answersFromTranscript(o.transcript_path, o.tool_use_id);
    if (!answers) return '';
    const by = isSafeId(o.session_id) ? o.session_id : null;
    const at = io.now().toISOString();
    for (const r of pending) {
      const a = answers.get(r.question);
      if (typeof a === 'string') writeAuthIn(dir, { ...r, answeredAt: at, answer: a === r.yes ? 'yes' : 'no', answeredBy: by });
    }
  } catch { /* fail open: a hook never breaks the session */ }
  return '';
}
