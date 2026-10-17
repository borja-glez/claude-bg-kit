// The lens panel as cards: one per section, each a header and a list of blocks. Built once from the PanelModel;
// term.tsx draws them with cells, svg.ts as SVG.
import type { PanelModel } from './model.js';
import type { Block, Card } from './svg.js';
import {
  SECTION_HUE, SECTION_ICON, PATH_HUE, tierOf, stagesFor, forgePhase, forgeDone, roadmapCells, briefCells, todoCells, superpowersCells,
  ratio, duration, span, short, fmtTokens, fmtUsd, fmtUsdRange, type Hue,
} from './view.js';
import { shortModelName } from '../lib/prices.js';

export interface CardTexts {
  sRoadmap: string; sSuperpowers: string; sNow: string; sTodos: string; sSubagents: string; sTasks: string; sForge: string;
  sExecution: string; manualRow: string; modeSubagents: string; modeSessions: string; alive: string; silent: string; stopped: string;
  queued: string; conflictsLbl: string; blockedLbl: string; orphans: string; integratedN: string;
  stage: Record<'brief' | 'implement' | 'validate' | 'verify' | 'review' | 'verdict' | 'integrate' | 'execution' | 'triage' | 'design' | 'plan' | 'final', string>;
  track: string; phase: string; noTask: string; decision: string; fixRound: string; done: string; open: string;
  tool: string; turn: string; briefs: string; cycle: string; hoursLeft: (hours: number) => string; auto: string; task: string;
  sUsage: string; effort: string; effortLevel: (e: string) => string; thisSession: string; run: string; gMain: string; gImpl: string;
  gReview: string; gPlan: string; gOther: string; tracking: string; withoutForge: string; withoutForgeNote: string;
  forgeCosts: (usd: string, pct: number) => string; forgeSaves: (usd: string) => string; pricesAsOf: string; drift: string; various: string;
  noReview: string; gVerify: string; blocked: string; active: string; sinceStart: string; taskTime: string;
  autoDecisions: (n: number) => string; autoMode: string; staleLedger: string;
  // Wave 3: the tasks in progress, the jobs in the background, the wait on subagents and the verdict without its score.
  sTasksInProgress: string; otherSession: string; validating: string; integrating: string; skipped: string; noResult: string;
  accepted: string; acceptedInRound: (n: number) => string; waitingOn: (n: number, wake: string | null) => string; waitingLbl: string;
  cached: string; reviewersLbl: string;
}

type Forge = NonNullable<PanelModel['forge']>;
type ActivityRow = PanelModel['activities'][number];
type RowAgent = ActivityRow['agents'][number];

const modelRight = (s: { model?: string; effort?: string }, t: CardTexts): string | undefined =>
  s.model ? `${shortModelName(s.model)}${s.effort ? ` · ${t.effortLevel(s.effort)}` : ''}` : undefined;

const VERDICT_HUE: Record<string, Hue> = { accept: 'green', fix: 'yellow', redo: 'red' };
const VALIDATING = new Set(['prep', 'review-prep', 'validate']);

/** What a job in the background does, as a row says it: validating, integrating, or its own command. */
export function jobText(name: string, t: CardTexts): string {
  return VALIDATING.has(name) ? t.validating : name === 'integrate' ? t.integrating : name;
}

/**
 * K4-05: the verdict without its score: «✓ accepted in round 2 · 0 C · 1 I · 3 m», «fix · round 2/4 · 1 C · 2 I». The
 * round is the review that gave it, else the status's own round; critical and important always, minor only above 0.
 */
export function verdictChip(f: { verdict: Forge['verdict']; round: number | null; reviews?: { n: number; max: number } | null }, t: CardTexts): { text: string; hue: Hue } | null {
  const v = f.verdict;
  if (!v) return null;
  const n = v.round ?? (f.round !== null && f.round >= 1 ? f.round : null);
  const c = v.findings;
  const counts = c ? [`${c.critical} C`, `${c.important} I`, ...(c.minor > 0 ? [`${c.minor} m`] : [])] : [];
  const head = v.action === 'accept' ? `✓ ${n !== null ? t.acceptedInRound(n) : t.accepted}`
    : [v.action, n !== null ? `${t.fixRound} ${n}${f.reviews?.max ? `/${f.reviews.max}` : ''}` : null].filter(Boolean).join(' · ');
  return { text: [head, ...counts].join(' · '), hue: VERDICT_HUE[v.action] ?? 'lavender' };
}

// K2-05: a verification skipped, or planned for a task that ended without it ever running.
function verifyState(f: Forge): { skipped: boolean; noResult: boolean } {
  const v = f.verify;
  if (!v?.planned) return { skipped: false, noResult: false };
  return { skipped: v.result === 'skipped', noResult: v.result === null && v.launched !== true && forgeDone(f) };
}

function forgeSubtitle(f: Forge, t: CardTexts): string | undefined {
  const phase = forgePhase(f);
  if (!phase && f.autonomy !== 'auto') return undefined;
  const time = f.timing && span(f.timing.taskSeconds) ? `${f.timing.done && phase !== 'stopped' ? '✓ ' : ''}${span(f.timing.taskSeconds)}` : null;
  return [t.sForge, phase === 'stopped' ? t.stopped : phase, time, f.autonomy === 'auto' && t.autoMode].filter(Boolean).join(' · ');
}

/**
 * The detail of a forge task, as the forge card always drew it: its stages and their times, the verification, the
 * briefs, who works on it (when no agent of the task is linked: the reviewers phase review named, else its last agent)
 * and its chips (validators, the verdict without its score, the round).
 */
function forgeBlocks(m: PanelModel, f: Forge, t: CardTexts, linked: boolean): Block[] {
  const blocks: Block[] = [];
  const vs = verifyState(f);
  // A Large task whose plan is executing draws the run's stages, not those of the last task logged.
  const stages = m.execution?.active && f.path === 'large' ? stagesFor('run', 'execution')
    : stagesFor(f.path, forgePhase(f), f.validators.length ? (f.validators.every(v => v.ok) ? 'ok' : 'failed') : null,
      f.verify?.planned === true && !vs.skipped && !vs.noResult, (f.timing?.stages ?? []).map(s => s.name));
  blocks.push({ kind: 'stages', stages, hue: SECTION_HUE.forge });
  const tm = f.timing;
  if (tm && tm.stages.length) {
    const label = (n: string) => (Object.hasOwn(t.stage, n) ? t.stage[n as keyof CardTexts['stage']] : n);
    blocks.push({ kind: 'text', text: tm.stages.map(s => `${label(s.name)} ${span(s.seconds) ?? '0s'}${s.live ? '…' : ''}`).join(' · '), dim: true });
  }
  if (f.verify?.planned) {
    const v = f.verify;
    const where = `verify ${v.surfaces.join(', ')}`;
    const text = v.result === 'pass' ? `✓ ${where} · ${v.passed}/${v.total}`
      : v.result === 'fail' ? `✗ ${where} · ${v.passed}/${v.total}`
      : v.result === 'blocked' ? `⊘ ${where} · ${t.blocked}: ${v.reason ?? ''}`
      : vs.skipped ? `⊘ ${where} · ${t.skipped}: ${v.reason ?? ''}`
      : vs.noResult ? `⊘ ${where} · ${t.skipped}: ${t.noResult}`
      : where;
    blocks.push({ kind: 'text', text, dim: v.result === null || vs.skipped });
    if (v.evidence) blocks.push({ kind: 'text', text: v.evidence, dim: true });
  }
  const c = briefCells(f);
  if (c) {
    blocks.push({ kind: 'bar', ratio: ratio(c.done, c.total), hue: SECTION_HUE.forge, moving: c.done < c.total, label: t.briefs, right: `${c.done}/${c.total}` });
    blocks.push({ kind: 'cells', cells: c.cells });
  }
  // A finished task has no agent at work, whatever the status still names; the linked agents are drawn under its row.
  if (!linked && !forgeDone(f)) {
    if (f.reviewers?.length && f.phase.toLowerCase() === 'review') blocks.push({ kind: 'text', text: `${t.reviewersLbl}: ${f.reviewers.join(', ')}`, dim: true });
    else if (f.agent) {
      const tier = tierOf(f.agent);
      const live = m.subagents.find(s => tierOf(s.type).label === tier.label);
      blocks.push({ kind: 'row', dot: tier.hue, spinning: !!live, tag: { text: tier.label, hue: tier.hue }, text: live?.description ?? f.agent, right: [live && modelRight(live, t), duration(live?.seconds)].filter(Boolean).join('  ') || undefined });
    }
  }
  const chips: { text: string; hue: Hue }[] = f.validators.map(v => ({ text: `${v.ok ? '✓' : '✗'} ${v.name}${v.cached ? ` · ${t.cached}` : ''}`, hue: v.ok ? 'green' : 'red' }));
  const verdict = verdictChip(f, t);
  if (verdict) chips.push(verdict);
  // The round once: not again in a chip of its own when the verdict chip already names it.
  const verdictRound = f.verdict ? f.verdict.round ?? (f.round !== null && f.round >= 1 ? f.round : null) : null;
  if (f.round !== null && f.round !== verdictRound) chips.push({ text: `${t.fixRound} ${f.round}${f.cap !== null ? `/${f.cap}` : ''}`, hue: f.cap !== null && f.round >= f.cap ? 'red' : 'sub' as Hue });
  if (chips.length) blocks.push({ kind: 'chips', chips });
  return blocks;
}

// The infinite run and forge's automatic decisions, under the forge card or the tasks in progress.
function runBlocks(m: PanelModel, t: CardTexts): Block[] {
  const blocks: Block[] = [];
  const inf = m.infinite;
  if (inf?.active) {
    const right = [inf.cyclesMax !== null ? `${inf.cycle}/${inf.cyclesMax}` : `${inf.cycle}`, inf.hoursLeft !== null && t.hoursLeft(inf.hoursLeft)].filter(Boolean).join(' · ');
    blocks.push({ kind: 'bar', ratio: inf.cyclesMax ? ratio(inf.cycle - 1, inf.cyclesMax) : 0, hue: 'mauve', moving: true, label: `∞ ${t.cycle}`, right });
    for (const title of inf.autoApproved) blocks.push({ kind: 'row', dot: 'green', tag: { text: t.auto, hue: 'green' }, text: title });
  }
  // What forge decided without asking in the last day (.forge/decisions.json): the count and the last major one.
  const dec = m.decisions;
  if (dec) {
    blocks.push({ kind: 'row', dot: 'yellow', tag: { text: `⚑ ${t.auto}`, hue: 'yellow' }, text: t.autoDecisions(dec.count) });
    if (dec.lastMajor) blocks.push({ kind: 'text', text: dec.lastMajor, dim: true });
  }
  return blocks;
}

/** An agent of a task or a slot, indented under it: «impl · Opus 5.5 · Edit · 3m». */
function agentRow(g: RowAgent, t: CardTexts): Extract<Block, { kind: 'row' }> {
  const tier = tierOf(g.type);
  return {
    kind: 'row', dot: tier.hue, spinning: g.status === 'running', tag: { text: tier.label, hue: tier.hue }, text: g.description || g.type || '?',
    right: [g.model ? shortModelName(g.model) : null, g.tool, g.status === 'waiting' ? t.waitingLbl : null, short(g.seconds)].filter(Boolean).join(' · ') || undefined,
    indent: true,
  };
}

/** One task in progress: «[T002] Reparto · medium · review r2 · 12m»; a job takes the stage's place; another session's is marked. */
function activityRow(a: ActivityRow, t: CardTexts): Block {
  const hue = PATH_HUE[a.path ?? ''] ?? 'peach';
  const stage = a.stage ? (Object.hasOwn(t.stage, a.stage) ? t.stage[a.stage as keyof CardTexts['stage']] : a.stage) : null;
  const doing = a.job ? jobText(a.job.name, t) : a.stopped ? t.stopped : a.done ? null : [stage, a.round ? `r${a.round}` : null].filter(Boolean).join(' ') || null;
  return {
    kind: 'row', dot: a.done ? 'green' : a.stopped ? 's2' : hue,
    spinning: a.owner === 'own' && !a.done && !a.stopped && a.agents.some(g => g.status === 'running'),
    tag: { text: a.task ?? 'wf', hue }, text: `${a.done ? '✓ ' : ''}${a.title ?? ''}`,
    right: [a.path, doing, short(a.job ? a.job.seconds : a.seconds), a.owner === 'other' ? t.otherSession : null].filter(Boolean).join(' · ') || undefined,
    dim: a.dim,
  };
}

// Wave 3, §4.4: one row per forge task or workflow that is not a slot, this session's agents under its own rows in
// progress, and the detail of today under the expanded one.
function tasksCard(m: PanelModel, rows: ActivityRow[], t: CardTexts): Card {
  const blocks: Block[] = [];
  const f = m.forge;
  for (const a of rows) {
    blocks.push(activityRow(a, t));
    // Another session's row in progress is drawn without agents or detail (spec §4.3), even when it is the expanded one.
    if (a.owner === 'own' && !a.done && !a.stopped) for (const g of a.agents) blocks.push(agentRow(g, t));
    if (a.expanded && f && a.owner !== 'other') blocks.push(...forgeBlocks(m, f, t, a.agents.length > 0));
  }
  blocks.push(...runBlocks(m, t));
  const head = rows.find(a => a.expanded && a.owner !== 'other');
  return {
    id: 'tasks', icon: SECTION_ICON.forge, title: `${t.sTasksInProgress} · ${rows.length}`, hue: SECTION_HUE.forge,
    chip: head?.path ? { text: head.path, hue: PATH_HUE[head.path] ?? 'peach' } : m.infinite?.active ? { text: '∞', hue: 'mauve' } : undefined,
    subtitle: f && head ? forgeSubtitle(f, t) : undefined,
    blocks,
  };
}

// Order: Now first (one glance: is it alive, on what model), then the work, then Usage as the footer.
export function buildCards(m: PanelModel, t: CardTexts, nowMs: number): Card[] {
  const out: Card[] = [];
  let usageCard: Card | null = null;

  if (m.mainModel || m.tool || m.turnSeconds !== null || m.waiting || m.jobs?.length) {
    const blocks: Block[] = [];
    if (m.mainModel) blocks.push({ kind: 'row', dot: 'lavender', text: `${shortModelName(m.mainModel.model)}${m.mainModel.effort ? ` · ${t.effort} ${t.effortLevel(m.mainModel.effort)}` : ''}` });
    if (m.tool) blocks.push({ kind: 'row', dot: 'sky', spinning: true, tag: { text: t.tool, hue: 'sky' }, text: m.tool.name, right: duration(m.tool.seconds) ?? undefined });
    if (m.turnSeconds !== null) blocks.push({ kind: 'row', dot: 'sub' as Hue, text: t.turn, right: duration(m.turnSeconds) ?? undefined });
    // E-11: no main turn open while the main loop's subagents work: how many, and when the session wakes.
    if (m.waiting) blocks.push({ kind: 'row', dot: 'yellow', text: t.waitingOn(m.waiting.agents, short(m.waiting.wakeSeconds)) });
    // Wave 1: a job in the background whose task has no row of its own.
    for (const j of (m.jobs ?? []).slice(0, 5)) {
      blocks.push({ kind: 'row', dot: 'sky', spinning: true, text: [jobText(j.name, t), j.task].filter(Boolean).join(' '), right: short(j.seconds) ?? undefined });
    }
    out.push({ id: 'now', icon: SECTION_ICON.now, title: t.sNow, hue: SECTION_HUE.now, blocks });
  }

  if (m.waypoint) {
    const w = m.waypoint;
    const cells = roadmapCells(w);
    const blocks: Block[] = [{
      kind: 'bar', ratio: w.percent / 100, hue: SECTION_HUE.roadmap, moving: !!w.current,
      label: w.track ? `${t.track} ${w.track}` : w.run ? t.integratedN : undefined, right: `${w.trackDone}/${w.trackTotal}`,
    }];
    if (cells.total) blocks.push({ kind: 'cells', cells: cells.cells });
    if (w.current) {
      const started = w.current.startedAt ? Date.parse(w.current.startedAt) : NaN;
      const min = Number.isFinite(started) && nowMs >= started ? Math.floor((nowMs - started) / 60000) : null;
      const right = min !== null ? `${min}${w.current.estimateMin ? `/${w.current.estimateMin}` : ''} min` : undefined;
      blocks.push({ kind: 'row', dot: 'peach', spinning: true, tag: { text: w.current.id, hue: 'peach' }, text: w.current.title, right });
    } else if (!w.run) {
      blocks.push({ kind: 'text', text: t.noTask, dim: true });
    }
    for (const r of w.recentDone ?? []) {
      const over = r.estimateMin !== undefined && r.minutes > r.estimateMin;
      blocks.push({ kind: 'text', text: `✓ ${r.id} · ${r.minutes > 1440 ? '>24h' : r.minutes}${r.estimateMin ? `/${r.estimateMin}` : ''} min`, dim: true, ...(over ? { hue: 'yellow' as Hue } : {}) });
    }
    const chips: { text: string; hue: Hue }[] = [];
    if (w.inbox > 0) chips.push({ text: `✎ ${w.inbox}`, hue: 'blue' });
    if (w.escalation) chips.push({ text: `▲ ${t.decision}`, hue: 'red' });
    if (chips.length) blocks.push({ kind: 'chips', chips });
    out.push({
      id: 'roadmap', icon: SECTION_ICON.roadmap, title: w.project, hue: SECTION_HUE.roadmap, chip: { text: `${w.percent}%`, hue: SECTION_HUE.roadmap },
      subtitle: w.phase ? `${t.phase} ${w.phase.index}/${w.phase.total} · ${w.phase.name}` : undefined, blocks,
    });
  }

  // Wave 3: the tasks in progress replace the forge card when there is a row; without one, the card of today stays for
  // the infinite run, the automatic decisions, and a model whose activities could not be built.
  const rows = (m.activities ?? []).filter(a => (a.kind === 'forge' || a.kind === 'workflow') && !a.slot);
  if (rows.length) out.push(tasksCard(m, rows, t));
  else if (m.forge || m.infinite?.active || m.decisions) {
    const f = m.forge;
    out.push({
      id: 'tasks', icon: SECTION_ICON.forge, title: f?.task ?? 'forge', hue: SECTION_HUE.forge,
      chip: f?.path ? { text: f.path, hue: PATH_HUE[f.path] ?? 'peach' } : m.infinite?.active ? { text: '∞', hue: 'mauve' } : undefined,
      subtitle: f ? forgeSubtitle(f, t) : undefined,
      blocks: [...(f ? forgeBlocks(m, f, t, false) : []), ...runBlocks(m, t)],
    });
  }

  if (m.execution) {
    const x = m.execution;
    const HUE: Record<'alive' | 'silent' | 'stopped', Hue> = { alive: 'green', silent: 'yellow', stopped: 'red' };
    const stage = (s: string) => t.stage[s as keyof CardTexts['stage']] ?? s;
    const blocks: Block[] = [{
      kind: 'bar', ratio: ratio(x.slots.length, x.parallel), hue: 'teal', moving: x.active && x.slots.length > 0,
      label: `${x.mode === 'sessions' ? t.modeSessions : t.modeSubagents} ${x.slots.length}/${x.parallel}`,
      // F-10: integrated out of the total, as the band says it; the accepted ones are listed below («to integrate»).
      right: `${x.integrated}/${x.total} ${t.integratedN}`,
    }];
    if (x.stallReason) blocks.push({ kind: 'text', text: x.stallReason, dim: false });
    // C2: another session's run is dim; E-02: each slot's agents go under it.
    const dim = x.dim ? { dim: true } : {};
    for (const s of x.slots) {
      blocks.push({
        kind: 'row', dot: HUE[s.liveness], spinning: s.liveness === 'alive', tag: { text: s.task, hue: HUE[s.liveness] }, text: s.title ?? '',
        right: [stage(s.stage), s.agent ? tierOf(s.agent).label : null, duration(s.seconds),
          s.taskSeconds != null && span(s.taskSeconds) ? `${t.taskTime} ${span(s.taskSeconds)}` : null, s.round ? `r${s.round}` : null].filter(Boolean).join(' · '),
        ...dim,
      });
      for (const g of s.agents ?? []) blocks.push({ ...agentRow(g, t), ...dim });
    }
    for (const s of x.manual) {
      blocks.push({
        kind: 'row', dot: HUE[s.liveness], spinning: s.liveness === 'alive',
        text: `${t.manualRow} · ${s.task}${s.title ? ` ${s.title}` : ''}`, right: [stage(s.stage), duration(s.seconds)].filter(Boolean).join(' · '), ...dim,
      });
    }
    if (x.finished?.length) blocks.push({ kind: 'text', text: `✓ ${x.finished.map(f => `${f.task} ${span(f.seconds) ?? '0s'}`).join(' · ')}`, dim: true });
    const list = (label: string, ids: string[]) => { if (ids.length) blocks.push({ kind: 'text', text: `${label}: ${ids.join(', ')}`, dim: true }); };
    list(t.queued, x.queued); list(t.conflictsLbl, x.conflicts); list(t.blockedLbl, x.blocked); list(t.orphans, x.orphans);
    const coord = x.coordinator.liveness;
    out.push({ id: 'execution', icon: '►', title: t.sExecution, hue: 'teal', chip: { text: coord === 'alive' ? t.alive : coord === 'silent' ? t.silent : t.stopped, hue: HUE[coord] },
      subtitle: x.elapsedSeconds != null && span(x.elapsedSeconds) ? `◷ ${span(x.elapsedSeconds)}` : undefined, blocks,
    });
  }

  if (m.usage) {
    const u = m.usage;
    const loc = m.locale;
    const usd = (v: number | null) => (v === null ? '—' : fmtUsd(v, loc));
    const name = (g: { model: string | null; effort?: string | null }) => {
      if (g.model === null) return '';
      const effort = !g.effort ? '' : ` · ${g.effort === 'varios' ? t.various : t.effortLevel(g.effort)}`;
      return `${g.model === 'varios' ? t.various : shortModelName(g.model)}${effort}`;
    };
    // «Other» only reads right next to forge's own groups; on its own it is just the subagents.
    const forgeGroups = u.groups.some(g => g.id === 'impl' || g.id === 'review' || g.id === 'plan');
    const label: Record<string, string> = { main: t.gMain, impl: t.gImpl, review: t.gReview, verify: t.gVerify, plan: t.gPlan, other: forgeGroups ? t.gOther : t.sSubagents };
    const blocks: Block[] = [{
      kind: 'bar', ratio: 1, hue: 'teal', label: u.scope === 'run' ? t.run : t.thisSession,
      right: `${fmtTokens(u.tokens, loc)} tok · ${u.partial ? '≥ ' : ''}${fmtUsd(u.costUsd, loc)}`,
    }];
    if (u.time) {
      const tm = u.time;
      const line = (active: number, partial: boolean, since: number | null) =>
        `◷ ${t.active} ${partial ? '≥ ' : ''}${span(active) ?? '0s'}${since !== null && span(since) ? ` · ${t.sinceStart} ${span(since)}` : ''}`;
      blocks.push({ kind: 'text', text: line(tm.activeSeconds, tm.activePartial, tm.sinceStartSeconds) });
      if (tm.session) blocks.push({ kind: 'text', text: `${t.thisSession}: ${line(tm.session.activeSeconds, false, tm.session.sinceStartSeconds)}`, dim: true });
    }
    if (u.session) blocks.push({ kind: 'text', text: `${t.thisSession}: ${fmtTokens(u.session.tokens, loc)} tok · ${u.sessionPartial ? '≥ ' : ''}${fmtUsd(u.session.costUsd, loc)}`, dim: true });
    if (u.officialUsd !== null) blocks.push({ kind: 'text', text: `${u.drift ? '▲ ' : ''}/cost ${fmtUsd(u.officialUsd, loc)}${u.drift ? ` · ${t.drift}` : ''}`, dim: !u.drift });
    for (const g of u.groups) {
      blocks.push({ kind: 'row', dot: 'teal', tag: { text: label[g.id], hue: 'teal' }, text: name(g), right: `${fmtTokens(g.tokens, loc)} · ${usd(g.costUsd)} · ${Math.round(g.share * 100)} %` });
    }
    if (u.tracking) blocks.push({ kind: 'row', dot: 's2', tag: { text: `${t.tracking} ≈`, hue: 's2' }, text: 'waypoint+forge', right: `~${fmtTokens(u.tracking.tokens, loc)} · ${usd(u.tracking.costUsd)}` });
    if (u.withoutForge) {
      const w = u.withoutForge;
      // Against a partial total the delta would mislead: only the estimate is shown.
      const diff = u.partial ? t.noReview
        : w.deltaUsd >= 0 ? t.forgeCosts(fmtUsd(w.deltaUsd, loc), w.deltaPct) : t.forgeSaves(fmtUsd(-w.deltaUsd, loc));
      // E-08: with the tracking re-read, a range: its low end takes the re-read off too.
      const est = w.lowUsd !== undefined && w.lowUsd < w.costUsd - 0.005 ? fmtUsdRange(w.lowUsd, w.costUsd, loc) : fmtUsd(w.costUsd, loc);
      blocks.push({ kind: 'text', text: `${t.withoutForge}: ~${est} · ${diff}` });
      blocks.push({ kind: 'text', text: t.withoutForgeNote, dim: true });
    }
    blocks.push({ kind: 'text', text: `${t.pricesAsOf} ${u.pricesAsOf}`, dim: true });
    usageCard = { id: 'usage', icon: '$', title: t.sUsage, hue: 'teal', chip: { text: `${u.partial ? '≥ ' : ''}${fmtUsd(u.costUsd, loc)}`, hue: 'teal' }, blocks };
  }

  if (m.superpowers) {
    const s = m.superpowers;
    const c = superpowersCells(s);
    const n = s.current ? s.current.task : String(s.done < s.tasks ? s.done + 1 : s.done);
    const blocks: Block[] = [
      { kind: 'bar', ratio: ratio(c.done, c.total), hue: SECTION_HUE.superpowers, moving: s.done < s.tasks, label: `${t.task} ${n}/${s.tasks}`, right: `${s.done} ${t.done}` },
      { kind: 'cells', cells: c.cells },
    ];
    if (s.current) blocks.push({ kind: 'chips', chips: [{ text: `${t.fixRound} ${s.current.round}${s.current.cap ? `/${s.current.cap}` : ''}`, hue: 'yellow' }] });
    if (s.stale) blocks.push({ kind: 'text', text: t.staleLedger, dim: true });
    for (const line of s.lastLines) blocks.push({ kind: 'text', text: line, dim: true });
    out.push({ id: 'superpowers', icon: SECTION_ICON.superpowers, title: s.plan || t.sSuperpowers, hue: SECTION_HUE.superpowers, chip: { text: `${Math.round(ratio(s.done, s.tasks) * 100)}%`, hue: SECTION_HUE.superpowers }, blocks });
  }

  if (m.todos) {
    const td = m.todos;
    const c = todoCells(td);
    const blocks: Block[] = [{ kind: 'bar', ratio: ratio(td.done, td.total), hue: SECTION_HUE.todos, moving: !!td.inProgress }, { kind: 'cells', cells: c.cells }];
    for (const text of td.active ?? (td.inProgress ? [td.inProgress] : [])) blocks.push({ kind: 'row', dot: 'peach', spinning: true, text });
    for (const next of td.next) blocks.push({ kind: 'row', dot: 's2', text: next });
    out.push({ id: 'todos', icon: SECTION_ICON.todos, title: t.sTodos, hue: SECTION_HUE.todos, chip: { text: `${td.done}/${td.total}`, hue: SECTION_HUE.todos }, blocks });
  }

  // E-09: an agent drawn under its task or its slot is not drawn again; the rest carry their task, and one that waits
  // (a teammate idle between turns) says so. The chip counts every live agent.
  const done = m.subagentsDone ?? [];
  const loose = m.subagents.filter(s => !s.shown);
  if (loose.length || done.length) {
    const blocks: Block[] = loose.slice(-10).map(s => {
      const tier = tierOf(s.type);
      const waiting = s.status === 'waiting' || s.status === 'idle';
      return {
        kind: 'row', dot: tier.hue, spinning: !waiting, tag: { text: tier.label, hue: tier.hue },
        text: `${s.task ? `[${s.task}] ` : ''}${s.description || s.type || '?'}`,
        right: [modelRight(s, t), waiting ? t.waitingLbl : null, duration(s.seconds)].filter(Boolean).join('  ') || undefined,
      };
    });
    for (const d of done) {
      const text = ['✓ ' + tierOf(d.type).label, d.description, d.model ? shortModelName(d.model) : null, span(d.seconds)].filter(Boolean).join(' · ');
      blocks.push({ kind: 'text', text, dim: true });
    }
    out.push({
      id: 'agents', icon: SECTION_ICON.agents, title: t.sSubagents, hue: SECTION_HUE.agents,
      chip: m.subagents.length ? { text: String(m.subagents.length), hue: SECTION_HUE.agents } : undefined, blocks,
    });
  }

  if (m.ccTasks) {
    const cc = m.ccTasks;
    const blocks: Block[] = [
      { kind: 'bar', ratio: ratio(cc.done, cc.done + cc.open), hue: SECTION_HUE.tasks, label: `${cc.open} ${t.open}`, right: `${cc.done} ${t.done}` },
      ...cc.recent.map(r => ({ kind: 'row', dot: 'teal', text: r }) as Block),
    ];
    out.push({ id: 'ccTasks', icon: SECTION_ICON.tasks, title: t.sTasks, hue: SECTION_HUE.tasks, blocks });
  }

  if (usageCard) out.push(usageCard);
  return out;
}

/** Everything a card says, as one line: the SVG's alt text, for a reader that cannot see it. */
export function cardAlt(card: Card): string {
  const parts: string[] = [card.title];
  if (card.chip) parts.push(card.chip.text);
  if (card.subtitle) parts.push(card.subtitle);
  for (const b of card.blocks) {
    if (b.kind === 'bar') parts.push([b.label, b.right].filter(Boolean).join(' '));
    else if (b.kind === 'cells') parts.push(`${b.cells.filter(c => c === 'done').length}/${b.cells.length}`);
    else if (b.kind === 'stages') parts.push(b.stages.map(s => (s.state === 'active' ? `[${s.name}]` : s.name)).join(' → '));
    else if (b.kind === 'row') parts.push([b.tag?.text, b.text, b.right].filter(Boolean).join(' '));
    else if (b.kind === 'text') parts.push(b.text);
    else parts.push(b.chips.map(c => c.text).join(', '));
  }
  return parts.filter(Boolean).join(' · ');
}
