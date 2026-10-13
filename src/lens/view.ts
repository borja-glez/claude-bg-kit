// What the lens panel and band draw, worked out once from the PanelModel and drawn twice: as cells on the terminal
// (term.tsx) and as SVG on the desktop (svg.ts). Pure, so it is tested without a surface.
import type { PanelModel } from './model.js';

// Catppuccin Mocha, the waypoint roadmap's palette; the SVG side switches to Latte under a light scheme.
export const PALETTE = {
  base: '#1e1e2e', mantle: '#181825', crust: '#11111b', s0: '#313244', s1: '#45475a', s2: '#585b70', o0: '#6c7086',
  sub: '#a6adc8', text: '#cdd6f4', lavender: '#b4befe', blue: '#89b4fa', sapphire: '#74c7ec', sky: '#89dceb',
  teal: '#94e2d5', green: '#a6e3a1', yellow: '#f9e2af', peach: '#fab387', red: '#f38ba8', mauve: '#cba6f7',
  pink: '#f5c2e7', flamingo: '#f2cdcd',
} as const;
export const LATTE: Record<keyof typeof PALETTE, string> = {
  base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8', s0: '#ccd0da', s1: '#bcc0cc', s2: '#acb0be', o0: '#9ca0b0',
  sub: '#6c6f85', text: '#4c4f69', lavender: '#7287fd', blue: '#1e66f5', sapphire: '#209fb5', sky: '#04a5e5',
  teal: '#179299', green: '#40a02b', yellow: '#df8e1d', peach: '#fe640b', red: '#d20f39', mauve: '#8839ef',
  pink: '#ea76cb', flamingo: '#dd7878',
};
export type Hue = keyof typeof PALETTE;

// A task's state, as the roadmap colours it: done sapphire, active peach, blocked yellow, failed red, pending grey.
export type CellState = 'done' | 'active' | 'blocked' | 'failed' | 'pending';
export const STATE_HUE: Record<CellState, Hue> = { done: 'sapphire', active: 'peach', blocked: 'yellow', failed: 'red', pending: 's2' };
const LETTER: Record<string, CellState> = { d: 'done', a: 'active', b: 'blocked', p: 'pending' };

// Each section's own colour and glyph.
export type SectionId = 'roadmap' | 'forge' | 'superpowers' | 'todos' | 'agents' | 'tasks' | 'now';
export const SECTION_HUE: Record<SectionId, Hue> = {
  roadmap: 'sapphire', forge: 'peach', superpowers: 'mauve', todos: 'green', agents: 'lavender', tasks: 'teal', now: 'sky',
};
export const SECTION_ICON: Record<SectionId, string> = {
  // Single-width glyphs only: some terminals draw ⚒ or ☰ two cells wide and the title runs into them.
  roadmap: '◆', forge: '◈', superpowers: '✦', todos: '≡', agents: '◎', tasks: '▤', now: '▸',
};

// An agent's level: forge's implementer ladder from cool to warm, the reviewers by what they judge.
export interface Tier { label: string; hue: Hue; rank: number | null }
const TIERS: Record<string, Tier> = {
  'forge-mech': { label: 'mech', hue: 'teal', rank: 1 },
  'forge-impl-light': { label: 'light', hue: 'sky', rank: 2 },
  'forge-impl': { label: 'impl', hue: 'blue', rank: 3 },
  'forge-impl-high': { label: 'high', hue: 'lavender', rank: 4 },
  'forge-impl-heavy': { label: 'heavy', hue: 'mauve', rank: 5 },
  'forge-fable': { label: 'fable', hue: 'pink', rank: 6 },
  'forge-review-correctness': { label: 'correctness', hue: 'green', rank: null },
  'forge-review-security': { label: 'security', hue: 'red', rank: null },
  'forge-review-perf': { label: 'perf', hue: 'yellow', rank: null },
  'forge-verify': { label: 'verify', hue: 'sapphire', rank: null },
  'forge-verify-heavy': { label: 'verify', hue: 'sapphire', rank: null },
  'forge-planner': { label: 'planner', hue: 'lavender', rank: null },
  'forge-scout': { label: 'scout', hue: 'flamingo', rank: null },
  'design-critic': { label: 'critic', hue: 'flamingo', rank: null },
};
export function tierOf(agent: string | null | undefined): Tier {
  const name = String(agent ?? '').split(':').pop() ?? '';
  return TIERS[name] ?? { label: name || '?', hue: 'lavender', rank: null };
}

// forge's path by weight.
export const PATH_HUE: Record<string, Hue> = { trivial: 'green', small: 'teal', medium: 'peach', large: 'red' };

// The stages forge goes through; a phase it names that is none of them is drawn on its own.
// `execution` is a Large run's plan being executed (path 'run' below).
export const STAGES = ['triage', 'design', 'plan', 'execution', 'implement', 'validate', 'verify', 'review', 'verdict', 'final'] as const;
const RUN_STAGES: readonly (typeof STAGES)[number][] = ['design', 'plan', 'execution', 'final'];
const STAGE_OF: Record<string, (typeof STAGES)[number]> = {
  triage: 'triage', design: 'design', plan: 'plan', planning: 'plan', execution: 'execution', implement: 'implement', implementation: 'implement',
  impl: 'implement', fix: 'implement', redo: 'implement', validate: 'validate', validation: 'validate', verify: 'verify', review: 'review',
  verdict: 'verdict', round: 'verdict', final: 'final', 'final-review': 'final', done: 'final',
};

/** The STAGES name a forge phase belongs to (fix → implement, planning → plan…); an unknown phase keeps its own name. */
export const stageOf = (phase: string): string => {
  const p = String(phase).toLowerCase();
  return Object.hasOwn(STAGE_OF, p) ? STAGE_OF[p] : p;
};

export interface Stage { name: string; state: 'done' | 'active' | 'pending' }
// The stages of forge's path: Large shows design and plan, the others skip them; final only on Large.
// Trivial and Small have no reviewers. `validated` says how the last validation went: Trivial logs no phases,
// so validators that ran are what moves it past implement. Path 'run' is a Large run as a whole while its plan
// executes: design ▸ plan ▸ execution ▸ final.
export function stagesFor(path: string, phase: string, validated: 'ok' | 'failed' | null = null, verifyPlanned = false): Stage[] {
  if (path === 'run') {
    if (phase.toLowerCase() === 'done') return RUN_STAGES.map(name => ({ name, state: 'done' }));
    const i = RUN_STAGES.indexOf(STAGE_OF[phase.toLowerCase()] ?? 'execution');
    const at = i < 0 ? RUN_STAGES.indexOf('execution') : i;
    return RUN_STAGES.map((name, k) => ({ name, state: k < at ? 'done' : k === at ? 'active' : 'pending' }));
  }
  const large = path === 'large';
  const light = path === 'trivial' || path === 'small';
  const names = STAGES.filter(s => s !== 'execution' && (large || (s !== 'design' && s !== 'plan' && s !== 'final'))
    && !(light && (s === 'review' || s === 'verdict')) && (s !== 'verify' || verifyPlanned));
  if (phase.toLowerCase() === 'done') return names.map(name => ({ name, state: 'done' }));
  const at = STAGE_OF[phase.toLowerCase()] ?? null;
  let i = at ? names.indexOf(at) : -1;
  const v = names.indexOf('validate');
  if (validated && at === null) {
    if (validated === 'failed') i = v;
    else if (light) return names.map(name => ({ name, state: 'done' }));
    else i = v + 1;
  }
  const out: Stage[] = names.map((name, k) => ({ name, state: i < 0 ? (k === 0 ? 'done' : 'pending') : k < i ? 'done' : k === i ? 'active' : 'pending' }));
  return out;
}

// The phase to show: a run whose briefs are all accepted is done, even when the session never logged the done phase;
// so is a finished Trivial or Small task (those paths log no phases).
// A done phase while the clock still runs (the task reopened) is not read as done.
export function forgePhase(f: NonNullable<PanelModel['forge']>): string {
  if ((f.path === 'trivial' || f.path === 'small') && f.timing?.done) return 'done';
  if (f.timing?.done === false && f.phase.toLowerCase() === 'done') return '';
  const total = Math.max(f.briefs ?? 0, f.brief ?? 0);
  const accepted = new Set(f.accepted ?? []);
  const all = total > 0 && Array.from({ length: total }, (_, i) => i + 1).every(n => accepted.has(n));
  return all && f.verdict?.action === 'accept' ? 'done' : f.phase;
}

export interface Cells { cells: CellState[]; done: number; total: number }
export const count = (cells: CellState[]): Cells => ({ cells, done: cells.filter(c => c === 'done').length, total: cells.length });

export const roadmapCells = (w: NonNullable<PanelModel['waypoint']>): Cells =>
  count([...(w.cells ?? '')].map(ch => LETTER[ch] ?? 'pending'));

/** The forge task is over: its phase reads done or its timing ended. */
export const forgeDone = (f: NonNullable<PanelModel['forge']>): boolean => forgePhase(f) === 'done' || f.timing?.done === true;

// forge's briefs: accepted done, the current one active (failed after a verdict that sent it back), the rest pending.
// Drawn for Medium and Large; a light task's briefs only once it is done, and then all done (they get no verdict).
export function briefCells(f: NonNullable<PanelModel['forge']>): Cells | null {
  const heavy = f.path === 'medium' || f.path === 'large';
  const done = !heavy && forgeDone(f);
  if (!heavy && !done) return null;
  const accepted = new Set(f.accepted ?? []);
  const total = Math.max(f.briefs ?? 0, f.brief ?? 0, ...accepted);
  if (total <= 0) return null;
  const sentBack = f.verdict !== null && f.verdict.action !== 'accept';
  const cells: CellState[] = [];
  for (let n = 1; n <= Math.min(total, 60); n++) {
    cells.push(done || accepted.has(n) ? 'done' : n === f.brief ? (sentBack && f.round ? 'failed' : 'active') : 'pending');
  }
  return count(cells);
}

export function todoCells(t: NonNullable<PanelModel['todos']>): Cells {
  const cells: CellState[] = [];
  const total = Math.min(t.total, 60);
  for (let i = 0; i < total; i++) cells.push(i < t.done ? 'done' : i === t.done && t.inProgress ? 'active' : 'pending');
  return { cells, done: t.done, total: t.total };
}

export function superpowersCells(s: NonNullable<PanelModel['superpowers']>): Cells {
  const cells: CellState[] = [];
  const total = Math.min(s.tasks, 60);
  for (let i = 0; i < total; i++) cells.push(i < s.done ? 'done' : i === s.done ? (s.current ? 'failed' : 'active') : 'pending');
  return { cells, done: s.done, total: s.tasks };
}

export const ratio = (done: number, total: number): number => (total > 0 ? Math.max(0, Math.min(1, done / total)) : 0);
export const pct = (done: number, total: number): string => `${Math.round(ratio(done, total) * 100)}%`;

// A text bar `width` cells wide: whole blocks for done, eighths for the edge, a light shade for the rest.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
export function barParts(r: number, width: number): { fill: string; rest: string } {
  const w = Math.max(1, Math.floor(width));
  const exact = Math.max(0, Math.min(1, r)) * w;
  const full = Math.floor(exact);
  const edge = full < w ? EIGHTHS[Math.round((exact - full) * 7)] : '';
  const fill = '█'.repeat(full) + edge;
  return { fill, rest: '░'.repeat(Math.max(0, w - full - (edge ? 1 : 0))) };
}

export const duration = (seconds: number | null | undefined): string | null =>
  seconds === null || seconds === undefined ? null
    : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
      : `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;

export const DAY_S = 86_400;
/** duration() for a span: null when missing, not finite or negative; «>24h» past a day. */
export function span(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  return seconds > DAY_S ? '>24h' : duration(Math.floor(seconds));
}

// The one-line summary the band shows: the most specific run going on, in this order.
export interface Headline { section: SectionId; title: string; detail: string; cells: Cells | null; agent: string | null }
export function headline(m: PanelModel): Headline | null {
  if (m.execution?.active) {
    const x = m.execution;
    const detail = x.slots.slice(0, 2).map(s => `${s.task} ${s.stage}`).join(' · ');
    return { section: 'forge', title: `▶ ${x.slots.length}/${x.parallel}`, detail, cells: null, agent: null };
  }
  if (m.forge) {
    const f = m.forge;
    const c = briefCells(f);
    return { section: 'forge', title: f.task, detail: [f.path, forgePhase(f)].filter(Boolean).join(' · '), cells: c, agent: f.agent };
  }
  if (m.waypoint) {
    const w = m.waypoint;
    return { section: 'roadmap', title: w.project, detail: w.current ? `${w.current.id} ${w.current.title}` : '', cells: roadmapCells(w), agent: null };
  }
  if (m.superpowers) {
    const s = m.superpowers;
    return { section: 'superpowers', title: s.plan || 'superpowers', detail: s.current ? `round ${s.current.round}/5` : '', cells: superpowersCells(s), agent: null };
  }
  if (m.todos) return { section: 'todos', title: m.todos.inProgress ?? '', detail: '', cells: todoCells(m.todos), agent: null };
  if (m.subagents.length) return { section: 'agents', title: '', detail: '', cells: null, agent: m.subagents.at(-1)!.type };
  return null;
}

const dec = (locale: string) => (locale.startsWith('es') ? ',' : '.');
export function fmtTokens(n: number, locale: string): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(2).replace('.', dec(locale))} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(Math.round(n));
}
export function fmtUsd(n: number, locale: string): string {
  const v = (Math.round(n * 100) / 100 < 10 ? n.toFixed(2) : n.toFixed(1)).replace('.', dec(locale));
  return locale.startsWith('es') ? `${v} $` : `$${v}`;
}
/** «1,84 M tok · 6,20 $» of this session, for the band. */
export function usageBandText(m: PanelModel): string | null {
  const u = m.usage;
  if (!u) return null;
  const own = u.session ?? { tokens: u.tokens, costUsd: u.costUsd };
  return `${fmtTokens(own.tokens, m.locale)} tok · ${u.sessionPartial ? '≥ ' : ''}${fmtUsd(own.costUsd, m.locale)}`;
}
