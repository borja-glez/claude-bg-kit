// forge's decision records: the strict input of `forge decision add`, the ledger events, .forge/decisions.json and the
// docs/forge/decisions/<scope>.md file of a project without a roadmap. Never runs git and never deletes anything.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { appendEvent, forgeDir, readEvents, type LedgerEvent } from './ledger.js';
import { MAX_NOTE, NOTE_ID } from '../lib/notes.js';
import { compactTs } from '../lib/ids.js';
import { sha256Hex } from '../lib/sha256.js';
import type { Write } from '../lib/sync.js';
import { attribute, baseOf, projectOf } from './task-ref.js';
import {
  BRANCH, DECISION_BY, DECISION_POINTS, LIMITS, PROJECT_ID, RUN_ID, SHA, TASK_ID, UNDO_SHAS_MAX, clean, decisionScope, nextDecisionsDoc,
  normalizeDecision, normalizeDecisionsDoc, weightOf, type Decision, type DecisionsDoc,
} from '../lib/decisions.js';

export class DecisionInputError extends Error {}
export const decisionsFile = (root: string) => path.join(root, '.forge', 'decisions.json');

const notDots = (s: string) => s !== '.' && s !== '..';
const line = (max: number) => z.string().transform(s => clean(s, max)).pipe(z.string().min(1, 'must not be empty'));
const ident = (re: RegExp) => z.string().regex(re).refine(notDots, 'invalid id');
const Undo = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('git-revert'), base: z.string().regex(SHA), head: z.string().regex(SHA), cwd: line(500).optional(),
    shas: z.array(z.string().regex(SHA)).min(1).max(UNDO_SHAS_MAX).refine(a => new Set(a).size === a.length, 'repeats a sha').optional(),
  }).strict(),
  z.object({ type: z.literal('design-reopen'), project: ident(PROJECT_ID) }).strict(),
  z.object({ type: z.literal('plan-edit'), project: ident(PROJECT_ID), tasks: z.array(ident(TASK_ID)).min(1).max(50) }).strict(),
  z.object({ type: z.literal('branch-discard'), branch: z.string().regex(BRANCH).refine(s => !s.includes('..'), 'invalid branch') }).strict(),
  z.object({ type: z.literal('none'), reason: line(LIMITS.reason) }).strict(),
]);
const Input = z.object({
  point: z.enum(DECISION_POINTS),
  what: line(LIMITS.what),
  chosen: line(LIMITS.chosen),
  alternatives: z.array(line(LIMITS.alternative)).max(LIMITS.alternatives).optional(),
  why: line(LIMITS.why),
  by: z.enum(DECISION_BY),
  weight: z.enum(['major', 'minor']).optional(),
  revert: line(LIMITS.revert).optional(),
  undo: Undo.optional(),
  safePath: line(LIMITS.safePath).optional(),
  revertOf: z.number().int().positive().optional(),
  task: ident(TASK_ID).optional(),
  runId: ident(RUN_ID).optional(),
}).strict();

export function readDecisionsDoc(root: string): DecisionsDoc | null {
  try { return normalizeDecisionsDoc(JSON.parse(readFileSync(decisionsFile(root), 'utf8'))); } catch { return null; }
}

// The summary follows the ledger one decision at a time; any failure leaves the append done (the ledger is the record).
function saveDecisionsDoc(root: string, event: LedgerEvent, n: number): void {
  try {
    const d = normalizeDecision(event);
    if (!d) return;
    const prev = readDecisionsDoc(root);
    const next = nextDecisionsDoc(prev, d, n);
    if (!next || next === prev) return;
    forgeDir(root);
    const file = decisionsFile(root);
    const tmp = `${file}.${process.pid}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(next) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
  } catch { /* a convenience for lens and the band */ }
}

/**
 * Validates one decision (strict: an unknown key, a bad enum or an unsafe id is refused, text is cleaned and clipped),
 * appends it to the ledger with its weight (from its point when not given) and updates .forge/decisions.json. The
 * `task` of the context (the --task flag) wins over the data's; the data's `runId` wins over the context's.
 */
/** Re-review m3: the same decision recorded again within this window is the first one (a re-run of the same command). */
const REPEAT_MS = 10 * 60_000;
/** A decision's content, its time aside: what makes two records the same decision. */
const contentOf = (e: LedgerEvent): string | null => {
  const d = normalizeDecision(e);
  if (!d) return null;
  const { ts: _ts, ...rest } = d;
  return JSON.stringify(rest);
};

export function addDecision(root: string, raw: unknown, ctx: { ts: string; task?: string; runId?: string | null }): { n: number; event: LedgerEvent } {
  const r = Input.safeParse(raw);
  if (!r.success) throw new DecisionInputError(r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
  const { task: dataTask, runId: dataRun, weight, ...rest } = r.data;
  const task = ctx.task ?? dataTask;
  const runId = dataRun ?? ctx.runId ?? undefined;
  const event: LedgerEvent = {
    ts: ctx.ts, kind: 'decision', ...rest, weight: weight ?? weightOf(rest.point),
    ...(task ? { task } : {}), ...(runId ? { runId } : {}),
  };
  // Re-review m3: a re-run of the same command is the decision already recorded (same content, within REPEAT_MS): its
  // number and its event come back, nothing is appended, and its note keeps the same id.
  const mine = contentOf(event);
  const before = readEvents(root).filter(e => e.kind === 'decision');
  for (let i = before.length - 1; i >= 0; i--) {
    const age = Date.parse(ctx.ts) - Date.parse(before[i].ts);
    if (!(age >= 0 && age <= REPEAT_MS)) continue;
    if (mine !== null && contentOf(before[i]) === mine) return { n: i + 1, event: before[i] };
  }
  appendEvent(root, event);
  // Our own event's position: another session may append right after it, so the count after the append is not enough.
  const line = JSON.stringify(event);
  const all = readEvents(root).filter(e => e.kind === 'decision');
  let n = all.length;
  for (let i = all.length - 1; i >= 0; i--) if (JSON.stringify(all[i]) === line) { n = i + 1; break; }
  saveDecisionsDoc(root, event, n);
  return { n, event };
}

export type Numbered = Decision & { n: number };
/** `project` goes with `task`: its project, else the one the ledger gives the task now (projectOf). */
export interface DecisionFilter { task?: string; project?: string | null; run?: string; since?: string; all?: boolean; auto?: boolean }

/** The decisions of `events`, numbered by their position among the `decision` events (1-based; the ledger only grows), with their event. */
function numbered(events: readonly LedgerEvent[]): { d: Numbered; e: LedgerEvent }[] {
  const out: { d: Numbered; e: LedgerEvent }[] = [];
  events.filter(e => e.kind === 'decision').forEach((e, i) => {
    const d = normalizeDecision(e);
    if (d) out.push({ d: { ...d, n: i + 1 }, e });
  });
  return out;
}

/** Every decision of the ledger, numbered by its position among the `decision` events (1-based; the ledger only grows). */
export function allDecisions(root: string): Numbered[] {
  return numbered(readEvents(root)).map(x => x.d);
}

// The task itself or one of its briefs, `<task>-<n>`.
const ownTask = (task: string, t: string | null): boolean =>
  t === task || (!!t && t.startsWith(`${task}-`) && /^\d{1,3}$/.test(t.slice(task.length + 1)));

/**
 * Filters compose. With none of task, run, since or all: the scope of decisions.json, else of the newest decision not by
 * the user. Carry 4 (D-08: ids repeat between plans): `task` is the pair (project, task), each decision attributed as the
 * ledger attributes its events (attribute).
 */
export function listDecisions(root: string, f: DecisionFilter): Numbered[] {
  const events = readEvents(root);
  const rows = numbered(events);
  const all = rows.map(x => x.d);
  let out = all;
  if (f.task) {
    const task = f.task;
    const project = f.project !== undefined ? f.project : projectOf(events, task);
    const owner = attribute(events);
    out = rows.filter(x => ownTask(task, x.d.task) && owner(x.e) === project).map(x => x.d);
  }
  if (f.run) out = out.filter(d => d.runId === f.run);
  if (f.since) { const s = Date.parse(f.since); out = out.filter(d => Date.parse(d.ts) >= s); }
  if (!f.task && !f.run && !f.since && !f.all) {
    const latest = [...all].reverse().find(d => d.by !== 'user');
    const scope = readDecisionsDoc(root)?.scope ?? (latest ? decisionScope(latest) ?? 'forge' : null);
    out = scope ? out.filter(d => (decisionScope(d) ?? 'forge') === scope) : [];
  }
  return f.auto ? out.filter(d => d.by !== 'user') : out;
}

const MD = {
  es: {
    title: 'Decisiones automáticas', intro: 'forge tomó estas decisiones sin preguntar. Para deshacer una: `/forge:decisions revert <n>`.',
    chosen: 'Elegido', alternatives: 'Alternativas', why: 'Por qué', revert: 'Cómo revertir', when: 'Cuándo', noRevert: 'no se puede revertir de forma automática',
  },
  en: {
    title: 'Automatic decisions', intro: 'forge took these decisions without asking. To undo one: `/forge:decisions revert <n>`.',
    chosen: 'Chosen', alternatives: 'Alternatives', why: 'Why', revert: 'How to undo', when: 'When', noRevert: 'cannot be undone automatically',
  },
} as const;

/** The decisions file of one scope, oldest first. */
export function renderDecisionsMd(list: Numbered[], scope: string, locale: string): string {
  const t = locale.toLowerCase().startsWith('es') ? MD.es : MD.en;
  const out = [`# ${t.title} · ${scope}`, '', t.intro, ''];
  for (const d of list) {
    out.push(`## ${d.n}. ${d.what}`, '', `- **${t.chosen}:** ${d.chosen}`);
    if (d.alternatives.length) out.push(`- **${t.alternatives}:** ${d.alternatives.join(', ')}`);
    const howTo = d.revert ?? (d.undo?.type === 'none' ? `${t.noRevert}: ${d.undo.reason}` : t.noRevert);
    out.push(`- **${t.why}:** ${d.why || '—'}`, `- **${t.revert}:** ${howTo}`, `- **${t.when}:** ${d.ts} · ${d.by} · ${d.weight}`, '');
  }
  return out.join('\n');
}

/** H-17: a note id of the roadmap: the same rule as the page's (carry 6, one regex). */
export { NOTE_ID };

/**
 * Carry 6, re-review m3: the id of a decision's note, derived from the decision's own event (its time, the session and a
 * digest of the recorded decision), never from chance: a re-run that returns the same event gives the same note.
 */
export const decisionNoteId = (event: LedgerEvent, session: string): string =>
  `${compactTs(new Date(event.ts))}-${session}-d${sha256Hex(JSON.stringify(normalizeDecision(event) ?? event)).slice(0, 10)}`;

/**
 * H-17: the roadmap writes of a decision, for the skill to send in one batch: its decision note (`notes/<eid>`, the
 * structure the page shows) and, when it answers a question note (`resolves`), the update that closes that question.
 */
export function decisionWrites(i: { event: LedgerEvent; session: string; eid: string; resolves?: string | null }): Write[] {
  const d = normalizeDecision(i.event);
  if (!d) return [];
  const full = `${d.what} → ${d.chosen}: ${d.why}`;
  const text = full.length <= MAX_NOTE ? full : Array.from(full).slice(0, MAX_NOTE).join('');
  const author = `session:${i.session}`;
  const task = d.task ? baseOf(d.task) : null;
  const note: Write = {
    op: 'set', collection: 'notes', doc_id: i.eid,
    data: {
      ts: d.ts, type: 'decision', author, text, ...(task ? { taskId: task } : {}),
      decision: {
        point: d.point, what: d.what, chosen: d.chosen, ...(d.alternatives.length ? { alternatives: d.alternatives } : {}), why: d.why,
        ...(d.revert ? { revert: d.revert } : {}), auto: d.by !== 'user',
      },
    },
  };
  if (!i.resolves) return [note];
  return [note, { op: 'update', collection: 'notes', doc_id: i.resolves, data: { answer: text, answeredBy: author, answeredAt: d.ts, answeredByNote: i.eid } }];
}

/** K2-19: the shas of an undo that are not commits of the range (the full ids `git rev-list base..head` prints): a short
 *  sha counts when exactly one of them starts with it. */
export function shasOutside(shas: readonly string[], range: readonly string[]): string[] {
  return shas.filter(s => range.filter(r => r.toLowerCase().startsWith(s.toLowerCase())).length !== 1);
}

/** The commit of the range each sha names (null when it names none or several): two shas with one commit are one commit written twice. */
export function shaCommits(shas: readonly string[], range: readonly string[]): (string | null)[] {
  return shas.map(s => { const m = range.filter(r => r.toLowerCase().startsWith(s.toLowerCase())); return m.length === 1 ? m[0]!.toLowerCase() : null; });
}
