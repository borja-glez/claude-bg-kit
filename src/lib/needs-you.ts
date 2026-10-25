// The "waiting for you" inbox of wave 7 (point 11): one pure function that joins what waits for a decision of the person
// (a review round's question, a merge authorization, the trust in the commands, a stopped run, an open roadmap question,
// a proposal, a design ready to approve, a surface permission). The waypoint band, lens and the roadmap page use it, so
// it imports only one-line.ts and run-ttl.ts (which import nothing): no Node, zod, yaml or forge code reaches a bundle.
// It reads no file and does not know where its inputs come from; each source is checked lightly, by fields.
import { oneLine } from './one-line.js';
import { withinRunTtl } from './run-ttl.js';

export const NEED_KINDS = ['review-question', 'authorization', 'untrusted-commands', 'run', 'question', 'proposal', 'design-approval', 'surface'] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export type NeedPlace = 'coordinator' | 'conversation' | 'roadmap';
export interface NeedItem {
  kind: NeedKind; id: string; what: string; task: string | null; runId: string | null; file: string | null;
  since: string | null; command: string | null; place: NeedPlace | null; unverified?: true;
}
export interface NeedsRun {
  runId: string; active: boolean; stopReason: string | null; stallReason: string | null;
  startedAt: string | null; lastStepAt: string | null; closedAt: string | null;
  coordinatorOpen: boolean | null;
}
export interface NeedsInput {
  now: number;
  run?: NeedsRun | null;
  asked?: Record<string, { file: string; doc: unknown }>;
  auth?: Record<string, unknown>;
  surfaces?: { docs: Record<string, unknown>; decided: readonly string[] };
  notes?: Record<string, unknown>;
  proposals?: Record<string, unknown>;
  design?: { project: string; read: { version: number; ready: boolean; since: string | null } | null };
}

/** What stops a run without closing it (the roadmap page's HALTS). */
export const RUN_HALTS = ['stalled', 'stopped', 'budget'] as const;
/** How long an authorization stays pending: forge's MERGE_AUTH_TTL_MS and MOF_LAUNCH_TTL_MS (a test pins them). */
export const AUTH_PENDING_MS = { merge: 60 * 60_000, 'merge-on-finish': 24 * 3600_000 } as const;
/** The id of an authorization record, as forge's newAuthId writes it (a test pins it). */
export const AUTH_ID = /^(?:merge|mof)-[A-Za-z0-9_.-]{1,120}-[0-9a-z]{4}$/;
export const WHAT_MAX = 200;

/** How far ahead of now a date may be (clock skew) before it counts as none, and forge's own skew for authorizations. */
const SINCE_SKEW_MS = 2 * 60_000;
const AUTH_SKEW_MS = 5 * 60_000;

// The rule of isSafeId (src/lib/execution-state.ts), copied: that module imports yaml and zod, which the roadmap page
// must not bundle. tests/needs-you.test.ts pins this copy against isSafeId.
const SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
const safeId = (s: unknown): string | null => (typeof s === 'string' && SAFE_ID.test(s) && s !== '.' && s !== '..' ? s : null);

type Obj = Record<string, unknown>;
/** A document as an object: a string is JSON text; anything that is not a plain object (or does not parse) is null. */
const readDoc = (v: unknown): Obj | null => {
  try {
    const x: unknown = typeof v === 'string' ? JSON.parse(v) : v;
    return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null;
  } catch { return null; }
};

const text = (x: unknown): string => (typeof x === 'string' ? Array.from(oneLine(x)).slice(0, WHAT_MAX).join('') : '');
const cleanId = (x: string): string => Array.from(oneLine(x)).slice(0, 120).join('');
const sinceOf = (x: unknown, now: number): string | null => {
  if (typeof x !== 'string') return null;
  const t = Date.parse(x);
  return Number.isFinite(t) && t <= now + SINCE_SKEW_MS ? x : null;
};
const keys = (r: Record<string, unknown> | undefined): string[] => (r ? Object.keys(r).sort() : []);

const unverified = (kind: NeedKind, file: string | null): NeedItem =>
  ({ kind, id: '', what: '', task: null, runId: null, file, since: null, command: null, place: null, unverified: true });

/** Where a decision that belongs to the run is answered: in the coordinator's open conversation, else by resuming it. */
const answeredAt = (run: NeedsRun | null | undefined): Pick<NeedItem, 'command' | 'place'> =>
  run?.coordinatorOpen === true ? { command: null, place: 'coordinator' } : { command: '/forge:run --resume', place: null };

function reviewQuestions(i: NeedsInput): NeedItem[] {
  const out: NeedItem[] = [];
  let bad: NeedItem | null = null;
  for (const task of keys(i.asked)) {
    const entry = i.asked![task];
    const file = entry && typeof entry.file === 'string' ? entry.file : null;
    const d = entry ? readDoc(entry.doc) : null;
    if (!d) { bad ??= unverified('review-question', file); continue; }
    if (d.ruling) continue;
    const ids = Array.isArray(d.findings)
      ? d.findings.map(f => (typeof f === 'string' ? f : f !== null && typeof f === 'object' && typeof (f as Obj).id === 'string' ? ((f as Obj).id as string) : '')).filter(Boolean)
      : [];
    out.push({ kind: 'review-question', id: cleanId(task), what: text(ids.join(', ')), task: safeId(task), runId: safeId(i.run?.runId),
      file, since: sinceOf(d.at, i.now), ...answeredAt(i.run) });
  }
  return bad ? [...out, bad] : out;
}

function authorizations(i: NeedsInput): NeedItem[] {
  const out: NeedItem[] = [];
  let bad: NeedItem | null = null;
  for (const key of keys(i.auth)) {
    const file = `.forge/execution/auth/${key}.json`;
    const d = readDoc(i.auth![key]);
    if (!d) { bad ??= unverified('authorization', file); continue; }
    const kind = d.kind;
    if (kind !== 'merge' && kind !== 'merge-on-finish') continue;
    if (d.answer || d.usedAt) continue;
    const created = typeof d.createdAt === 'string' ? Date.parse(d.createdAt) : NaN;
    if (!(created <= i.now + AUTH_SKEW_MS) || !(i.now - created < AUTH_PENDING_MS[kind])) continue;
    const forRun = d.runId === null || d.runId === undefined ? null : typeof d.runId === 'string' ? d.runId : undefined;
    if (forRun === undefined) continue;
    if (forRun !== null && !(i.run && i.run.runId === forRun && !i.run.closedAt)) continue;
    out.push({ kind: 'authorization', id: cleanId(key), what: text(d.target), task: null, runId: forRun === null ? null : safeId(forRun),
      file, since: sinceOf(d.createdAt, i.now), ...(forRun === null ? { command: null, place: 'conversation' as const } : answeredAt(i.run)) });
  }
  return bad ? [...out, bad] : out;
}

/** The two items of a stopped execution: the trust in the commands, or any other halt. Never both. */
function stoppedRun(i: NeedsInput): { untrusted: NeedItem[]; run: NeedItem[] } {
  const none = { untrusted: [], run: [] };
  if (i.run === undefined) return none;
  const r = i.run;
  if (r === null) return { untrusted: [], run: [unverified('run', '.forge/execution.json')] };
  if (r.active || r.closedAt || !(RUN_HALTS as readonly string[]).includes(r.stopReason ?? '')) return none;
  if (!withinRunTtl(i.now, Date.parse(r.lastStepAt ?? r.startedAt ?? ''))) return none;
  const base = { id: cleanId(r.runId), task: null, runId: safeId(r.runId), since: sinceOf(r.lastStepAt ?? r.startedAt, i.now), ...answeredAt(r) };
  if (r.stopReason === 'stalled' && r.stallReason === 'untrusted-commands') {
    return { untrusted: [{ kind: 'untrusted-commands', what: '', file: '.forge/config.yaml', ...base }], run: [] };
  }
  const why = r.stallReason ? `${r.stopReason}: ${r.stallReason}` : String(r.stopReason);
  return { untrusted: [], run: [{ kind: 'run', what: text(why), file: '.forge/execution.json', ...base }] };
}

function questions(i: NeedsInput): NeedItem[] {
  const out: NeedItem[] = [];
  let bad: NeedItem | null = null;
  for (const key of keys(i.notes)) {
    const d = readDoc(i.notes![key]);
    if (!d) { bad ??= unverified('question', null); continue; }
    // The page's own rule, by truthiness.
    if (!(d.type === 'question' && !d.answer && !d.answeredByNote)) continue;
    out.push({ kind: 'question', id: cleanId(key), what: text(d.text), task: safeId(d.taskId), runId: null, file: null,
      since: sinceOf(d.ts, i.now), command: null, place: 'roadmap' });
  }
  return bad ? [...out, bad] : out;
}

function proposals(i: NeedsInput): NeedItem[] {
  const out: NeedItem[] = [];
  let bad: NeedItem | null = null;
  for (const key of keys(i.proposals)) {
    const file = `.forge/proposals/${key}.json`;
    const d = readDoc(i.proposals![key]);
    if (!d) { bad ??= unverified('proposal', file); continue; }
    if (d.status !== 'proposed' && d.status !== 'discussing') continue;
    // The command names the record; a key that is no safe id is not put in a command line.
    out.push({ kind: 'proposal', id: cleanId(key), what: text(d.title), task: null, runId: null, file,
      since: sinceOf(d.ts, i.now), command: safeId(key) ? `/forge:decide ${key}` : null, place: null });
  }
  return bad ? [...out, bad] : out;
}

function designApproval(i: NeedsInput): NeedItem[] {
  const d = i.design;
  if (!d) return [];
  const file = `docs/waypoint/${d.project}/design.md`;
  if (d.read === null) return [unverified('design-approval', file)];
  if (!d.read.ready) return [];
  return [{ kind: 'design-approval', id: cleanId(d.project), what: `v${d.read.version}`, task: null, runId: null, file,
    since: sinceOf(d.read.since, i.now), command: '/waypoint:design approve', place: null }];
}

function surfaces(i: NeedsInput): NeedItem[] {
  const run = i.run;
  if (!run || run.closedAt || !i.surfaces) return [];
  const out: NeedItem[] = [];
  let bad: NeedItem | null = null;
  for (const name of keys(i.surfaces.docs)) {
    if (i.surfaces.decided.includes(name)) continue;
    const file = `.forge/execution/asked/${run.runId}/${name}.json`;
    const d = readDoc(i.surfaces.docs[name]);
    if (!d) { bad ??= unverified('surface', file); continue; }
    out.push({ kind: 'surface', id: cleanId(name), what: text(name), task: safeId(d.task), runId: safeId(run.runId), file,
      since: sinceOf(d.at, i.now), ...answeredAt(run) });
  }
  return bad ? [...out, bad] : out;
}

/**
 * What waits for the person, oldest first: the dated ones by `since`, then those without a usable date, then the
 * `unverified` ones (a source that could not be read), each in the order of NEED_KINDS. Never throws: a source that does
 * gives one `unverified` item of its kind.
 */
export function needsYou(i: NeedsInput): NeedItem[] {
  const guarded = (kind: NeedKind, file: string | null, f: () => NeedItem[]): NeedItem[] => {
    try { return f(); } catch { return [unverified(kind, file)]; }
  };
  let stopped: { untrusted: NeedItem[]; run: NeedItem[] };
  try { stopped = stoppedRun(i); } catch { stopped = { untrusted: [], run: [unverified('run', '.forge/execution.json')] }; }
  const all = [
    ...guarded('review-question', null, () => reviewQuestions(i)),
    ...guarded('authorization', null, () => authorizations(i)),
    ...stopped.untrusted,
    ...stopped.run,
    ...guarded('question', null, () => questions(i)),
    ...guarded('proposal', null, () => proposals(i)),
    ...guarded('design-approval', null, () => designApproval(i)),
    ...guarded('surface', null, () => surfaces(i)),
  ];
  const dated = all.filter(n => !n.unverified && n.since !== null).sort((a, b) => Date.parse(a.since!) - Date.parse(b.since!));
  const undated = all.filter(n => !n.unverified && n.since === null);
  const unread = all.filter(n => n.unverified);
  return [...dated, ...undated, ...unread];
}
