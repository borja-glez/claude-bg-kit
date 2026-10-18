// I-03: the authorizations the person gives with an answer of theirs. forge prints a question (`ask`), the skill asks it
// with AskUserQuestion exactly as printed, and the hook `answer` (PostToolUse on AskUserQuestion) records the answer in
// .forge/execution/auth/<authId>.json of the main checkout: a `--yes` alone is never one.
// - `merge` lets `swarm merge --yes` merge a run into a branch that is not forge's: answered yes by the session that
//   merges, less than 60 minutes ago; the merge it allows uses it.
// - `merge-on-finish` lets `swarm start --merge-on-finish` set mergeOnFinish. It is tied to the run id, with no session and
//   no expiry, because the start question is answered in the design session and the run starts in another after /clear.
//   One asked before the run exists (auto mode at launch) has no run id and is tied to the session that asked instead.
// Writing these files by hand gets past it: this closes the casual path (adding --yes), not a deliberate forgery.
// Only the person's own submit counts: a choice the engine sent while they were away, a follow-up instead of the submit,
// or a yes they added a note to is not a yes.
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isRunBranch, isSafeId } from '../lib/execution-state.js';
import { mainCheckout } from './local.js';
import { sleepSync } from './pid.js';

export type AuthKind = 'merge' | 'merge-on-finish';
export interface AuthOption { label: string; description: string }
export interface AuthAsk { question: string; header: string; options: AuthOption[]; multiSelect: false }
export interface AuthRecord {
  authId: string; kind: AuthKind; runId: string | null; target: string; question: string; yes: string; createdAt: string;
  /** C1 id of the session that asked: on a merge record, and on a merge-on-finish record without a run; else null. */
  session: string | null;
  /** `other`: the person picked the yes label but added a note to it, which is not a yes (`note` keeps what they wrote). */
  answeredAt?: string; answer?: 'yes' | 'no' | 'other'; answeredBy?: string | null; usedAt?: string;
  /** The note the person added to their choice in AskUserQuestion, when there was one. */
  note?: string;
}
export type MergeAuthReason = 'no session id' | 'no answer recorded' | 'answered no' | 'expired' | 'other session' | 'other run' | 'other branch' | 'already used';
export type MofReason = 'no answer recorded' | 'answered no' | 'other run' | 'other branch' | 'already used';

/** A merge record allows the merge for this long after its answer. */
export const MERGE_AUTH_TTL_MS = 60 * 60_000;
/** How far ahead of now a record's createdAt or answeredAt may be (clock skew); a record dated later allows nothing. */
export const AUTH_CLOCK_SKEW_MS = 5 * 60_000;
/** The records read: the ones written last. */
const MAX_RECORDS = 200;
/** A record takes a few kilobytes at most (a question of 4000 characters); a bigger file is not one. */
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_NOTE = 2000;
const TRANSCRIPT_TAIL = 2 * 1024 * 1024;
const TRANSCRIPT_LINES = 400;
/** AskUserQuestion asks at most four questions; more are not looked at. */
const MAX_QUESTIONS = 16;
const AUTH_ID = /^(?:merge|mof)-[A-Za-z0-9_.-]{1,120}-[0-9a-z]{4}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** On Windows a read or a rename that meets another process's rename or read fails for a moment with one of these. */
const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const BUSY_TRIES = 6;
const BUSY_WAIT_MS = 15;

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
    ...(o.answer === 'yes' || o.answer === 'no' || o.answer === 'other' ? { answer: o.answer } : {}),
    ...(o.answeredBy === null || isSafeId(o.answeredBy) ? { answeredBy: o.answeredBy as string | null } : {}),
    ...(iso(o.usedAt) ? { usedAt: iso(o.usedAt) } : {}),
    ...(text(o.note, MAX_NOTE) ? { note: o.note as string } : {}),
  };
}

/** A record dated more than AUTH_CLOCK_SKEW_MS after `nowMs` (its createdAt or answeredAt): it allows nothing. */
const aheadOf = (r: AuthRecord, nowMs: number) =>
  Date.parse(r.createdAt) > nowMs + AUTH_CLOCK_SKEW_MS || (r.answeredAt !== undefined && Date.parse(r.answeredAt) > nowMs + AUTH_CLOCK_SKEW_MS);

/**
 * `f`, tried again a few times (15, 30… ms apart) while it fails with EBUSY, EPERM or EACCES: on Windows a read or a
 * rename that meets another process's rename or read fails for a moment. Any other error, or the last one, is thrown.
 */
export function retryBusy<T>(f: () => T, wait: (ms: number) => void = sleepSync): T {
  for (let i = 1; ; i++) {
    try {
      return f();
    } catch (e) {
      if (i >= BUSY_TRIES || !BUSY_CODES.has(String((e as NodeJS.ErrnoException)?.code))) throw e;
      wait(BUSY_WAIT_MS * i);
    }
  }
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

/**
 * The records of an auth directory, each with the text it was read from; one that does not read back, or whose file
 * name is not its authId, is skipped.
 */
function readEntries(dir: string): { rec: AuthRecord; text: string }[] {
  const out: { rec: AuthRecord; text: string }[] = [];
  for (const n of recordFiles(dir)) {
    try {
      const text = retryBusy(() => readFileSync(path.join(dir, n), 'utf8'));
      const rec = normalizeAuth(JSON.parse(text));
      if (rec && `${rec.authId}.json` === n) out.push({ rec, text });
    } catch { /* skipped */ }
  }
  return out;
}

const readAuthsIn = (dir: string): AuthRecord[] => readEntries(dir).map(e => e.rec);

/** Whether `file` still holds `expected` (null: there is no such file). */
function unchanged(file: string, expected: string | null): boolean {
  let size: number;
  try {
    const st = retryBusy(() => lstatSync(file));
    if (!st.isFile()) return false;
    size = st.size;
  } catch (e) {
    return expected === null && (e as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
  if (expected === null || size > MAX_RECORD_BYTES) return false;
  try { return retryBusy(() => readFileSync(file, 'utf8')) === expected; } catch { return false; }
}

/**
 * Writes a record under its authId, atomically: a temporary file, then a rename, tried again while Windows reports the
 * file busy. With `expected` it writes only when the file still holds that text (null: only when there is none) and
 * otherwise returns false and leaves the file as it is: a writer that lost a race keeps the winner's record, whole.
 * A record that would not read back (a bad id, branch or date) throws.
 */
function writeAuthIn(dir: string, r: AuthRecord, expected?: string | null): boolean {
  const rec = normalizeAuth(r);
  if (!rec) throw new Error('auth: not an authorization record');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${rec.authId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
    if (expected !== undefined && !unchanged(file, expected)) return false;
    retryBusy(() => renameSync(tmp, file));
    return true;
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* a .tmp is never read as a record */ }
  }
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
 * than MERGE_AUTH_TTL_MS, none dated ahead of now) when its question still reads the same, else a new record under an
 * id no file has.
 */
export function pendingAuth(root: string, o: {
  kind: AuthKind; runId: string | null; target: string; session: string | null; now: Date; rand: () => number;
  build: (authId: string) => { ask: AuthAsk; yes: string };
}): { authId: string; ask: AuthAsk } {
  const dir = authDir(root);
  const recs = readAuthsIn(dir);
  const nowMs = o.now.getTime();
  const open = recs.find(r => r.kind === o.kind && r.runId === o.runId && r.target === o.target && r.session === o.session && !r.answer && !r.usedAt
    && !aheadOf(r, nowMs) && (o.kind !== 'merge' || nowMs - Date.parse(r.createdAt) < MERGE_AUTH_TTL_MS));
  if (open) {
    const b = o.build(open.authId);
    if (b.ask.question === open.question) return { authId: open.authId, ask: b.ask };
  }
  for (let i = 0; i < 9; i++) {
    const authId = newAuthId(o.kind, o.runId, i === 0 ? o.rand : Math.random);
    if (!AUTH_ID.test(authId)) throw new Error('auth: the run id cannot name an authorization');
    if (existsSync(path.join(dir, `${authId}.json`))) continue;
    const b = o.build(authId);
    const rec: AuthRecord = { authId, kind: o.kind, runId: o.runId, target: o.target, question: b.ask.question, yes: b.yes, createdAt: o.now.toISOString(), session: o.session };
    if (writeAuthIn(dir, rec, null)) return { authId, ask: b.ask };
  }
  throw new Error('auth: no free authorization id');
}

const answeredMs = (r: AuthRecord) => Date.parse(r.answeredAt ?? r.createdAt);
/** A record that does not allow anything (a no, or one used) sorts first among those answered at the same instant. */
const denies = (r: AuthRecord) => (r.answer !== 'yes' || r.usedAt ? 1 : 0);
const newestFirst = (a: AuthRecord, b: AuthRecord) =>
  answeredMs(b) - answeredMs(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || denies(b) - denies(a);
/**
 * The answered records of `kind` that may decide: a yes dated ahead of now is left out (it allows nothing). A no or a
 * used record dated ahead still decides, so that leaving it out never lets an older yes through.
 */
const deciding = (recs: AuthRecord[], kind: AuthKind, nowMs: number) =>
  recs.filter(r => r.kind === kind && r.answer && !(r.answer === 'yes' && !r.usedAt && aheadOf(r, nowMs)));

/** Whether `swarm merge --yes` may merge run `runId` into `target` for the session `session`, and why not. */
export function checkMergeAuth(recs: AuthRecord[], o: { runId: string; target: string; session: string | null; now: number }):
  { ok: true; record: AuthRecord } | { ok: false; reason: MergeAuthReason } {
  if (!o.session) return { ok: false, reason: 'no session id' };
  const answered = deciding(recs, 'merge', o.now);
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

/**
 * Whether `swarm start --merge-on-finish` may set mergeOnFinish for run `runId` into `target`, and why not. `now`
 * (milliseconds, the clock by default) only sets aside a yes dated ahead of it.
 */
export function checkMofAuth(recs: AuthRecord[], o: { runId: string; target: string; session: string | null; now?: number }):
  { ok: true; record: AuthRecord } | { ok: false; reason: MofReason } {
  const mof = deciding(recs, 'merge-on-finish', o.now ?? Date.now());
  const r = mof.filter(x => x.runId === o.runId || (x.runId === null && o.session !== null && x.session === o.session)).sort(newestFirst)[0];
  if (!r) return { ok: false, reason: mof.some(x => x.answer === 'yes' && !x.usedAt && x.runId !== null && x.runId !== o.runId) ? 'other run' : 'no answer recorded' };
  if (r.usedAt) return { ok: false, reason: 'already used' };
  if (r.answer !== 'yes') return { ok: false, reason: 'answered no' };
  if (r.target !== o.target) return { ok: false, reason: 'other branch' };
  return { ok: true, record: r };
}

/**
 * Marks a record used by the merge or the start it allowed; a merge-on-finish without a run is tied to that run now.
 * The rename is tried again while Windows reports the file busy; if it still fails it throws, and the caller must not
 * leave that yes reusable.
 */
export function useAuth(root: string, r: AuthRecord, at: string, runId?: string): void {
  writeAuth(root, { ...r, usedAt: at, ...(r.runId === null && runId ? { runId } : {}) });
}

/** The questions of an AskUserQuestion call, as asked. */
function questionsOf(toolInput: unknown): string[] {
  const qs = isObject(toolInput) ? toolInput.questions : null;
  if (!Array.isArray(qs)) return [];
  return qs.slice(0, MAX_QUESTIONS).map(q => (isObject(q) ? q.question : null)).filter((q): q is string => typeof q === 'string');
}

/** What the person submitted: question → the chosen label or their own text, and question → the note they added. */
interface Submitted { answers: Map<string, string>; notes: Map<string, string> }

const present = (v: unknown) => v !== undefined && v !== null && v !== false && v !== '';

/**
 * The person's submit in an AskUserQuestion result, or null. A result the person did not confirm is none: the engine
 * sent the choices made so far while they were away (`afkTimeoutMs`, absent on every path a person resolves), or they
 * asked for a follow-up or replied instead of submitting (`followUp`, `response`).
 */
function submittedOf(x: unknown): Submitted | null {
  if (!isObject(x) || !isObject(x.answers)) return null;
  if ('afkTimeoutMs' in x || present(x.followUp) || present(x.response)) return null;
  const answers = new Map<string, string>();
  for (const [q, v] of Object.entries(x.answers)) if (typeof v === 'string') answers.set(q, v);
  const notes = new Map<string, string>();
  if (isObject(x.annotations)) {
    for (const [q, v] of Object.entries(x.annotations)) {
      const note = isObject(v) && typeof v.notes === 'string' ? v.notes.trim() : '';
      if (note) notes.set(q, note.slice(0, MAX_NOTE));
    }
  }
  return { answers, notes };
}

/** The tool_use_id values of a transcript line's message (a tool result names the call it answers). */
function toolUseIds(message: unknown): string[] {
  const content = isObject(message) ? message.content : null;
  return Array.isArray(content) ? content.map(c => (isObject(c) ? c.tool_use_id : null)).filter((id): id is string => typeof id === 'string') : [];
}

/**
 * The AskUserQuestion result of the call `toolUseId` in the last 2 MiB of the transcript (a .jsonl file given by its
 * full path), for a hook input that carries no tool_response. Without the call's id there is none: an earlier call's
 * result is never taken for this one.
 */
function resultFromTranscript(file: unknown, toolUseId: unknown): Record<string, unknown> | null {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return null;
  if (typeof toolUseId !== 'string' || !toolUseId) return null;
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
      if (!toolUseIds(line.message).includes(toolUseId)) continue;
      // The result of AskUserQuestion lists its questions; another tool's result is not an answer.
      return isObject(line.toolUseResult) && Array.isArray(line.toolUseResult.questions) ? line.toolUseResult : null;
    } catch { /* a line cut by the tail */ }
  }
  return null;
}

/**
 * `forge hook answer` (PostToolUse on AskUserQuestion): records the person's answer to each pending record whose
 * question is one of those asked, word for word. The yes label is a yes; the yes label with a note of theirs is
 * `other`; anything else (the no, the person's own text) is a no. It records nothing for:
 * - a result the person did not submit (sent while they were away, a follow-up, a reply);
 * - a question that more than one record carries (a copy beside the real one);
 * - a record dated ahead of now;
 * - a record that changed since it was read (another hook answered it first: its answer stays).
 * It prints nothing and fails open: bad input, another tool or event, no pending record or any error records nothing.
 * The answers come from tool_response; only an input without one reads the transcript, and then only the line of
 * this call (`tool_use_id`).
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
    const entries = readEntries(dir);
    const carriers = new Map<string, number>();
    for (const e of entries) carriers.set(e.rec.question, (carriers.get(e.rec.question) ?? 0) + 1);
    // One answer answers one record: a question that two records carry answers neither.
    const pending = entries.filter(e => !e.rec.answer && !e.rec.usedAt && asked.includes(e.rec.question) && carriers.get(e.rec.question) === 1);
    if (!pending.length) return '';
    const submitted = submittedOf(o.tool_response !== undefined ? o.tool_response : resultFromTranscript(o.transcript_path, o.tool_use_id));
    if (!submitted) return '';
    const by = isSafeId(o.session_id) ? o.session_id : null;
    const now = io.now();
    const at = now.toISOString();
    for (const { rec: r, text } of pending) {
      const a = submitted.answers.get(r.question);
      if (typeof a !== 'string' || aheadOf(r, now.getTime())) continue;
      const note = submitted.notes.get(r.question);
      const answer = a !== r.yes ? 'no' : note ? 'other' : 'yes';
      // Written only over the text read: a record another hook answered meanwhile keeps that answer.
      writeAuthIn(dir, { ...r, answeredAt: at, answer, answeredBy: by, ...(note ? { note } : {}) }, text);
    }
  } catch { /* fail open: a hook never breaks the session */ }
  return '';
}
