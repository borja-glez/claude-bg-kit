// Usage grouped for the panel: main session, implementers, reviewers, planning and scout, other subagents, with the
// main session's tracking estimate split off, and what the same work would cost without forge (an estimate).
import { priceFor, tokensCost } from '../lib/prices.js';
import type { UsageLoop, UsageState } from './usage.js';

export type GroupId = 'main' | 'impl' | 'review' | 'verify' | 'plan' | 'other';
export interface UsageSummary {
  tokens: number; costUsd: number; partial: boolean;
  groups: { id: GroupId; model: string | null; effort: string | null; tokens: number; costUsd: number | null; share: number }[];
  tracking: { tokens: number; costUsd: number | null } | null;
  // E-08: costUsd assumes the tracking was never re-read; lowUsd also takes off what re-reading it as context cost.
  withoutForge: { costUsd: number; lowUsd: number; deltaUsd: number; deltaPct: number } | null;
}
const ORDER: GroupId[] = ['main', 'impl', 'review', 'verify', 'plan', 'other'];

export function groupOf(loopId: string, kind: string): GroupId {
  if (kind === 'main' || loopId === 'main' || loopId.endsWith('/main')) return 'main';
  if (/forge-(impl|mech|fable)/.test(kind)) return 'impl';
  if (/forge-verify/.test(kind)) return 'verify';
  if (/forge-review/.test(kind)) return 'review';
  if (/forge-(planner|scout)|design-critic/.test(kind)) return 'plan';
  return 'other';
}

const tokensOf = (l: UsageLoop) => l.input + l.output + l.cacheRead + l.cacheWrite;
const tok = (l: UsageLoop) => ({ input: l.input, output: l.output, cacheRead: l.cacheRead, cacheWrite: l.cacheWrite });

/** The model with the most tokens among the loops, or null when they have none. */
function dominant(loops: UsageLoop[]): string | null {
  const by = new Map<string, number>();
  for (const l of loops) if (l.model) by.set(l.model, (by.get(l.model) ?? 0) + tokensOf(l));
  let best: string | null = null;
  for (const [m, t] of by) if (best === null || t > by.get(best)!) best = m;
  return best;
}

export function summarizeUsage(s: UsageState): UsageSummary {
  const entries = Object.entries(s.loops);
  const byGroup = new Map<GroupId, UsageLoop[]>();
  for (const [id, l] of entries) {
    const g = groupOf(id, l.kind);
    const list = byGroup.get(g);
    if (list) list.push(l); else byGroup.set(g, [l]);
  }
  const mainModel = dominant(byGroup.get('main') ?? []);
  const trackTokens = s.tracking.waypoint + s.tracking.forge;
  const trackCost = trackTokens && mainModel ? tokensCost(mainModel, { input: trackTokens, output: 0, cacheRead: 0, cacheWrite: 0 }) : null;
  // E-08: the tracking gathered so far travels as cached context on each later step of the main loop.
  const reread = s.tracking.reread ?? 0;
  const rereadCost = reread && mainModel ? tokensCost(mainModel, { input: 0, output: 0, cacheRead: reread, cacheWrite: 0 }) : null;
  const partial = entries.some(([, l]) => l.unpriced > 0);
  const costOf = (loops: UsageLoop[]): number | null => {
    if (loops.length && loops.every(l => l.unpriced > 0 && l.costUsd === 0)) return null;
    return loops.reduce((a, l) => a + l.costUsd, 0);
  };
  const totalCost = entries.reduce((a, [, l]) => a + l.costUsd, 0);
  const totalTokens = entries.reduce((a, [, l]) => a + tokensOf(l), 0);
  const groups = ORDER.filter(id => byGroup.has(id)).map(id => {
    const loops = byGroup.get(id)!;
    let tokens = loops.reduce((a, l) => a + tokensOf(l), 0);
    let costUsd = costOf(loops);
    if (id === 'main' && (trackTokens || reread)) {
      tokens = Math.max(0, tokens - trackTokens - reread);
      if (costUsd !== null) costUsd = Math.max(0, costUsd - (trackCost ?? 0) - (rereadCost ?? 0));
    }
    const models = new Set(loops.map(l => l.model).filter(Boolean));
    // Only loops that ran a step say anything about effort; a loop without one would read as a second level.
    const efforts = new Set(loops.filter(l => l.steps > 0).map(l => l.effort));
    const effort = efforts.size > 1 ? 'varios' : efforts.values().next().value ?? null;
    return { id, model: models.size > 1 ? 'varios' : dominant(loops), effort, tokens, costUsd, share: 0 };
  });
  for (const g of groups) g.share = totalCost > 0 ? (g.costUsd ?? 0) / totalCost : totalTokens > 0 ? g.tokens / totalTokens : 0;
  const forgeLoops = ['impl', 'review', 'plan'].some(id => byGroup.has(id as GroupId));
  let withoutForge: UsageSummary['withoutForge'] = null;
  const mainCost = costOf(byGroup.get('main') ?? []);
  if (forgeLoops && mainModel && mainCost !== null && priceFor(mainModel) !== null) {
    const repriced = [...(byGroup.get('impl') ?? []), ...(byGroup.get('plan') ?? [])].reduce((a, l) => a + (tokensCost(mainModel, tok(l)) ?? 0), 0);
    const others = (byGroup.get('other') ?? []).reduce((a, l) => a + l.costUsd, 0);
    const without = Math.max(0, mainCost - (trackCost ?? 0) + repriced + others);
    const deltaUsd = totalCost - without;
    withoutForge = { costUsd: without, lowUsd: Math.max(0, without - (rereadCost ?? 0)), deltaUsd, deltaPct: without > 0 ? Math.round((deltaUsd / without) * 100) || 0 : 0 };
  }
  return {
    tokens: totalTokens, costUsd: totalCost, partial, groups,
    tracking: trackTokens || reread ? { tokens: trackTokens + reread, costUsd: trackCost === null && rereadCost === null ? null : (trackCost ?? 0) + (rereadCost ?? 0) } : null,
    withoutForge,
  };
}
