import { describe, it, expect } from 'vitest';
import { fmtTokens, fmtUsd, usageBandText, barParts, briefCells, forgePhase, headline, stagesFor, tierOf, todoCells, roadmapCells, pct } from '../src/lens/view.js';
import { buildCards, cardAlt, type CardTexts } from '../src/lens/cards.js';
import { bandSvg, cardSvg, fit, xml } from '../src/lens/svg.js';
import type { PanelModel } from '../src/lens/model.js';

const T: CardTexts = {
  sRoadmap: 'Roadmap', sSuperpowers: 'superpowers', sNow: 'Now', sTodos: 'Todos', sSubagents: 'Subagents', sTasks: 'Tasks', sForge: 'forge',
  sSwarm: 'swarm', swarmWaiting: 'waiting', swarmReady: 'ready', waitsFor: (task, track) => `waits for ${task} (${track})`,
  track: 'track', phase: 'Phase', noTask: 'no task', decision: 'decision', fixRound: 'round', done: 'done', open: 'open',
  tool: 'tool', turn: 'turn', briefs: 'briefs', cycle: 'cycle', hoursLeft: h => `${h}h left`, auto: 'auto', task: 'Task',
  sUsage: 'Usage', effort: 'effort', effortLevel: e => e, thisSession: 'this session', run: 'run', gMain: 'main', gImpl: 'implementers',
  gReview: 'reviewers', gPlan: 'planning', gOther: 'other', tracking: 'tracking', withoutForge: 'without forge', various: 'various',
  withoutForgeNote: 'estimate: forge off, everything on the main model', forgeCosts: (usd, pct) => `forge costs ${usd} more (+${pct} %)`,
  forgeSaves: usd => `forge saves ${usd}`, pricesAsOf: 'prices as of', drift: 'differs from /cost',
  noReview: 'no independent review', gVerify: 'verification', blocked: 'blocked',
};
const FORGE: NonNullable<PanelModel['forge']> = {
  task: 'orders', path: 'large', phase: 'implement', agent: 'forge-impl-heavy', validators: [{ name: 'test', ok: true }],
  verdict: { action: 'accept', score: 0.96 }, round: 0, cap: 3, brief: 3, accepted: [1, 2], briefs: 5,
};
const EMPTY: PanelModel = {
  locale: 'en', waypoint: null, superpowers: null, todos: null, subagents: [], tool: null, turnSeconds: null, ccTasks: null,
  forge: null, infinite: null, swarm: null, proposals: [], mainModel: null, usage: null,
};

describe('lens view', () => {
  it('colours agents by level, the implementer ladder from cool to warm', () => {
    expect(tierOf('forge:forge-mech')).toMatchObject({ label: 'mech', rank: 1 });
    expect(tierOf('forge-impl-heavy')).toMatchObject({ label: 'heavy', hue: 'mauve', rank: 4 });
    expect(tierOf('forge:forge-review-security')).toMatchObject({ label: 'security', hue: 'red' });
    expect(tierOf('Explore')).toMatchObject({ label: 'Explore', hue: 'lavender' });
    expect(tierOf(null).label).toBe('?');
  });
  it('lays out forge stages by path and marks the current one', () => {
    expect(stagesFor('medium', 'review').map(s => `${s.name}:${s.state}`)).toEqual([
      'triage:done', 'implement:done', 'validate:done', 'review:active', 'verdict:pending',
    ]);
    expect(stagesFor('large', 'design').map(s => s.name)).toContain('final');
    expect(stagesFor('small', 'something-else')[0].state).toBe('done');
  });
  it('gives Trivial and Small no review stages, and counts validators that ran as validation done', () => {
    expect(stagesFor('small', '').map(s => `${s.name}:${s.state}`)).toEqual(['triage:done', 'implement:pending', 'validate:pending']);
    expect(stagesFor('trivial', '', 'ok').map(s => s.state)).toEqual(['done', 'done', 'done']);
    expect(stagesFor('small', '', 'failed').map(s => `${s.name}:${s.state}`)).toEqual(['triage:done', 'implement:done', 'validate:active']);
    expect(stagesFor('medium', 'review', 'ok').map(s => s.state)).toEqual(['done', 'done', 'done', 'active', 'pending']);
    // A finished run has every stage of its path done, whatever the path.
    expect(stagesFor('medium', 'done', 'ok').map(s => s.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(stagesFor('large', 'done').every(s => s.state === 'done')).toBe(true);
  });
  it('reads a run whose every brief is accepted as done, even when the done phase was never logged', () => {
    const f = { ...FORGE, phase: 'review', verdict: { action: 'accept', score: 0.98 }, brief: 1, briefs: 1, accepted: [1] };
    expect(forgePhase(f)).toBe('done');
    expect(forgePhase({ ...f, briefs: 2 })).toBe('review');
    expect(forgePhase({ ...f, verdict: { action: 'resume', score: 0.5 } })).toBe('review');
    expect(forgePhase({ ...f, accepted: [] })).toBe('review');
    const card = buildCards({ ...EMPTY, forge: f }, T, 0).find(c => c.title === f.task)!;
    expect(card.subtitle).toBe('forge · done');
  });
  it('turns briefs, todos and roadmap letters into cells', () => {
    expect(briefCells(FORGE)!.cells).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    expect(briefCells({ ...FORGE, verdict: { action: 'fix', score: 0.3 }, round: 1, accepted: [1, 2] })!.cells[2]).toBe('failed');
    expect(briefCells({ ...FORGE, brief: null, accepted: [], briefs: null })).toBeNull();
    expect(todoCells({ total: 3, done: 1, inProgress: 'x', next: [] }).cells).toEqual(['done', 'active', 'pending']);
    expect(roadmapCells({ cells: 'ddabpz' } as NonNullable<PanelModel['waypoint']>).cells).toEqual(['done', 'done', 'active', 'blocked', 'pending', 'pending']);
  });
  it('draws text bars of the asked width', () => {
    for (const r of [0, 0.13, 0.5, 0.99, 1]) {
      const { fill, rest } = barParts(r, 20);
      expect([...fill].length + [...rest].length).toBe(20);
    }
    expect(barParts(1, 10).fill).toBe('█'.repeat(10));
    expect(pct(1, 3)).toBe('33%');
  });
  it('prefers an active swarm in the headline', () => {
    const m = { ...EMPTY, forge: FORGE, swarm: { active: true, live: 2, parallel: 5, stalled: null, waiting: 1, ready: 0, conflict: 0, fronts: [] } };
    expect(headline(m)).toMatchObject({ section: 'forge', title: '⑂ 2/5' });
  });
  it('words the swarm waiting note with the locale text, and keeps details as they are', () => {
    const fronts = [
      { track: 'b', status: 'waiting', task: null, done: 0, total: 2, waitTask: 'A1', waitTrack: 'a', note: null },
      { track: 'c', status: 'conflict', task: null, done: 1, total: 1, waitTask: null, waitTrack: null, note: 'merge conflict' },
    ];
    const es = { ...T, waitsFor: (task: string, track: string) => `espera a ${task} (${track})` };
    const [card] = buildCards({ ...EMPTY, swarm: { active: true, live: 0, parallel: 2, stalled: null, waiting: 1, ready: 0, conflict: 1, fronts } }, es, 0);
    const rows = card.blocks.filter(b => b.kind === 'row').map(b => (b.kind === 'row' ? b.text : ''));
    expect(rows).toEqual(['espera a A1 (a)', 'merge conflict']);
  });
  it('the band headline prefers forge, then the roadmap, then todos', () => {
    expect(headline(EMPTY)).toBeNull();
    expect(headline({ ...EMPTY, forge: FORGE })).toMatchObject({ section: 'forge', title: 'orders', detail: 'large · implement' });
    expect(headline({ ...EMPTY, todos: { total: 2, done: 1, inProgress: 'Doing', next: [] } })).toMatchObject({ section: 'todos', title: 'Doing' });
  });
});

describe('lens cards', () => {
  it('builds a forge card with stages, brief cells, the agent and the chips', () => {
    const [card] = buildCards({ ...EMPTY, forge: FORGE }, T, 0);
    expect(card).toMatchObject({ title: 'orders', chip: { text: 'large', hue: 'red' } });
    expect(card.blocks.map(b => b.kind)).toEqual(['stages', 'bar', 'cells', 'row', 'chips']);
    const alt = cardAlt(card);
    expect(alt).toContain('[implement]');
    expect(alt).toContain('briefs 2/5');
    expect(alt).toContain('heavy forge-impl-heavy');
    expect(alt).toContain('accept 0.96');
  });
  it('builds nothing from an empty model', () => {
    expect(buildCards(EMPTY, T, 0)).toEqual([]);
  });
});

describe('lens svg', () => {
  it('escapes text and fits long titles', () => {
    expect(xml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(fit('x'.repeat(200), 12, 100).endsWith('…')).toBe(true);
    expect(fit('short', 12, 100)).toBe('short');
  });
  it('draws a card as one SVG document with no NaN and the reduced-motion rule', () => {
    const [card] = buildCards({ ...EMPTY, forge: { ...FORGE, task: '<script>x</script>' } }, T, 0);
    const { source, height } = cardSvg(card, 420);
    expect(source.startsWith('<svg')).toBe(true);
    expect(source).not.toContain('NaN');
    expect(source).not.toContain('<script>');
    expect(source).toContain('prefers-reduced-motion');
    expect(source).toContain('prefers-color-scheme: light');
    expect(height).toBeGreaterThan(80);
  });
  it('draws the band row', () => {
    const { source, height } = bandSvg({ W: 600, icon: '⚒', title: 'orders', detail: 'large · implement', hue: 'peach', ratio: 0.4, label: '2/5', moving: true, cells: ['done', 'done', 'active', 'pending', 'pending'] });
    expect(height).toBe(30);
    expect(source).toContain('class="sheen"');
    expect(source).toContain('class="breathe"');
    expect(source).not.toContain('NaN');
  });
});

describe('usage formats and card', () => {
  it('formats tokens and dollars per locale', () => {
    expect(fmtTokens(1_840_000, 'es')).toBe('1,84 M');
    expect(fmtTokens(1_840_000, 'en')).toBe('1.84 M');
    expect(fmtTokens(9_400, 'es')).toBe('9 k');
    expect(fmtTokens(512, 'en')).toBe('512');
    expect(fmtUsd(6.2, 'es')).toBe('6,20 $');
    expect(fmtUsd(12.34, 'en')).toBe('$12.3');
  });
  it('draws the Usage card with groups, tracking, the estimate and the prices date', () => {
    const usage = {
      scope: 'session' as const, tokens: 1_840_000, costUsd: 6.2, partial: false, sessionPartial: false, officialUsd: 6.18, drift: false, session: null,
      groups: [
        { id: 'main' as const, model: 'claude-opus-5-5', tokens: 920_000, costUsd: 3.9, share: 0.63 },
        { id: 'impl' as const, model: 'claude-sonnet-5-5', tokens: 610_000, costUsd: 1.1, share: 0.18 },
      ],
      tracking: { tokens: 9_000, costUsd: 0.04 },
      withoutForge: { costUsd: 4.7, deltaUsd: 1.5, deltaPct: 32 },
      pricesAsOf: '2026-10-12',
    };
    const cards = buildCards({ ...EMPTY, usage }, T, 0);
    const card = cards.find(c => c.title === T.sUsage)!;
    const text = JSON.stringify(card.blocks);
    expect(text).toContain('Opus 5.5');
    expect(text).toContain('Sonnet 5.5');
    expect(text).toContain('≈');
    expect(text).toContain('~');
    expect(text).toContain('2026-10-12');
    expect(text).toContain('6.18');
  });
  it('calls subagents just «Subagents» when no forge group is there, «other» only next to forge ones', () => {
    const g = (id: 'main' | 'impl' | 'other') => ({ id, model: 'claude-opus-5-5', tokens: 10, costUsd: 0.1, share: 0.5 });
    const base = { scope: 'session' as const, tokens: 20, costUsd: 0.2, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null, tracking: null, withoutForge: null, pricesAsOf: '2026-10-12' };
    const tags = (groups: ReturnType<typeof g>[]) =>
      buildCards({ ...EMPTY, usage: { ...base, groups } }, T, 0).find(c => c.title === T.sUsage)!.blocks.flatMap(b => ('tag' in b && b.tag ? [b.tag.text] : []));
    expect(tags([g('main'), g('other')])).toEqual(['main', 'Subagents']);
    expect(tags([g('main'), g('impl'), g('other')])).toEqual(['main', 'implementers', 'other']);
  });
  it('adds the effort to a Usage row, «various» when the group mixes levels', () => {
    const base = { scope: 'session' as const, tokens: 20, costUsd: 0.2, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null, tracking: null, withoutForge: null, pricesAsOf: '2026-10-12' };
    const groups = [
      { id: 'main' as const, model: 'claude-opus-5-5', effort: 'medium', tokens: 10, costUsd: 0.1, share: 0.5 },
      { id: 'other' as const, model: 'claude-opus-5-5', effort: 'varios', tokens: 10, costUsd: 0.1, share: 0.5 },
    ];
    const rows = buildCards({ ...EMPTY, usage: { ...base, groups } }, T, 0).find(c => c.title === T.sUsage)!.blocks.flatMap(b => (b.kind === 'row' ? [b.text] : []));
    expect(rows).toEqual(['Opus 5.5 · medium', 'Opus 5.5 · various']);
  });
  it('shows «≥» on a partial total and the drift warning', () => {
    const usage = { scope: 'session' as const, tokens: 10, costUsd: 1, partial: true, sessionPartial: true, officialUsd: 2, drift: true, session: null, groups: [], tracking: null, withoutForge: null, pricesAsOf: '2026-10-12' };
    const text = JSON.stringify(buildCards({ ...EMPTY, usage }, T, 0).find(c => c.title === T.sUsage)!.blocks);
    expect(text).toContain('≥');
    expect(text).toContain('⚠');
  });
  it('puts the main model line in the Now card and model/effort on subagent rows', () => {
    const m = { ...EMPTY, mainModel: { model: 'claude-opus-5-5', effort: 'high' }, turnSeconds: 3,
      subagents: [{ id: 'a1', type: 'forge:forge-impl', description: 'T1', seconds: 5, model: 'claude-sonnet-5-5', effort: 'medium' }] };
    const text = JSON.stringify(buildCards(m, T, 0));
    expect(text).toContain('Opus 5.5 · effort high');
    expect(text).toContain('Sonnet 5.5 · medium');
  });
  it('gives the band its session usage suffix', () => {
    expect(usageBandText({ ...EMPTY, usage: null })).toBeNull();
    const usage = { scope: 'session' as const, tokens: 1_840_000, costUsd: 6.2, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null, groups: [], tracking: null, withoutForge: null, pricesAsOf: '2026-10-12' };
    expect(usageBandText({ ...EMPTY, locale: 'es', usage })).toBe('1,84 M tok · 6,20 $');
  });
});

describe('usage partial marks and edges', () => {
  const U = { scope: 'session' as const, tokens: 10, costUsd: 1, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null, groups: [], tracking: null, withoutForge: null, pricesAsOf: '2026-10-12' };
  it('puts «≥» on the chip of a partial total', () => {
    const card = buildCards({ ...EMPTY, usage: { ...U, partial: true } }, T, 0).find(c => c.title === T.sUsage)!;
    expect(card.chip!.text).toBe('≥ $1.00');
  });
  it('puts «≥» on the band and the session line when the session is partial', () => {
    expect(usageBandText({ ...EMPTY, usage: { ...U, sessionPartial: true } })).toBe('10 tok · ≥ $1.00');
    const run = { ...U, scope: 'run' as const, tokens: 50, costUsd: 5, session: { tokens: 10, costUsd: 1 }, sessionPartial: true };
    expect(usageBandText({ ...EMPTY, usage: run })).toBe('10 tok · ≥ $1.00');
    const text = JSON.stringify(buildCards({ ...EMPTY, usage: run }, T, 0).find(c => c.title === T.sUsage)!.blocks);
    expect(text).toContain('this session: 10 tok · ≥ $1.00');
    expect(usageBandText({ ...EMPTY, usage: { ...run, sessionPartial: false } })).toBe('10 tok · $1.00');
  });
  it('rounds before choosing the unit and the decimals', () => {
    expect(fmtTokens(999_500, 'en')).toBe('1.00 M');
    expect(fmtTokens(999_499, 'en')).toBe('999 k');
    expect(fmtUsd(9.996, 'en')).toBe('$10.0');
  });
  it('prefixes the forge agent row with the live agent model, and words a saving', () => {
    const m = { ...EMPTY, forge: FORGE, subagents: [{ id: 'a1', type: 'forge:forge-impl-heavy', seconds: 5, model: 'claude-sonnet-5-5', effort: 'medium' }] };
    const forge = buildCards(m, T, 0).find(c => c.title === 'orders')!;
    expect(JSON.stringify(forge.blocks)).toContain('Sonnet 5.5 · medium');
    const usage = { ...U, withoutForge: { costUsd: 5, deltaUsd: -1.5, deltaPct: -23 } };
    const text = JSON.stringify(buildCards({ ...EMPTY, usage }, T, 0).find(c => c.title === T.sUsage)!.blocks);
    expect(text).toContain('forge saves $1.50');
  });
  it('omits the without-forge delta when the shown total is partial', () => {
    const w = { costUsd: 5, deltaUsd: 1.5, deltaPct: 30 };
    const text = JSON.stringify(buildCards({ ...EMPTY, usage: { ...U, partial: true, withoutForge: w } }, T, 0).find(c => c.title === T.sUsage)!.blocks);
    expect(text).toContain('without forge: ~$5.00 · no independent review');
    expect(text).not.toContain('forge costs');
    const full = JSON.stringify(buildCards({ ...EMPTY, usage: { ...U, withoutForge: w } }, T, 0).find(c => c.title === T.sUsage)!.blocks);
    expect(full).toContain('forge costs $1.50 more (+30 %)');
  });
  it('adds a verify stage when verification is planned', () => {
    expect(stagesFor('medium', 'review', null, true).map(s => s.name)).toEqual(['triage', 'implement', 'validate', 'verify', 'review', 'verdict']);
    expect(stagesFor('medium', 'review').map(s => s.name)).not.toContain('verify');
    expect(stagesFor('small', '', 'ok', true).map(s => s.name)).toEqual(['triage', 'implement', 'validate', 'verify']);
  });
  it('forge-verify has its own tier', () => {
    expect(tierOf('forge:forge-verify')).toMatchObject({ label: 'verify', hue: 'sapphire' });
    expect(tierOf('forge-verify-heavy')).toMatchObject({ label: 'verify', hue: 'sapphire' });
  });
  it('the forge card shows the verify result row', () => {
    const v = (verify: NonNullable<PanelModel['forge']>['verify']) =>
      JSON.stringify(buildCards({ ...EMPTY, forge: { ...FORGE, verify } }, T, 0).find(c => c.title === FORGE.task)!.blocks);
    expect(v({ planned: true, surfaces: ['web'], result: 'pass', passed: 6, total: 6, evidence: '.forge/work/x/evidence/1-1', reason: null })).toContain('"✓ verify web · 6/6"');
    expect(v({ planned: true, surfaces: ['web'], result: 'fail', passed: 4, total: 6, evidence: null, reason: null })).toContain('✗ verify web · 4/6');
    expect(v({ planned: true, surfaces: ['app'], result: 'blocked', passed: 0, total: 0, evidence: null, reason: 'no emulator' })).toContain('⊘ verify app · blocked: no emulator');
    expect(v({ planned: true, surfaces: ['web'], result: null, passed: null, total: null, evidence: null, reason: null })).toContain('verify web');
    expect(v(null)).not.toContain('verify');
  });
});
