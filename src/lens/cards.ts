// The lens panel as cards: one per section, each a header and a list of blocks. Built once from the PanelModel;
// term.tsx draws them with cells, svg.ts as SVG.
import type { PanelModel } from './model.js';
import type { Block, Card } from './svg.js';
import {
  SECTION_HUE, SECTION_ICON, PATH_HUE, tierOf, stagesFor, forgePhase, roadmapCells, briefCells, todoCells, superpowersCells,
  ratio, duration, fmtTokens, fmtUsd, type Hue,
} from './view.js';
import { shortModelName } from '../lib/prices.js';

export interface CardTexts {
  sRoadmap: string; sSuperpowers: string; sNow: string; sTodos: string; sSubagents: string; sTasks: string; sForge: string;
  sSwarm: string; swarmWaiting: string; swarmReady: string; waitsFor: (task: string, track: string) => string;
  track: string; phase: string; noTask: string; decision: string; fixRound: string; done: string; open: string;
  tool: string; turn: string; briefs: string; cycle: string; hoursLeft: (h: number) => string; auto: string; task: string;
  sUsage: string; effort: string; effortLevel: (e: string) => string; thisSession: string; run: string; gMain: string; gImpl: string;
  gReview: string; gPlan: string; gOther: string; tracking: string; withoutForge: string; withoutForgeNote: string;
  forgeCosts: (usd: string, pct: number) => string; forgeSaves: (usd: string) => string; pricesAsOf: string; drift: string; various: string;
  noReview: string; gVerify: string; blocked: string;
}

const modelRight = (s: { model?: string; effort?: string }, t: CardTexts): string | undefined =>
  s.model ? `${shortModelName(s.model)}${s.effort ? ` · ${t.effortLevel(s.effort)}` : ''}` : undefined;

const VERDICT_HUE: Record<string, Hue> = { accept: 'green', fix: 'yellow', redo: 'red' };

// Order: Now first (one glance: is it alive, on what model), then the work, then Usage as the footer.
export function buildCards(m: PanelModel, t: CardTexts, nowMs: number): Card[] {
  const out: Card[] = [];
  let usageCard: Card | null = null;

  if (m.mainModel || m.tool || m.turnSeconds !== null) {
    const blocks: Block[] = [];
    if (m.mainModel) blocks.push({ kind: 'row', dot: 'lavender', text: `${shortModelName(m.mainModel.model)}${m.mainModel.effort ? ` · ${t.effort} ${t.effortLevel(m.mainModel.effort)}` : ''}` });
    if (m.tool) blocks.push({ kind: 'row', dot: 'sky', spinning: true, tag: { text: t.tool, hue: 'sky' }, text: m.tool.name, right: duration(m.tool.seconds) ?? undefined });
    if (m.turnSeconds !== null) blocks.push({ kind: 'row', dot: 'sub' as Hue, text: t.turn, right: duration(m.turnSeconds) ?? undefined });
    out.push({ icon: SECTION_ICON.now, title: t.sNow, hue: SECTION_HUE.now, blocks });
  }

  if (m.waypoint) {
    const w = m.waypoint;
    const cells = roadmapCells(w);
    const blocks: Block[] = [{
      kind: 'bar', ratio: w.percent / 100, hue: SECTION_HUE.roadmap, moving: !!w.current,
      label: w.track ? `${t.track} ${w.track}` : undefined, right: `${w.trackDone}/${w.trackTotal}`,
    }];
    if (cells.total) blocks.push({ kind: 'cells', cells: cells.cells });
    if (w.current) {
      const started = w.current.startedAt ? Date.parse(w.current.startedAt) : NaN;
      const min = Number.isFinite(started) && nowMs >= started ? Math.floor((nowMs - started) / 60000) : null;
      const right = min !== null ? `${min}${w.current.estimateMin ? `/${w.current.estimateMin}` : ''} min` : undefined;
      blocks.push({ kind: 'row', dot: 'peach', spinning: true, tag: { text: w.current.id, hue: 'peach' }, text: w.current.title, right });
    } else {
      blocks.push({ kind: 'text', text: t.noTask, dim: true });
    }
    const chips: { text: string; hue: Hue }[] = [];
    if (w.inbox > 0) chips.push({ text: `✉ ${w.inbox}`, hue: 'blue' });
    if (w.escalation) chips.push({ text: `⚠ ${t.decision}`, hue: 'red' });
    if (chips.length) blocks.push({ kind: 'chips', chips });
    out.push({
      icon: SECTION_ICON.roadmap, title: w.project, hue: SECTION_HUE.roadmap, chip: { text: `${w.percent}%`, hue: SECTION_HUE.roadmap },
      subtitle: w.phase ? `${t.phase} ${w.phase.index}/${w.phase.total} · ${w.phase.name}` : undefined, blocks,
    });
  }

  if (m.forge || m.infinite?.active) {
    const blocks: Block[] = [];
    const f = m.forge;
    if (f) {
      blocks.push({ kind: 'stages', stages: stagesFor(f.path, forgePhase(f), f.validators.length ? (f.validators.every(v => v.ok) ? 'ok' : 'failed') : null, f.verify?.planned === true), hue: SECTION_HUE.forge });
      if (f.verify?.planned) {
        const v = f.verify;
        const where = `verify ${v.surfaces.join(', ')}`;
        const text = v.result === 'pass' ? `✓ ${where} · ${v.passed}/${v.total}`
          : v.result === 'fail' ? `✗ ${where} · ${v.passed}/${v.total}`
          : v.result === 'blocked' ? `⊘ ${where} · ${t.blocked}: ${v.reason ?? ''}`
          : where;
        blocks.push({ kind: 'text', text, dim: v.result === null });
        if (v.evidence) blocks.push({ kind: 'text', text: v.evidence, dim: true });
      }
      const c = briefCells(f);
      if (c) {
        blocks.push({ kind: 'bar', ratio: ratio(c.done, c.total), hue: SECTION_HUE.forge, moving: c.done < c.total, label: t.briefs, right: `${c.done}/${c.total}` });
        blocks.push({ kind: 'cells', cells: c.cells });
      }
      if (f.agent) {
        const tier = tierOf(f.agent);
        const live = m.subagents.find(s => tierOf(s.type).label === tier.label);
        blocks.push({ kind: 'row', dot: tier.hue, spinning: !!live, tag: { text: tier.label, hue: tier.hue }, text: live?.description ?? f.agent, right: [live && modelRight(live, t), duration(live?.seconds)].filter(Boolean).join('  ') || undefined });
      }
      const chips: { text: string; hue: Hue }[] = f.validators.map(v => ({ text: `${v.ok ? '✓' : '✗'} ${v.name}`, hue: v.ok ? 'green' : 'red' }));
      if (f.verdict) chips.push({ text: [f.verdict.action, f.verdict.score !== null && f.verdict.score.toFixed(2)].filter(Boolean).join(' '), hue: VERDICT_HUE[f.verdict.action] ?? 'lavender' });
      if (f.round !== null) chips.push({ text: `${t.fixRound} ${f.round}${f.cap !== null ? `/${f.cap}` : ''}`, hue: f.cap !== null && f.round >= f.cap ? 'red' : 'sub' as Hue });
      if (chips.length) blocks.push({ kind: 'chips', chips });
    }
    const inf = m.infinite;
    if (inf?.active) {
      const right = [inf.cyclesMax !== null ? `${inf.cycle}/${inf.cyclesMax}` : `${inf.cycle}`, inf.hoursLeft !== null && t.hoursLeft(inf.hoursLeft)].filter(Boolean).join(' · ');
      blocks.push({ kind: 'bar', ratio: inf.cyclesMax ? ratio(inf.cycle - 1, inf.cyclesMax) : 0, hue: 'mauve', moving: true, label: `∞ ${t.cycle}`, right });
      for (const title of inf.autoApproved) blocks.push({ kind: 'row', dot: 'green', tag: { text: t.auto, hue: 'green' }, text: title });
    }
    out.push({
      icon: SECTION_ICON.forge, title: f?.task ?? 'forge', hue: SECTION_HUE.forge,
      chip: f?.path ? { text: f.path, hue: PATH_HUE[f.path] ?? 'peach' } : inf?.active ? { text: '∞', hue: 'mauve' } : undefined,
      subtitle: f && forgePhase(f) ? `${t.sForge} · ${forgePhase(f)}` : undefined, blocks,
    });
  }

  if (m.swarm) {
    const sw = m.swarm;
    const DOT: Record<string, Hue> = { running: 'peach', queued: 's2', waiting: 'yellow', blocked: 'yellow', ready: 'teal', integrated: 'green', conflict: 'red', 'launch-failed': 'red' };
    const MARK: Record<string, string> = { running: '●', queued: '·', waiting: '⧗', blocked: '⧗', ready: '⇡', integrated: '✓', conflict: '⚠', 'launch-failed': '⚠' };
    const blocks: Block[] = [{
      kind: 'bar', ratio: ratio(sw.live, sw.parallel), hue: 'teal', moving: sw.active && sw.live > 0, label: `⑂ ${t.sSwarm}`,
      right: [`${sw.live}/${sw.parallel}`, sw.waiting && `${sw.waiting} ${t.swarmWaiting}`, sw.ready && `${sw.ready} ${t.swarmReady}`, sw.conflict && `⚠ ${sw.conflict}`].filter(Boolean).join(' · '),
    }];
    if (sw.stalled) blocks.push({ kind: 'text', text: sw.stalled, dim: false });
    for (const f of sw.fronts) {
      blocks.push({
        kind: 'row', dot: DOT[f.status] ?? 's2', spinning: f.status === 'running', tag: { text: `${MARK[f.status] ?? '·'} ${f.track}`, hue: DOT[f.status] ?? 's2' },
        text: f.task ?? (f.waitTask ? t.waitsFor(f.waitTask, f.waitTrack ?? '') : f.note) ?? '', right: `${f.done}/${f.total}`,
      });
    }
    out.push({ icon: SECTION_ICON.forge, title: t.sSwarm, hue: 'teal', chip: { text: `${sw.live}/${sw.parallel}`, hue: 'teal' }, blocks });
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
    if (u.session) blocks.push({ kind: 'text', text: `${t.thisSession}: ${fmtTokens(u.session.tokens, loc)} tok · ${u.sessionPartial ? '≥ ' : ''}${fmtUsd(u.session.costUsd, loc)}`, dim: true });
    if (u.officialUsd !== null) blocks.push({ kind: 'text', text: `${u.drift ? '⚠ ' : ''}/cost ${fmtUsd(u.officialUsd, loc)}${u.drift ? ` · ${t.drift}` : ''}`, dim: !u.drift });
    for (const g of u.groups) {
      blocks.push({ kind: 'row', dot: 'teal', tag: { text: label[g.id], hue: 'teal' }, text: name(g), right: `${fmtTokens(g.tokens, loc)} · ${usd(g.costUsd)} · ${Math.round(g.share * 100)} %` });
    }
    if (u.tracking) blocks.push({ kind: 'row', dot: 's2', tag: { text: `${t.tracking} ≈`, hue: 's2' }, text: 'waypoint+forge', right: `~${fmtTokens(u.tracking.tokens, loc)} · ${usd(u.tracking.costUsd)}` });
    if (u.withoutForge) {
      const w = u.withoutForge;
      // Against a partial total the delta would mislead: only the estimate is shown.
      const diff = u.partial ? t.noReview
        : w.deltaUsd >= 0 ? t.forgeCosts(fmtUsd(w.deltaUsd, loc), w.deltaPct) : t.forgeSaves(fmtUsd(-w.deltaUsd, loc));
      blocks.push({ kind: 'text', text: `${t.withoutForge}: ~${fmtUsd(w.costUsd, loc)} · ${diff}` });
      blocks.push({ kind: 'text', text: t.withoutForgeNote, dim: true });
    }
    blocks.push({ kind: 'text', text: `${t.pricesAsOf} ${u.pricesAsOf}`, dim: true });
    usageCard = { icon: '$', title: t.sUsage, hue: 'teal', chip: { text: `${u.partial ? '≥ ' : ''}${fmtUsd(u.costUsd, loc)}`, hue: 'teal' }, blocks };
  }

  if (m.superpowers) {
    const s = m.superpowers;
    const c = superpowersCells(s);
    const n = s.current ? s.current.task : String(s.done < s.tasks ? s.done + 1 : s.done);
    const blocks: Block[] = [
      { kind: 'bar', ratio: ratio(c.done, c.total), hue: SECTION_HUE.superpowers, moving: s.done < s.tasks, label: `${t.task} ${n}/${s.tasks}`, right: `${s.done} ${t.done}` },
      { kind: 'cells', cells: c.cells },
    ];
    if (s.current) blocks.push({ kind: 'chips', chips: [{ text: `${t.fixRound} ${s.current.round}/5`, hue: 'yellow' }] });
    for (const line of s.lastLines) blocks.push({ kind: 'text', text: line, dim: true });
    out.push({ icon: SECTION_ICON.superpowers, title: s.plan || t.sSuperpowers, hue: SECTION_HUE.superpowers, chip: { text: `${Math.round(ratio(s.done, s.tasks) * 100)}%`, hue: SECTION_HUE.superpowers }, blocks });
  }

  if (m.todos) {
    const td = m.todos;
    const c = todoCells(td);
    const blocks: Block[] = [{ kind: 'bar', ratio: ratio(td.done, td.total), hue: SECTION_HUE.todos, moving: !!td.inProgress }, { kind: 'cells', cells: c.cells }];
    if (td.inProgress) blocks.push({ kind: 'row', dot: 'peach', spinning: true, text: td.inProgress });
    for (const next of td.next) blocks.push({ kind: 'row', dot: 's2', text: next });
    out.push({ icon: SECTION_ICON.todos, title: t.sTodos, hue: SECTION_HUE.todos, chip: { text: `${td.done}/${td.total}`, hue: SECTION_HUE.todos }, blocks });
  }

  if (m.subagents.length) {
    const blocks: Block[] = m.subagents.slice(-10).map(s => {
      const tier = tierOf(s.type);
      return { kind: 'row', dot: tier.hue, spinning: s.status !== 'waiting', tag: { text: tier.label, hue: tier.hue }, text: s.description || s.type || '?', right: [modelRight(s, t), duration(s.seconds)].filter(Boolean).join('  ') || undefined };
    });
    out.push({ icon: SECTION_ICON.agents, title: t.sSubagents, hue: SECTION_HUE.agents, chip: { text: String(m.subagents.length), hue: SECTION_HUE.agents }, blocks });
  }

  if (m.ccTasks) {
    const cc = m.ccTasks;
    const blocks: Block[] = [
      { kind: 'bar', ratio: ratio(cc.done, cc.done + cc.open), hue: SECTION_HUE.tasks, label: `${cc.open} ${t.open}`, right: `${cc.done} ${t.done}` },
      ...cc.recent.map(r => ({ kind: 'row', dot: 'teal', text: r }) as Block),
    ];
    out.push({ icon: SECTION_ICON.tasks, title: t.sTasks, hue: SECTION_HUE.tasks, blocks });
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
