import { describe, it, expect } from 'vitest';
import { fmtTokens, fmtUsd, usageBandText, barParts, briefCells, forgePhase, headline, stagesFor, tierOf, todoCells, roadmapCells, pct, span, stageOf } from '../src/lens/view.js';
import { buildCards, cardAlt, type CardTexts } from '../src/lens/cards.js';
import { bandSvg, cardSvg, fit, xml } from '../src/lens/svg.js';
import { executionFromFiles, forgeFromStatus, type PanelModel } from '../src/lens/model.js';

const T: CardTexts = {
  sRoadmap: 'Roadmap', sSuperpowers: 'superpowers', sNow: 'Now', sTodos: 'Todos', sSubagents: 'Subagents', sTasks: 'Tasks', sForge: 'forge',
  sExecution: 'Execution', manualRow: 'manual', modeSubagents: 'subagents', modeSessions: 'sessions', alive: 'alive', silent: 'silent', stopped: 'stopped',
  queued: 'to integrate', orphans: 'orphaned', conflictsLbl: 'in conflict', blockedLbl: 'blocked', integratedN: 'integrated',
  stage: { brief: 'brief', implement: 'implement', validate: 'validate', verify: 'verify', review: 'review', verdict: 'verdict', integrate: 'integrate', execution: 'execution', triage: 'triage', design: 'design', plan: 'plan', final: 'final' },
  track: 'track', phase: 'Phase', noTask: 'no task', decision: 'decision', fixRound: 'round', done: 'done', open: 'open',
  tool: 'tool', turn: 'turn', briefs: 'briefs', cycle: 'cycle', hoursLeft: h => `${h}h left`, auto: 'auto', task: 'Task',
  sUsage: 'Usage', effort: 'effort', effortLevel: e => e, thisSession: 'this session', run: 'run', gMain: 'main', gImpl: 'implementers',
  gReview: 'reviewers', gPlan: 'planning', gOther: 'other', tracking: 'tracking', withoutForge: 'without forge', various: 'various',
  withoutForgeNote: 'estimate: forge off, everything on the main model', forgeCosts: (usd, pct) => `forge costs ${usd} more (+${pct} %)`,
  forgeSaves: usd => `forge saves ${usd}`, pricesAsOf: 'prices as of', drift: 'differs from /cost',
  taskTime: 'task', noReview: 'no independent review', gVerify: 'verification', blocked: 'blocked', active: 'active', sinceStart: 'since start',
  autoDecisions: n => `${n} automatic decision${n === 1 ? '' : 's'}`,
  autoMode: 'auto mode',
  staleLedger: 'unchanged for over a day',
};
const FORGE: NonNullable<PanelModel['forge']> = {
  task: 'orders', path: 'large', phase: 'implement', agent: 'forge-impl-heavy', validators: [{ name: 'test', ok: true }],
  verdict: { action: 'accept', score: 0.96 }, round: 0, cap: 3, brief: 3, accepted: [1, 2], briefs: 5,
};
const EMPTY: PanelModel = {
  locale: 'en', waypoint: null, superpowers: null, todos: null, subagents: [], tool: null, turnSeconds: null, ccTasks: null,
  forge: null, infinite: null, decisions: null, execution: null, proposals: [], mainModel: null, usage: null,
};
const EXEC: NonNullable<PanelModel['execution']> = {
  runId: 'r1', mode: 'subagents', parallel: 3, branch: 'forge/run-shop', active: true, stopReason: null, stallReason: null,
  coordinator: { liveness: 'silent', lastSeen: '2026-10-12T11:52:00.000Z' }, integrated: 3, total: 12,
  slots: [{ task: 'T004', title: 'Pisos', stage: 'review', agent: 'forge-review-correctness', model: null, effort: null, round: 2, seconds: 300, liveness: 'alive', mode: 'subagents' }],
  manual: [], queued: ['T003'], conflicts: [], blocked: [], orphans: [],
};

describe('lens view', () => {
  it('colours agents by level, the implementer ladder from cool to warm', () => {
    expect(tierOf('forge:forge-mech')).toMatchObject({ label: 'mech', rank: 1 });
    expect(tierOf('forge-impl')).toMatchObject({ label: 'impl', hue: 'blue', rank: 3 });
    expect(tierOf('forge:forge-impl-high')).toMatchObject({ label: 'high', hue: 'peach', rank: 4 });
    expect(tierOf('forge-impl-heavy')).toMatchObject({ label: 'heavy', hue: 'mauve', rank: 5 });
    expect(tierOf('forge-fable')).toMatchObject({ label: 'fable', rank: 6 });
    expect(tierOf('forge:forge-review-security')).toMatchObject({ label: 'security', hue: 'red' });
    expect(tierOf('Explore')).toMatchObject({ label: 'Explore', hue: 'lavender' });
    expect(tierOf(null).label).toBe('?');
  });
  it('impl-high has a hue of its own: no other agent nor the fallback for unknown agents uses it', () => {
    const others = ['forge-mech', 'forge-impl-light', 'forge-impl', 'forge-impl-heavy', 'forge-fable', 'forge-review-correctness', 'forge-review-security',
      'forge-review-perf', 'forge-verify', 'forge-verify-heavy', 'forge-planner', 'forge-scout', 'design-critic', 'Explore'];
    const high = tierOf('forge-impl-high').hue;
    for (const a of others) expect(tierOf(a).hue, a).not.toBe(high);
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
  it('execution card: header with mode, progress and the coordinator state; a row per running task', () => {
    const card = buildCards({ ...EMPTY, execution: EXEC }, T, 0).find(c => c.title === T.sExecution)!;
    const text = JSON.stringify(card);
    expect(text).toContain('1/3');
    expect(text).toContain('3 ' + T.integratedN);
    expect(text).toContain(T.silent);
    expect(text).toContain('T004');
    expect(text).toContain('r2');
    expect(text).toContain('5m');
    expect(text).toContain(`${T.queued}: T003`);
  });
  it('execution card: a plan title with control characters reaches the row cleaned', () => {
    const at = '2026-10-12T12:00:00.000Z';
    const text = JSON.stringify({ runId: 'r1', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', coordinator: 'main', startedAt: at, active: true,
      tasks: { T1: { status: 'running', stage: 'implement', executor: 'subagents', worktree: '', branch: 'task/T1', startedAt: at } } });
    const execution = executionFromFiles(text, {}, {}, Date.parse(at), { T1: 'Log\u001b[31min\nform' });
    const card = buildCards({ ...EMPTY, execution }, T, 0).find(c => c.title === T.sExecution)!;
    const rows = card.blocks.filter(b => b.kind === 'row') as { text: string }[];
    expect(rows.map(r => r.text)).toContain('Log[31minform');
    // eslint-disable-next-line no-control-regex
    expect(rows.every(r => !/[\u0000-\u001f\u007f-\u009f]/.test(r.text))).toBe(true);
    expect(JSON.stringify(rows)).toContain('form');
  });
  it('execution card: a row per manual task after the slots, with its stage, time and liveness', () => {
    const manual = [{ task: 'T9', title: 'Docs', stage: 'implement', seconds: 600, liveness: 'silent' as const, by: 'M1' }];
    const card = buildCards({ ...EMPTY, execution: { ...EXEC, manual } }, T, 0).find(c => c.title === T.sExecution)!;
    const row = card.blocks.filter(b => b.kind === 'row').at(-1) as { text: string; right?: string; dot: string };
    expect(row.text).toBe('manual · T9 Docs');
    expect(row.right).toBe('implement · 10m 00s');
    expect(row.dot).toBe('yellow');
  });
  it('the execution leads the lens band headline', () => {
    expect(headline({ ...EMPTY, execution: EXEC, forge: FORGE })).toMatchObject({ section: 'forge', title: '▶ 1/3', detail: 'T004 review' });
    expect(headline({ ...EMPTY, execution: { ...EXEC, active: false, stopReason: 'stalled' }, forge: FORGE })).toMatchObject({ title: 'orders' });
  });
  it('a large forge task during an execution draws the run stages', () => {
    const card = buildCards({ ...EMPTY, execution: EXEC, forge: { ...FORGE, path: 'large', phase: 'review' } }, T, 0).find(c => c.title === FORGE.task)!;
    const stages = card.blocks.find(b => b.kind === 'stages') as { stages: { name: string; state: string }[] };
    expect(stages.stages.map(s => `${s.name}:${s.state}`)).toEqual(['design:done', 'plan:done', 'execution:active', 'final:pending']);
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
  it('the forge card says when the task runs in auto mode', () => {
    const auto = buildCards({ ...EMPTY, forge: { ...FORGE, autonomy: 'auto' } }, T, 0).find(c => c.title === FORGE.task)!;
    expect(auto.subtitle).toMatch(/ · auto mode$/);
    expect(buildCards({ ...EMPTY, forge: FORGE }, T, 0).find(c => c.title === FORGE.task)!.subtitle ?? '').not.toContain('auto mode');
  });
  it('the forge card counts the automatic decisions and names the last major one, even with no forge task', () => {
    const [card] = buildCards({ ...EMPTY, decisions: { count: 3, autonomy: 'auto', lastMajor: 'design approved (v4)' } }, T, 0);
    expect(card.title).toBe('forge');
    const blocks = JSON.stringify(card.blocks);
    expect(blocks).toContain('3 automatic decisions');
    expect(blocks).toContain('design approved (v4)');
    const withTask = buildCards({ ...EMPTY, forge: FORGE, decisions: { count: 1, autonomy: 'unattended', lastMajor: null } }, T, 0).find(c => c.title === FORGE.task)!;
    expect(JSON.stringify(withTask.blocks)).toContain('1 automatic decision"');
  });
  it('draws the briefs bar for Medium and Large, or full once the task is done', () => {
    const kinds = (f: NonNullable<PanelModel['forge']>) => buildCards({ ...EMPTY, forge: f }, T, 0)[0].blocks.map(b => b.kind);
    const small = { ...FORGE, path: 'small', phase: '', agent: null, verdict: null, round: null, brief: null, accepted: [], briefs: 1 };
    expect(kinds(small)).not.toContain('bar');
    const done = { ...small, timing: { taskSeconds: 540, done: true, stages: [{ name: 'triage', seconds: 540, live: false }] } };
    const card = buildCards({ ...EMPTY, forge: done }, T, 0)[0];
    expect(cardAlt(card)).toContain('briefs 1/1');
    expect(card.blocks.find(b => b.kind === 'cells')).toMatchObject({ cells: ['done'] });
    expect(kinds({ ...FORGE, path: 'medium' })).toContain('bar');
    // A done Medium or Large keeps its accepted, failed and pending briefs.
    const mediumDone = buildCards({ ...EMPTY, forge: { ...FORGE, path: 'medium', timing: done.timing } }, T, 0)[0];
    expect(cardAlt(mediumDone)).toContain('briefs 2/5');
  });
  it('a done phase with a running clock (the task reopened) is not read as done', () => {
    const f = { ...FORGE, path: 'medium', phase: 'done', timing: { taskSeconds: 400, done: false, stages: [{ name: 'final', seconds: 200, live: true }] } };
    expect(forgePhase(f)).toBe('');
    const card = buildCards({ ...EMPTY, forge: f }, T, 0)[0];
    expect(card.blocks.some(b => b.kind === 'row')).toBe(true);
    expect((card.blocks.find(b => b.kind === 'stages') as { stages: { state: string }[] }).stages.every(s => s.state === 'done')).toBe(false);
    expect(forgePhase({ ...f, timing: { ...f.timing, done: true } })).toBe('done');
  });
  it('draws the agent row only while the task is not done', () => {
    const timing = (d: boolean) => ({ taskSeconds: 60, done: d, stages: [] });
    const kinds = (f: NonNullable<PanelModel['forge']>) => buildCards({ ...EMPTY, forge: f }, T, 0)[0].blocks.map(b => b.kind);
    expect(kinds({ ...FORGE, timing: timing(false) })).toContain('row');
    expect(kinds({ ...FORGE, timing: timing(true) })).not.toContain('row');
    expect(kinds({ ...FORGE, phase: 'done' })).not.toContain('row');
  });
  it('the B016 card: a small task left open for 40 minutes is drawn finished', () => {
    const f = forgeFromStatus(JSON.stringify({
      ts: '2026-10-12T11:11:00.000Z', task: 'fecha-corta', path: 'small', phase: '', agent: 'forge-verify', validators: [{ name: 'test', ok: true }],
      verdict: null, round: null, cap: null, brief: null, accepted: [],
      verify: { planned: true, surfaces: ['web'], result: null, passed: null, total: null, evidence: null, reason: null },
      taskStartedAt: '2026-10-12T11:11:00.000Z', stageSince: '2026-10-12T11:11:00.000Z', stages: {}, doneAt: null, lastAt: '2026-10-12T11:20:00.000Z',
    }), Date.parse('2026-10-12T12:00:00.000Z'), 1)!;
    const card = buildCards({ ...EMPTY, forge: f, subagents: [{ id: 'a', type: 'forge:forge-verify', seconds: 5 }] }, T, 0)[0];
    const alt = cardAlt(card);
    expect(card.subtitle).toBe('forge · done · ✓ 9m 00s');
    expect(alt).not.toContain('…');
    expect(alt).not.toContain('forge-verify');
    expect(card.blocks.some(b => b.kind === 'row')).toBe(false);
    expect((card.blocks.find(b => b.kind === 'stages') as { stages: { state: string }[] }).stages.every(s => s.state === 'done')).toBe(true);
    expect(alt).toContain('briefs 1/1');
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
  it('puts Now first and Usage last, the work in between', () => {
    const usage = {
      scope: 'session' as const, tokens: 20, costUsd: 0.2, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null,
      groups: [], tracking: null, withoutForge: null, pricesAsOf: '2026-10-12',
    };
    const todos = { done: 1, total: 2, inProgress: 'b', next: [] };
    const cards = buildCards({ ...EMPTY, usage, forge: FORGE, todos, mainModel: { model: 'claude-opus-5-5', effort: 'high' } }, T, 0);
    expect(cards.map(c => c.title)).toEqual([T.sNow, FORGE.task, T.sTodos, T.sUsage]);
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

describe('lens timings: usage', () => {
  const U = {
    scope: 'session' as const, tokens: 1000, costUsd: 1, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null,
    groups: [], tracking: null, withoutForge: null, pricesAsOf: '2026-10-12',
  };
  it('formats spans, past a day as >24h, and nothing for junk', () => {
    expect(span(45)).toBe('45s');
    expect(span(723)).toBe('12m 03s');
    expect(span(8040)).toBe('2h 14m');
    expect(span(86_401)).toBe('>24h');
    expect(span(-1)).toBeNull();
    expect(span(NaN)).toBeNull();
    expect(span(null)).toBeNull();
  });
  it('draws the active and since-start line under the main bar, and this session dimmed in a run', () => {
    const one = buildCards({ ...EMPTY, usage: { ...U, time: { activeSeconds: 3900, activePartial: false, sinceStartSeconds: 8040, session: null } } }, T, 0)
      .find(c => c.title === T.sUsage)!;
    expect(one.blocks[1]).toEqual({ kind: 'text', text: '⏱ active 1h 05m · since start 2h 14m' });
    const run = buildCards({ ...EMPTY, usage: { ...U, scope: 'run' as const, time: { activeSeconds: 7200, activePartial: true, sinceStartSeconds: 90_000, session: { activeSeconds: 60, sinceStartSeconds: 120 } } } }, T, 0)
      .find(c => c.title === T.sUsage)!;
    expect(run.blocks[1]).toEqual({ kind: 'text', text: '⏱ active ≥ 2h 00m · since start >24h' });
    expect(run.blocks[2]).toEqual({ kind: 'text', text: 'this session: ⏱ active 1m 00s · since start 2m 00s', dim: true });
    // Without time (an older model) the card is as before.
    expect(JSON.stringify(buildCards({ ...EMPTY, usage: U }, T, 0))).not.toContain('⏱');
  });
});

describe('lens timings: finished subagents', () => {
  it('draws finished subagents after the running ones, dimmed, with ✓ and their time; a card with only finished ones still shows', () => {
    const running = [{ id: 'r', type: 'forge:forge-impl', description: 'T7', seconds: 30 }];
    const done = [{ id: 'd', type: 'forge:forge-review-security', description: 'review T6', model: 'claude-sonnet-5-5', seconds: 125 }];
    const card = buildCards({ ...EMPTY, subagents: running, subagentsDone: done }, T, 0).find(c => c.title === T.sSubagents)!;
    expect(card.chip).toEqual({ text: '1', hue: 'lavender' });
    expect(card.blocks[0].kind).toBe('row');
    expect(card.blocks[1]).toEqual({ kind: 'text', text: '✓ security · review T6 · Sonnet 5.5 · 2m 05s', dim: true });
    const only = buildCards({ ...EMPTY, subagentsDone: done }, T, 0).find(c => c.title === T.sSubagents)!;
    expect(only.blocks).toHaveLength(1);
    expect(only.chip).toBeUndefined();
  });
});

describe('lens timings: execution and roadmap', () => {
  it('adds the task time to each slot, a dim finished line and the run time in the subtitle', () => {
    const x = { ...EXEC, elapsedSeconds: 7500, slots: [{ ...EXEC.slots[0], taskSeconds: 1080 }], finished: [{ task: 'T002', seconds: 1320 }, { task: 'T005', seconds: 1860 }] };
    const card = buildCards({ ...EMPTY, execution: x }, T, 0).find(c => c.title === T.sExecution)!;
    expect(card.subtitle).toBe('⏱ 2h 05m');
    const row = card.blocks.find(b => b.kind === 'row')!;
    expect(row.kind === 'row' && row.right).toBe('review · correctness · 5m 00s · task 18m 00s · r2');
    expect(card.blocks).toContainEqual({ kind: 'text', text: '✓ T002 22m 00s · T005 31m 00s', dim: true });
    // An execution without timings draws as before.
    expect(JSON.stringify(buildCards({ ...EMPTY, execution: EXEC }, T, 0))).not.toContain('✓');
  });
  it('lists the last done roadmap tasks dimmed, in amber when over the estimate', () => {
    const w = {
      project: 'shop', track: 'api', percent: 40, trackDone: 2, trackTotal: 5, current: null, inbox: 0, escalation: false, roadmapUrl: null, locale: 'en',
      phase: null, cells: 'ddapp', recentDone: [{ id: 'T003', minutes: 22, estimateMin: 30 }, { id: 'T002', minutes: 41, estimateMin: 30 }, { id: 'T001', minutes: 7 }],
    };
    const card = buildCards({ ...EMPTY, waypoint: w }, T, Date.parse('2026-10-12T12:00:00.000Z')).find(c => c.title === 'shop')!;
    const texts = card.blocks.filter(b => b.kind === 'text' && b.text.startsWith('✓'));
    expect(texts).toEqual([
      { kind: 'text', text: '✓ T003 · 22/30 min', dim: true },
      { kind: 'text', text: '✓ T002 · 41/30 min', dim: true, hue: 'yellow' },
      { kind: 'text', text: '✓ T001 · 7 min', dim: true },
    ]);
  });
  it('shows >24h for a done task over a day, keeping the amber rule', () => {
    const w = {
      project: 'shop', track: 'api', percent: 40, trackDone: 2, trackTotal: 5, current: null, inbox: 0, escalation: false, roadmapUrl: null, locale: 'en',
      phase: null, cells: 'ddapp', recentDone: [{ id: 'T009', minutes: 1441, estimateMin: 30 }, { id: 'T008', minutes: 1440 }],
    };
    const card = buildCards({ ...EMPTY, waypoint: w }, T, 0).find(c => c.title === 'shop')!;
    expect(card.blocks.filter(b => b.kind === 'text' && b.text.startsWith('✓'))).toEqual([
      { kind: 'text', text: '✓ T009 · >24h/30 min', dim: true, hue: 'yellow' },
      { kind: 'text', text: '✓ T008 · 1440 min', dim: true },
    ]);
  });
});

describe('lens timings: forge', () => {
  it('maps phases to stages, unknown ones by their own name', () => {
    expect(stageOf('fix')).toBe('implement');
    expect(stageOf('Planning')).toBe('plan');
    expect(stageOf('triage')).toBe('triage');
    expect(stageOf('my-step')).toBe('my-step');
    expect(stageOf('constructor')).toBe('constructor');
    expect(stageOf('__proto__')).toBe('__proto__');
  });
  it('adds the task time to the subtitle and a dim stage line under the stages, the live one with …', () => {
    const timing = { taskSeconds: 520, done: false, stages: [{ name: 'triage', seconds: 12, live: false }, { name: 'implement', seconds: 302, live: true }] };
    const card = buildCards({ ...EMPTY, forge: { ...FORGE, timing } }, T, 0).find(c => c.title === FORGE.task)!;
    expect(card.subtitle).toBe('forge · implement · 8m 40s');
    expect(card.blocks[0].kind).toBe('stages');
    expect(card.blocks[1]).toEqual({ kind: 'text', text: 'triage 12s · implement 5m 02s…', dim: true });
  });
  it('a finished task shows ✓ and its total, and the stages without …', () => {
    const timing = { taskSeconds: 860, done: true, stages: [{ name: 'implement', seconds: 800, live: false }, { name: 'verdict', seconds: 60, live: false }] };
    const card = buildCards({ ...EMPTY, forge: { ...FORGE, phase: 'done', timing } }, T, 0).find(c => c.title === FORGE.task)!;
    expect(card.subtitle).toBe('forge · done · ✓ 14m 20s');
    expect(card.blocks[1]).toEqual({ kind: 'text', text: 'implement 13m 20s · verdict 1m 00s', dim: true });
  });
  it('without timing (an older status) the card is as before', () => {
    const card = buildCards({ ...EMPTY, forge: { ...FORGE, timing: null } }, T, 0)[0];
    expect(card.subtitle).toBe('forge · implement');
    expect(card.blocks.map(b => b.kind)).toEqual(['stages', 'bar', 'cells', 'row', 'chips']);
  });
});

describe('the roadmap card of an execution (E-10)', () => {
  it('its bar counts what is integrated, with the messages and the decision, and no task line', () => {
    const w = { project: 'shop', track: null, percent: 25, trackDone: 3, trackTotal: 12, current: null, inbox: 2, escalation: true, roadmapUrl: null, locale: 'en',
      phase: { index: 2, total: 4, name: 'API' }, cells: '', run: true };
    const card = buildCards({ ...EMPTY, waypoint: w }, T, 0).find(c => c.title === 'shop')!;
    expect(card.subtitle).toBe('Phase 2/4 · API');
    expect(cardAlt(card)).toContain('integrated 3/12');
    expect(cardAlt(card)).not.toContain(T.noTask);
    expect(card.blocks.find(b => b.kind === 'chips')).toMatchObject({ chips: [{ text: '✉ 2' }, { text: '⚠ decision' }] });
  });
});

describe('superpowers and todos cards (E-13, E-14)', () => {
  it('superpowers shows its round against its own cap and says when the ledger is stale', () => {
    const sp = { plan: 'p', tasks: 5, done: 2, current: { task: '3', round: 2, cap: 3 }, lastLines: [], stale: true };
    const card = buildCards({ ...EMPTY, superpowers: sp }, T, 0).find(c => c.title === 'p')!;
    expect(cardAlt(card)).toContain('round 2/3');
    expect(cardAlt(card)).toContain('unchanged for over a day');
    const free = buildCards({ ...EMPTY, superpowers: { ...sp, current: { task: '3', round: 2, cap: null }, stale: undefined } }, T, 0).find(c => c.title === 'p')!;
    expect(cardAlt(free)).toContain('round 2');
    expect(cardAlt(free)).not.toContain('round 2/');
  });
  it('todos list every one in progress and draw the cells in their order', () => {
    const card = buildCards({ ...EMPTY, todos: { total: 3, done: 1, inProgress: 'A', next: ['c'], active: ['A', 'B'], cells: 'adp' } }, T, 0).find(c => c.title === T.sTodos)!;
    expect(card.blocks.find(b => b.kind === 'cells')).toEqual({ kind: 'cells', cells: ['active', 'done', 'pending'] });
    expect(card.blocks.filter(b => b.kind === 'row').map(b => (b as { text: string }).text)).toEqual(['A', 'B', 'c']);
  });
});
