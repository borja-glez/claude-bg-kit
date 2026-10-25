// F-09, F-12: the parts of lens's own band, fitted as waypoint's are (src/mod/band-fit.ts). Two or more tasks of this
// session in progress are named one by one, «T001 impl · T002 rev r2 · T003 val»; else the headline of today (the run,
// forge's task, the roadmap, superpowers or the todos) with its count and detail. Then the subagents, those without a
// task by their description, and the spend. Pure: register.tsx draws it with termBand or, on the desktop, bandSvg.
import type { PanelModel } from './model.js';
import type { BandPart } from '../mod/band-fit.js';
import { STAGE_SHORT } from '../mod/band-line.js';
import { clipWidth } from '../lib/text-width.js';
import { headline, ratio, usageBandText, type CellState, type SectionId } from './view.js';

type Row = PanelModel['activities'][number];
const VALIDATING = new Set(['prep', 'review-prep', 'validate']);
const AGENTS_NAMED = 3;
const AGENT_TEXT = 24;

/** This session's forge tasks in progress: its own, neither done nor stopped, in the model's order. */
export function ownInProgress(m: PanelModel | null | undefined): Row[] {
  return (m?.activities ?? []).filter(a => a.kind === 'forge' && a.owner === 'own' && !a.done && !a.stopped && a.task !== null);
}

/** «T001 impl», «T002 rev r2», «T003 val»: a task in progress as short as a band says it; a live job instead of its stage. */
export function activityTag(a: Row): string {
  const doing = a.job
    ? (VALIDATING.has(a.job.name) ? 'val' : a.job.name === 'integrate' ? 'int' : a.job.name)
    : a.stage ? STAGE_SHORT[a.stage] ?? a.stage : null;
  return [a.task, doing, a.round ? `r${a.round}` : null].filter(Boolean).join(' ');
}

export interface LensBand { parts: BandPart[]; section: SectionId; cells: CellState[]; ratio: number; spin: boolean }

/**
 * Final review m-4: what lens's band is about, which its × closes it for: the tasks it names, the run, the todo list, the
 * subagents, or the section and title of its headline (forge's task, the roadmap's project, the superpowers plan). A band
 * about something else is drawn again. Re-review m-3, m-4: a set is keyed whatever its order; the todos by the items of
 * their list (`live.todos`; a step along it is the same subject, a new item another) and the subagents by their ids
 * (`live.agents`, else the model's), so neither lasts a whole session.
 */
export function bandSubject(m: PanelModel | null, live: { todos?: readonly string[]; agents?: readonly string[] } = {}): string {
  const set = (xs: readonly string[], sep: string) => [...new Set(xs)].sort().join(sep);
  const agents = () => `agents:${set(live.agents ?? (m?.subagents ?? []).map(s => s.id), ' ')}`;
  const acts = ownInProgress(m);
  if (acts.length >= 2) return `tasks:${set(acts.map(a => a.key), ' ')}`;
  const head = m ? headline(m) : null;
  if (!head) return agents();
  if (m?.execution?.active) return `run:${m.execution.runId}`;
  if (head.section === 'todos') return `todos:${live.todos ? set(live.todos, '\n') : String(m?.todos?.total ?? 0)}`;
  if (head.section === 'agents') return agents();
  return `${head.section}:${head.title}`;
}

/** The band's parts, its section (icon and colour), its boxes and their ratio, and whether a spinner shows. */
export function lensBand(m: PanelModel | null, t: { sSubagents: string; sNow: string; needsN: (n: number) => string }, agentsHeard: number): LensBand {
  const acts = ownInProgress(m);
  const head = m ? headline(m) : null;
  const agents = m ? m.subagents.length : agentsHeard;
  const parts: BandPart[] = [];
  let section: SectionId = head?.section ?? 'agents';
  let cells = head?.cells ?? null;
  if (acts.length >= 2) {
    section = 'forge';
    cells = null;
    for (const a of acts) parts.push({ key: `slot:${a.key}`, text: activityTag(a), prio: 4 });
  } else {
    const title = head?.title || (section === 'agents' ? t.sSubagents : t.sNow);
    parts.push({ key: 'title', text: title, title, prio: 4 });
    if (cells?.total) parts.push({ key: 'count', text: `${cells.done}/${cells.total}`, prio: 5, hue: 'accent' });
    if (head?.detail) parts.push({ key: 'detail', text: head.detail, prio: 6, hue: 'dim' });
  }
  const needs = m?.needs?.total;
  if (needs) parts.push({ key: 'needs', text: `» ${t.needsN(needs)}`, short: `» ${needs}`, prio: 3, hue: 'accent' });
  if (agents > 0) parts.push({ key: 'agents', text: `◎ ${agents}`, prio: 5, hue: 'accent' });
  const adhoc = (m?.activities ?? []).find(a => a.kind === 'adhoc')?.agents ?? [];
  for (const g of adhoc.slice(0, AGENTS_NAMED)) {
    parts.push({ key: `agent:${g.id}`, text: clipWidth((g.description || g.type || '?').replace(/\s+/g, ' ').trim(), AGENT_TEXT), prio: 6, hue: 'dim' });
  }
  const spent = m ? usageBandText(m) : null;
  if (spent) parts.push({ key: 'spend', text: spent, prio: 7, hue: 'dim' });
  return { parts, section, cells: cells?.cells ?? [], ratio: cells ? ratio(cells.done, cells.total) : 0, spin: agents > 0 };
}
