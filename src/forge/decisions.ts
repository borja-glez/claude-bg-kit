// forge's decision records: the strict input of `forge decision add`, the ledger events, .forge/decisions.json and the
// docs/forge/decisions/<scope>.md file of a project without a roadmap. Never runs git and never deletes anything.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { appendEvent, forgeDir, readEvents, type LedgerEvent } from './ledger.js';
import {
  BRANCH, DECISION_BY, DECISION_POINTS, LIMITS, PROJECT_ID, RUN_ID, SHA, TASK_ID, clean, decisionScope, nextDecisionsDoc,
  normalizeDecision, normalizeDecisionsDoc, weightOf, type Decision, type DecisionsDoc,
} from '../lib/decisions.js';

export class DecisionInputError extends Error {}
export const decisionsFile = (root: string) => path.join(root, '.forge', 'decisions.json');

const notDots = (s: string) => s !== '.' && s !== '..';
const line = (max: number) => z.string().transform(s => clean(s, max)).pipe(z.string().min(1, 'must not be empty'));
const ident = (re: RegExp) => z.string().regex(re).refine(notDots, 'invalid id');
const Undo = z.discriminatedUnion('type', [
  z.object({ type: z.literal('git-revert'), base: z.string().regex(SHA), head: z.string().regex(SHA), cwd: line(500).optional() }).strict(),
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
export interface DecisionFilter { task?: string; run?: string; since?: string; all?: boolean; auto?: boolean }

/** Every decision of the ledger, numbered by its position among the `decision` events (1-based; the ledger only grows). */
export function allDecisions(root: string): Numbered[] {
  const out: Numbered[] = [];
  readEvents(root).filter(e => e.kind === 'decision').forEach((e, i) => {
    const d = normalizeDecision(e);
    if (d) out.push({ ...d, n: i + 1 });
  });
  return out;
}

// The task itself or one of its briefs, `<task>-<n>`.
const ownTask = (task: string, t: string | null): boolean =>
  t === task || (!!t && t.startsWith(`${task}-`) && /^\d{1,3}$/.test(t.slice(task.length + 1)));

/** Filters compose. With none of task, run, since or all: the scope of decisions.json, else of the newest decision not by the user. */
export function listDecisions(root: string, f: DecisionFilter): Numbered[] {
  const all = allDecisions(root);
  let out = all;
  if (f.task) { const task = f.task; out = out.filter(d => ownTask(task, d.task)); }
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
