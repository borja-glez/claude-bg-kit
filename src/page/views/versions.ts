// v3: what each version holds, at a glance. A card per version: its state (completed, in progress, pending), its bar and
// tasks, its target, and its phases as chips with their percent; a chip opens Plan on that phase, and «Ver sus tareas»
// opens Plan filtered by the version (pf=v:<id>). Resumen shows the cards in its side column, Plan above its list.
import type { Metrics } from '../../lib/metrics.js';
import { targetMs } from '../../lib/insights.js';
import { phaseName } from '../../lib/timeline.js';
import type { PlanVersion } from '../../lib/types.js';
import type { Dict } from '../i18n.js';
import { esc, num } from '../html.js';
import type { Model } from '../model.js';

export type VersionState = 'done' | 'current' | 'pending';
export const versionLabel = (id: string): string => (/^v/i.test(id) ? id : `v${id}`);
/** The version id a link or the URL carries (pf=v:<id>): the same characters a track id allows. */
export const VERSION_KEY = /^v:([\w.-]{1,64})$/;

/** A version's state: completed when every task is done, in progress when it is the metrics' current one, else pending. */
export function versionState(x: Metrics, v: PlanVersion): VersionState {
  const b = x.byVersion[v.id];
  if (b && b.total > 0 && b.done >= b.total) return 'done';
  return v.id === x.currentVersion ? 'current' : 'pending';
}

/** The version each phase belongs to: the first that lists it. */
export function versionOfPhase(m: Model): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of m.plan.versions) for (const p of v.phases) if (!out.has(p)) out.set(p, v.id);
  return out;
}

/** A day as «2 nov», in the page's language. */
const day = (ms: number, loc: string): string => {
  try { return new Date(ms).toLocaleDateString(loc, { day: 'numeric', month: 'short' }); } catch { return ''; }
};

/** The cards of every version, in plan order; '' without versions. Each one not done says when it is forecast to end
 *  (`ends`, the plan's one schedule), in amber when that is past its target. `compact` (Resumen's side column) stacks
 *  the cards. */
export function versionCards(m: Model, d: Dict, x: Metrics, opts: { ends?: Readonly<Record<string, number>>; loc?: string; compact?: boolean } = {}): string {
  if (!m.plan.versions.length) return '';
  const owner = versionOfPhase(m);
  const loc = opts.loc ?? 'en';
  const cards = m.plan.versions.map(v => {
    const b = x.byVersion[v.id] ?? { done: 0, total: 0, percent: 0 };
    const state = versionState(x, v);
    const end = state !== 'done' && opts.ends && Object.hasOwn(opts.ends, v.id) ? opts.ends[v.id]! : null;
    const target = targetMs(v.target);
    const late = end !== null && target !== null && end > target;
    const eta = end !== null && day(end, loc)
      ? `<div class="veta mono${late ? ' late' : ''}"${late ? ` title="${esc(d.versions.late)}"` : ''}>${esc(d.versions.eta(day(end, loc)))}${late ? ` · ${esc(d.versions.late)}` : ''}</div>`
      : '';
    // Only the phases this version owns (a phase listed by two versions is the first one's), in plan order.
    const phases = m.plan.phases.filter(p => owner.get(p.id) === v.id);
    const chips = phases.map(p => {
      const pb = x.byPhase[p.id];
      const pct = pb && pb.total ? Math.round((pb.done / pb.total) * 100) : 0;
      const cls = pb?.status === 'done' ? 'done' : pb?.status === 'in_progress' ? 'cur' : '';
      const name = phaseName(p.id, p.name);
      return `<button type="button" class="vph ${cls}" data-action="view" data-view="plan" data-pf="v:${esc(v.id)}" data-ph="${esc(p.id)}" data-k="vph:${esc(v.id)}:${esc(p.id)}" title="${esc(`${p.id}${name ? ` · ${name}` : ''} · ${pb?.done ?? 0}/${pb?.total ?? 0}`)}"><i style="width:${pct}%"></i><b>${esc(p.id)}</b> ${pct} %</button>`;
    }).join('');
    const goal = v.target ? `<span class="vtg mono">${esc(d.versions.target(v.target))}</span>` : '';
    return `<article class="vc vs-${state}" data-k="vc:${esc(v.id)}"><header><b class="vid">${esc(versionLabel(v.id))}</b> <span class="pill vs-${state}">${esc(d.versions.state[state])}</span>${goal}</header>`
      + `<div class="bar${state === 'done' ? ' c' : ''}"><i style="width:${num(b.percent)}%"></i></div>`
      + `<div class="vnums mono"><span>${esc(d.versions.tasks(b.done, b.total))}</span><span><b>${num(b.percent)} %</b> · ${esc(d.versions.phases(phases.length))}</span></div>`
      + `${eta}${chips ? `<div class="vphs">${chips}</div>` : ''}`
      + `<button type="button" class="lnk vsee" data-action="view" data-view="plan" data-pf="v:${esc(v.id)}" data-k="vsee:${esc(v.id)}">${esc(d.versions.see)} →</button></article>`;
  }).join('');
  return `<div class="vcards${opts.compact ? ' compact' : ''}">${cards}</div>`;
}
