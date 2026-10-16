import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBandModel, noneBand, NO_VIEWER } from '../src/mod/model.js';
import { newUsage, recordStep, labelLoop, closeTurn } from '../src/lens/usage.js';
import { FINISHED_TTL_MS } from '../src/lens/finished.js';
import { buildPanelModel, bandKey, usageTime, elapsed, forgeFromStatus, parsePlanTasks, parseSddLedger, summarizeTodos, type Activity, type PanelModel } from '../src/lens/model.js';

const LEDGER = `# SDD ledger — plan: docs/superpowers/plans/2026-10-11-waypoint-views.md

## Pre-flight scan
| Check | Result |
|---|---|
| deps | ok |
Ruling: use the existing parser

## Progress
Tasks 1-2: fix round 1/5 (latest includes answeredAt; more)
Tasks 1-2: complete (commits ca41e69..a305440)
Task 3: minor (deferred): rename helper
Task 3: fix round 2/5 (stale cache)
Task 3: complete (commits a305440..34cce07, review clean)
Task 4: fix round 3/5 (tests flaky)

Task 4: complete (commit 3a2a37c; ok)
Task 5: fix round 2/5 (needs work)
`;

const PLAN = `# Plan

### Task 1: Alpha
- [x] one
- [x] two
### Task 2: Beta thing
- [x] a
- [ ] b
- [ ] c
### Task 3: Gamma
no steps
`;

const act = (o: Partial<Activity> = {}): Activity => ({ tool: null, turnSince: null, todos: undefined, subagents: [], ccTasks: [], ...o });
// The work band of the conversation A, bound to the checkout seat main.
const band = () => buildBandModel('p', {
  plan: readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'),
  session: JSON.stringify({ sessionId: 'main', track: null }), states: {}, messages: {}, critiques: {},
  sessionId: 'A',
  bindings: { '.': JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: new Date().toISOString(), seenAt: new Date().toISOString(), endedAt: null, endReason: null }) },
});
const NONE_BAND = noneBand();

describe('parseSddLedger', () => {
  it('reads plan path, expands ranges and finds the current fix round', () => {
    const r = parseSddLedger(LEDGER);
    expect(r.planPath).toBe('docs/superpowers/plans/2026-10-11-waypoint-views.md');
    expect(r.done).toEqual([1, 2, 3, 4]);
    expect(r.current).toEqual({ task: '5', round: 2 });
    expect(r.lastLines).toEqual([
      'Task 4: fix round 3/5 (tests flaky)',
      'Task 4: complete (commit 3a2a37c; ok)',
      'Task 5: fix round 2/5 (needs work)',
    ]);
  });
  it('has no current when the fix-round task later completed', () => {
    expect(parseSddLedger('## Progress\nTask 3: fix round 2/5 (x)\nTask 3: complete (y)\n').current).toBeNull();
  });
  it('does not treat "minor (deferred)" or a fix line mentioning complete as done', () => {
    const r = parseSddLedger('## Progress\nTask 3: minor (deferred): x\nTask 4: fix round 1/5 (complete the thing)\n');
    expect(r.done).toEqual([]);
    expect(r.current).toEqual({ task: '4', round: 1 });
  });
  it('keeps a range label for current', () => {
    expect(parseSddLedger('## Progress\nTasks 1-2: fix round 1/5 (x)\n').current).toEqual({ task: '1-2', round: 1 });
  });
  it('falls back to the file tail without a Progress section and clips to 80', () => {
    const r = parseSddLedger(['a', 'b', '', 'c', 'x'.repeat(200), 'd'].join('\n'));
    expect(r.planPath).toBeNull();
    expect(r.lastLines).toEqual(['c', 'x'.repeat(80), 'd']);
  });
  it('never throws on junk, reversed or huge ranges, CRLF', () => {
    expect(parseSddLedger('').lastLines).toEqual([]);
    expect(parseSddLedger('\u0000� garbage\r\nTasks 9-2: complete\r\nTasks 1-99999999: complete\r\n').done.length).toBeLessThan(5000);
    expect(parseSddLedger('## Progress\r\nTask 1: complete\r\n').done).toEqual([1]);
    expect(parseSddLedger(undefined as unknown as string).done).toEqual([]);
  });
  it('counts progress lines only inside the Progress section when it exists', () => {
    const r = parseSddLedger('# SDD ledger — plan: p.md\n## Notes\nTask 7: complete (planned)\nTask 8: fix round 1/5 (x)\n## Progress\nTask 1: complete\n## Later\nTask 9: complete\n');
    expect(r.done).toEqual([1]);
    expect(r.current).toBeNull();
    expect(parseSddLedger('Task 7: complete\nTask 8: fix round 1/5 (x)\n').done).toEqual([7]);
  });
  it('stops lastLines at the next section', () => {
    expect(parseSddLedger('## Progress\nTask 1: complete\n## Notes\nother\n').lastLines).toEqual(['Task 1: complete']);
  });
});

describe('parsePlanTasks', () => {
  it('counts steps and checked per task', () => {
    expect(parsePlanTasks(PLAN)).toEqual([
      { n: 1, title: 'Alpha', steps: 2, checked: 2 },
      { n: 2, title: 'Beta thing', steps: 3, checked: 1 },
      { n: 3, title: 'Gamma', steps: 0, checked: 0 },
    ]);
  });
  it('accepts [X], ignores checkboxes before the first task, tolerates junk', () => {
    expect(parsePlanTasks('- [x] pre\n### Task 1: A\n* [X] a\n  - [ ] b\n')).toEqual([{ n: 1, title: 'A', steps: 2, checked: 1 }]);
    expect(parsePlanTasks('')).toEqual([]);
  });
});

describe('summarizeTodos', () => {
  const t = (content: string, status: string, activeForm?: string) => ({ content, status, activeForm });
  it('summarizes states, in-progress activeForm and next 3 pending', () => {
    const s = summarizeTodos([t('a', 'completed'), t('b', 'in_progress', 'Doing b'), t('c', 'pending'), t('d', 'pending'), t('e', 'weird'), t('f', 'pending')]);
    expect(s).toEqual({ total: 6, done: 1, inProgress: 'Doing b', next: ['c', 'd', 'e'] });
  });
  it('falls back to content and clips', () => {
    expect(summarizeTodos([t('y'.repeat(100), 'in_progress')]).inProgress).toBe('y'.repeat(80));
  });
  it('handles empty, non-array, invalid items and >200 items', () => {
    expect(summarizeTodos([])).toEqual({ total: 0, done: 0, inProgress: null, next: [] });
    expect(summarizeTodos('nope')).toEqual({ total: 0, done: 0, inProgress: null, next: [] });
    expect(summarizeTodos([null, 3, {}, { content: 5 }, t('ok', 'completed')]).total).toBe(1);
    const big = Array.from({ length: 500 }, (_, i) => t(`t${i}`, i < 100 ? 'completed' : 'pending'));
    const s = summarizeTodos(big);
    expect(s.total).toBe(500);
    expect(s.done).toBe(100);
    expect(s.next).toEqual(['t100', 't101', 't102']);
  });
});

describe('buildPanelModel', () => {
  const base = { band: NONE_BAND, activity: act(), now: 100_000 };
  it('is all-null for an empty project', () => {
    expect(buildPanelModel(base)).toEqual({
      locale: 'en', waypoint: null, superpowers: null, todos: null, subagents: [], subagentsDone: [], tool: null, turnSeconds: null, ccTasks: null,
      forge: null, infinite: null, decisions: null, execution: null, proposals: [], mainModel: null, usage: null,
    });
  });
  it('derives waypoint from a work band and takes its locale', () => {
    const b = band();
    expect(b.mode).toBe('work');
    const m = buildPanelModel({ ...base, band: b, locale: 'en' });
    expect(m.waypoint).not.toBeNull();
    expect(m.waypoint?.phase).toEqual((b as { phase: unknown }).phase);
    expect(buildPanelModel({ ...base, band: { ...(b as Extract<typeof b, { mode: 'work' }>), phase: { index: 1, total: 2, name: 'n'.repeat(120) } } }).waypoint?.phase?.name).toBe('n'.repeat(80));
    expect(m.locale).toBe((b as { locale: string }).locale);
    expect(buildPanelModel({ ...base, band: { mode: 'design', project: 'p', locale: 'es', version: 1, round: 1, proposals: 0, critical: 0, pending: 0, pendingCritical: 0, designUrl: null, viewer: NO_VIEWER } }).waypoint).toBeNull();
  });
  it('uses the given locale without a waypoint plan', () => {
    expect(buildPanelModel({ ...base, locale: 'es' }).locale).toBe('es');
  });
  it('combines ledger and its plan', () => {
    const m = buildPanelModel({ ...base, ledger: LEDGER, ledgerPlan: PLAN });
    expect(m.superpowers).toEqual({
      plan: 'docs/superpowers/plans/2026-10-11-waypoint-views.md', tasks: 3, done: 3,
      current: { task: '5', round: 2 }, lastLines: parseSddLedger(LEDGER).lastLines,
    });
  });
  it('without a ledger shows the plan by its checked tasks', () => {
    const m = buildPanelModel({ ...base, planFallback: PLAN });
    expect(m.superpowers).toMatchObject({ tasks: 3, done: 1, current: null, lastLines: [] });
  });
  it('hides a fallback plan with no checked step (one run by subagents, whose ledger is gone)', () => {
    expect(buildPanelModel({ ...base, planFallback: PLAN.replace(/\[x\]/g, '[ ]') }).superpowers).toBeNull();
  });
  it('hides a finished ledger older than a day, keeps it otherwise', () => {
    const done = '# SDD ledger — plan: p.md\n## Progress\nTasks 1-3: complete\n';
    const day = 24 * 3600_000;
    const at = (ledger: string, age: number) =>
      buildPanelModel({ ...base, now: 10 * day, ledger, ledgerPlan: PLAN, ledgerMtimeMs: 10 * day - age }).superpowers;
    expect(at(done, day + 1)).toBeNull();
    expect(at(done, day - 1)).not.toBeNull();
    expect(at(done + 'Task 4: fix round 1/5 (x)\n', day + 1)).not.toBeNull();
    expect(at('# SDD ledger — plan: p.md\n## Progress\nTask 1: complete\n', day + 1)).not.toBeNull();
    expect(buildPanelModel({ ...base, now: 10 * day, ledger: done, ledgerPlan: PLAN }).superpowers).not.toBeNull();
  });
  it('clips the ledger plan path', () => {
    const m = buildPanelModel({ ...base, ledger: `# SDD ledger — plan: ${'p'.repeat(200)}.md\n## Progress\nTask 1: complete\n` });
    expect(m.superpowers?.plan).toBe('p'.repeat(80));
  });
  it('gives null seconds for non-finite times', () => {
    const m = buildPanelModel({
      ...base, now: NaN,
      activity: act({ tool: { name: 'Bash', since: 1 }, turnSince: 1, subagents: [{ id: 'x', type: 't', since: Infinity }] }),
    });
    expect(m.tool).toEqual({ name: 'Bash', seconds: null });
    expect(m.turnSeconds).toBeNull();
    expect(m.subagents[0].seconds).toBeNull();
    expect(buildPanelModel({ ...base, activity: act({ turnSince: NaN }) }).turnSeconds).toBeNull();
  });
  it('ledger without plan text still reports done count', () => {
    expect(buildPanelModel({ ...base, ledger: LEDGER }).superpowers).toMatchObject({ tasks: 5, done: 4 });
  });
  it('maps activity', () => {
    const m = buildPanelModel({
      ...base,
      activity: act({
        tool: { name: 'Bash', since: 90_000 }, turnSince: 40_000,
        todos: [{ content: 'a', status: 'pending' }],
        subagents: [{ id: 'x', type: 'Explore', description: 'd'.repeat(120), status: 'running', since: 70_000 }, { id: 'y', type: 'general', since: 99_999 }],
        ccTasks: [{ id: '1', subject: 's1', done: true }, { id: '2', subject: 's2', done: false }, { id: '3', subject: 's3', done: false }, { id: '4', subject: 's4', done: false }, { id: '5', subject: 's5', done: true }],
      }),
    });
    expect(m.tool).toEqual({ name: 'Bash', seconds: 10 });
    expect(m.turnSeconds).toBe(60);
    expect(m.todos).toEqual({ total: 1, done: 0, inProgress: null, next: ['a'] });
    expect(m.subagents[0]).toEqual({ id: 'x', type: 'Explore', description: 'd'.repeat(80), status: 'running', seconds: 30 });
    expect(m.subagents[1].seconds).toBe(0);
    expect(m.ccTasks).toEqual({ open: 3, done: 2, recent: ['s3', 's4', 's5'] });
  });
  it('omits todos when none were ever written', () => {
    expect(buildPanelModel({ ...base, activity: act({ todos: [] }) }).todos).toBeNull();
  });
});

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
const STATUS = {
  ts: at(30), task: 'hash', path: 'medium', phase: 'review', agent: 'forge-review-security',
  validators: [{ name: 'test', ok: true }], verdict: { action: 'accept', score: 0.97 }, round: 0, cap: 3,
};

describe('forge timings', () => {
  const S = (o: object) => JSON.stringify({ ...STATUS, ts: at(1), ...o });
  it('elapsed is null for junk, a future start or end, and a negative span', () => {
    expect(elapsed(at(10), NOW, NOW)).toBe(600);
    expect(elapsed('nope', NOW, NOW)).toBeNull();
    expect(elapsed(undefined, NOW, NOW)).toBeNull();
    expect(elapsed(at(-5), NOW, NOW)).toBeNull();
    expect(elapsed(at(-1), NOW, NOW)).toBeNull();
    expect(elapsed(at(10), NOW + 10 * 60_000, NOW)).toBeNull();
  });
  it('a task in progress: its time so far, closed stages grouped in STAGES order, the current one live', () => {
    const f = forgeFromStatus(S({
      phase: 'fix', taskStartedAt: at(10), stageSince: at(1),
      stages: { triage: 12, implement: 300, validate: 48, 'my-step': 7 }, doneAt: null,
    }), NOW)!;
    expect(f.timing).toEqual({
      taskSeconds: 600, done: false,
      stages: [
        { name: 'triage', seconds: 12, live: false },
        { name: 'implement', seconds: 360, live: true },
        { name: 'validate', seconds: 48, live: false },
        { name: 'my-step', seconds: 7, live: false },
      ],
    });
  });
  it('a finished task: its time up to doneAt and the stages fixed', () => {
    const f = forgeFromStatus(S({ phase: 'done', taskStartedAt: at(20), stageSince: at(5), stages: { triage: 10, implement: 850 }, doneAt: at(5) }), NOW)!;
    expect(f.timing).toEqual({ taskSeconds: 900, done: true, stages: [{ name: 'triage', seconds: 10, live: false }, { name: 'implement', seconds: 850, live: false }] });
  });
  it('a future or junk start gives no task time; the stages still show', () => {
    const f = forgeFromStatus(S({ taskStartedAt: at(-30), stageSince: 'x', stages: { triage: 3 }, doneAt: null }), NOW)!;
    expect(f.timing).toEqual({ taskSeconds: null, done: false, stages: [{ name: 'triage', seconds: 3, live: false }] });
  });
  it('a doneAt before the start is ignored: the task counts as running', () => {
    const f = forgeFromStatus(S({ phase: 'implement', taskStartedAt: at(10), stageSince: at(1), stages: {}, doneAt: at(20) }), NOW)!;
    expect(f.timing!.done).toBe(false);
    expect(f.timing!.taskSeconds).toBe(600);
  });
  it('phases named like Object.prototype members do not break the grouping', () => {
    const text = '{"ts":"' + at(1) + '","task":"t","path":"small","phase":"constructor","agent":null,"validators":[],"verdict":null,"round":null,"cap":null,'
      + '"taskStartedAt":"' + at(10) + '","stageSince":"' + at(1) + '","stages":{"constructor":5,"__proto__":9,"toString":2,"implement":4},"doneAt":null}';
    const f = forgeFromStatus(text, NOW);
    const names = f!.timing!.stages.map(s => s.name);
    expect(names[0]).toBe('implement');
    expect(names).toContain('constructor');
    expect(f!.timing!.stages.find(s => s.name === 'constructor')).toEqual({ name: 'constructor', seconds: 65, live: true });
  });
});

describe('forge light task left open', () => {
  // The B016 status: a Small task, forge-verify launched and its result never logged, nothing logged for 40 minutes.
  const B016 = {
    ts: at(49), task: 'fecha-corta', path: 'small', phase: '', agent: 'forge-verify', validators: [{ name: 'test', ok: true }],
    verdict: null, round: null, cap: null, brief: null, accepted: [],
    verify: { planned: true, surfaces: ['web'], result: null, passed: null, total: null, evidence: null, reason: null },
    taskStartedAt: at(49), stageSince: at(49), stages: {}, doneAt: null, lastAt: at(40),
  };
  it('a trivial or small task silent for over 30 minutes is drawn finished: no clock, no agent', () => {
    const f = forgeFromStatus(JSON.stringify(B016), NOW, 1)!;
    expect(f.agent).toBeNull();
    expect(f.timing).toEqual({ taskSeconds: 540, done: true, stages: [{ name: 'triage', seconds: 540, live: false }] });
    expect(f).not.toHaveProperty('lastAt');
    expect(forgeFromStatus(JSON.stringify({ ...B016, path: 'trivial' }), NOW)!.timing!.done).toBe(true);
  });
  it('a light task heard from in the last 30 minutes, or with no lastAt, still runs', () => {
    const recent = forgeFromStatus(JSON.stringify({ ...B016, lastAt: at(29) }), NOW)!;
    expect(recent).toMatchObject({ agent: 'forge-verify', timing: { done: false, taskSeconds: 2940 } });
    expect(recent.timing!.stages[0].live).toBe(true);
    expect(forgeFromStatus(JSON.stringify({ ...B016, lastAt: undefined }), NOW)!.timing!.done).toBe(false);
  });
  it('is not guessed while a subagent of the task agent\'s tier still runs', () => {
    const live = forgeFromStatus(JSON.stringify(B016), NOW, 1, ['forge:forge-verify'])!;
    expect(live).toMatchObject({ agent: 'forge-verify', timing: { done: false } });
    expect(forgeFromStatus(JSON.stringify(B016), NOW, 1, ['forge:forge-impl'])!.timing!.done).toBe(true);
    const m = buildPanelModel({ band: NONE_BAND, now: NOW, forgeStatus: JSON.stringify(B016),
      activity: act({ subagents: [{ id: 'a', type: 'forge:forge-verify', since: NOW - 60_000 }] }) });
    expect(m.forge!.timing!.done).toBe(false);
  });
  it('the band key changes when the task turns done', () => {
    const m = buildPanelModel({ band: NONE_BAND, now: NOW, forgeStatus: JSON.stringify({ ...B016, agent: null, lastAt: at(29) }), activity: act() });
    const later = buildPanelModel({ band: NONE_BAND, now: NOW + 2 * 60_000, forgeStatus: JSON.stringify({ ...B016, agent: null, lastAt: at(29) }), activity: act() });
    expect(later.forge!.timing!.done).toBe(true);
    expect(bandKey(later)).not.toBe(bandKey(m));
  });
  it('medium and large are unchanged', () => {
    for (const path of ['medium', 'large']) {
      const f = forgeFromStatus(JSON.stringify({ ...B016, path }), NOW)!;
      expect(f).toMatchObject({ agent: 'forge-verify', timing: { done: false } });
    }
  });
});

describe('forgeFromStatus', () => {
  it('maps a valid status.json without its ts', () => {
    const { ts: _ts, ...rest } = STATUS;
    expect(forgeFromStatus(JSON.stringify(STATUS), NOW)).toEqual({ ...rest, brief: null, accepted: [], verify: null, briefs: null, timing: null });
    expect(forgeFromStatus(JSON.stringify(STATUS), NOW, 4)).toMatchObject({ briefs: 4 });
  });
  it('leaves out who wrote the last event, its run and its project: nothing draws them, so the band key never follows them (C4)', () => {
    const stamped = JSON.stringify({ ...STATUS, session: 'c1', runId: 'r1', project: 'shop' });
    expect(forgeFromStatus(stamped, NOW)).toEqual(forgeFromStatus(JSON.stringify(STATUS), NOW));
    const model = (forgeStatus: string) => buildPanelModel({ band: NONE_BAND, now: NOW, forgeStatus, activity: act() });
    expect(bandKey(model(stamped))).toBe(bandKey(model(JSON.stringify({ ...STATUS, session: null, runId: 'r2', project: null }))));
  });
  it('keeps auto mode from status.json', () => {
    expect(forgeFromStatus(JSON.stringify({ ...STATUS, autonomy: 'auto' }), NOW)).toMatchObject({ autonomy: 'auto' });
    expect(forgeFromStatus(JSON.stringify(STATUS), NOW)).not.toHaveProperty('autonomy');
  });
  it('is null for junk, invalid fields or a status older than a day', () => {
    expect(forgeFromStatus('', NOW)).toBeNull();
    expect(forgeFromStatus('{"task":', NOW)).toBeNull();
    expect(forgeFromStatus(undefined as unknown as string, NOW)).toBeNull();
    expect(forgeFromStatus(JSON.stringify({ ...STATUS, task: 7 }), NOW)).toBeNull();
    expect(forgeFromStatus(JSON.stringify({ ...STATUS, verdict: 'accept' }), NOW)).toBeNull();
    expect(forgeFromStatus(JSON.stringify({ ...STATUS, ts: 'never' }), NOW)).toBeNull();
    expect(forgeFromStatus(JSON.stringify(STATUS), NOW + 24 * 3600_000)).toBeNull();
  });
  it('strips control characters and clips to 80', () => {
    const f = forgeFromStatus(JSON.stringify({ ...STATUS, task: 'a\u001b[31mb', phase: 'p'.repeat(120), agent: 'x\u007fy' }), NOW);
    expect(f).toMatchObject({ task: 'a[31mb', phase: 'p'.repeat(80), agent: 'xy' });
  });
});

describe('buildPanelModel forge', () => {
  const base = { band: NONE_BAND, activity: act(), now: NOW };
  const doc = (o: Record<string, unknown>) => JSON.stringify({
    ts: '2026-10-11T10:00:00.000Z', category: 'perf', risk: 'low', title: 'Cache it', rationale: '', evidence: '', pillar: '',
    status: 'proposed', source: 'scout', author: 'scout', ...o,
  });
  it('takes the forge summary from status.json', () => {
    expect(buildPanelModel({ ...base, forgeStatus: JSON.stringify(STATUS) }).forge?.task).toBe('hash');
  });
  it('strips control characters from proposal titles', () => {
    const m = buildPanelModel({ ...base, proposals: { p20261011100000aaaa: doc({ title: 'a\u0000b\u001b[2Jc\u007f' }) } });
    expect(m.proposals[0].title).toBe('ab[2Jc');
  });
  it('keeps only pending proposals, newest first, at most 5, titles clipped', () => {
    const m = buildPanelModel({
      ...base,
      proposals: {
        p20261011100000aaaa: doc({ title: 'x'.repeat(120) }),
        p20261011110000bbbb: doc({ status: 'approved' }),
        p20261011120000cccc: doc({ status: 'discussing', title: 'Talk', category: 'security', risk: 'high' }),
        p20261011130000dddd: '{not json',
        'bad-id': doc({}),
      },
    });
    expect(m.proposals).toEqual([
      { id: 'p20261011120000cccc', title: 'Talk', category: 'security', risk: 'high' },
      { id: 'p20261011100000aaaa', title: 'x'.repeat(80), category: 'perf', risk: 'low' },
    ]);
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p2026101110000${i}aaaa`, doc({ title: `t${i}` })]));
    expect(buildPanelModel({ ...base, proposals: many }).proposals.map(p => p.title)).toEqual(['t7', 't6', 't5', 't4', 't3']);
  });
});

describe('buildPanelModel infinite', () => {
  const base = { band: NONE_BAND, activity: act(), now: NOW };
  const RUN = {
    mode: 'infinite', active: true, startedAt: at(90), budget: { cycles: 10, hours: 3 }, cycle: 3, noProgress: 0,
    lastError: null, repeatedError: false, lastBlockEvents: null, queueMax: 10, sessionId: null,
  };
  const doc = (o: Record<string, unknown>) => JSON.stringify({
    ts: '2026-10-11T10:00:00.000Z', category: 'tests', risk: 'low', title: 'Fix it', rationale: '', evidence: '', pillar: '',
    status: 'auto_approved', source: 'scout', author: 'scout', ...o,
  });
  it('is null without a run.json, or with an invalid or oversized one', () => {
    expect(buildPanelModel(base).infinite).toBeNull();
    for (const t of ['{not json', '[]', JSON.stringify({ ...RUN, mode: 'x' }), JSON.stringify({ ...RUN, cycle: -1 }), JSON.stringify({ ...RUN, budget: { cycles: 0 } })])
      expect(buildPanelModel({ ...base, forgeRun: t }).infinite).toBeNull();
    expect(buildPanelModel({ ...base, forgeRun: JSON.stringify(RUN) + ' '.repeat(16 * 1024) }).infinite).toBeNull();
  });
  it('maps the cycle in progress (done + 1 while active, never past the budget), budget and the hours left', () => {
    expect(buildPanelModel({ ...base, forgeRun: JSON.stringify(RUN) }).infinite).toEqual({ cycle: 4, cyclesMax: 10, hoursLeft: 1.5, active: true, autoApproved: [] });
    expect(buildPanelModel({ ...base, forgeRun: JSON.stringify({ ...RUN, cycle: 10 }) }).infinite?.cycle).toBe(10);
    expect(buildPanelModel({ ...base, forgeRun: JSON.stringify({ ...RUN, cycle: 0, budget: {} }) }).infinite?.cycle).toBe(1);
    const open = buildPanelModel({ ...base, forgeRun: JSON.stringify({ ...RUN, active: false, budget: {} }) }).infinite;
    expect(open).toEqual({ cycle: 3, cyclesMax: null, hoursLeft: null, active: false, autoApproved: [] });
    const over = buildPanelModel({ ...base, forgeRun: JSON.stringify({ ...RUN, startedAt: at(600) }) }).infinite;
    expect(over?.hoursLeft).toBe(0);
  });
  it('lists the 3 newest auto-approved proposal titles, cleaned', () => {
    const m = buildPanelModel({
      ...base, forgeRun: JSON.stringify(RUN),
      proposals: {
        p20261011100000aaaa: doc({ title: 'one' }),
        p20261011110000bbbb: doc({ title: 'two[2J' }),
        p20261011120000cccc: doc({ title: 'pending', status: 'proposed' }),
        p20261011130000dddd: doc({ title: 'three' }),
        p20261011140000eeee: doc({ title: 'four' }),
      },
    });
    expect(m.infinite?.autoApproved).toEqual(['four', 'three', 'two[2J']);
    expect(m.proposals.map(p => p.title)).toEqual(['pending']);
  });
});

describe('buildPanelModel · execution', () => {
  const T0 = '2026-10-12T12:00:00.000Z';
  const now = Date.parse(T0);
  const execDoc = JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: '2026-10-12T11:00:00.000Z', lastStepAt: '2026-10-12T11:58:00.000Z', lastBlockStep: null, sleepUntil: null,
    tasks: { T4: { status: 'running', stage: 'review', round: 2, worktree: '/w', branch: 'task/T4', executor: 'subagents', attempts: 0, agent: 'forge-review-correctness', startedAt: '2026-10-12T11:40:00.000Z', updatedAt: '2026-10-12T11:59:00.000Z', stageSince: '2026-10-12T11:57:00.000Z', detail: null },
      T2: { status: 'integrated', stage: 'integrate', round: 1, worktree: '/w2', branch: 'task/T2', executor: 'subagents', attempts: 0, agent: null, startedAt: '2026-10-12T11:10:00.000Z', updatedAt: '2026-10-12T11:30:00.000Z', stageSince: '2026-10-12T11:30:00.000Z', detail: null } } });
  it('builds the execution section from the files, with seconds in stage and liveness', () => {
    const m = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: execDoc, forgeExecTasks: {}, forgeLive: { s1: JSON.stringify({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'Stop', ts: '2026-10-12T11:59:00.000Z', agents: [], ended: false }) } });
    expect(m.execution).toMatchObject({ mode: 'subagents', parallel: 3, integrated: 1, total: 2, coordinator: { liveness: 'alive' } });
    expect(m.execution!.slots[0]).toMatchObject({ task: 'T4', stage: 'review', round: 2, seconds: 180, liveness: 'alive' });
  });
  it('a stalled run keeps the same times at any later now, frozen at its last step, and never runs negative (E-05)', () => {
    const doc = execDoc.replace('"active":true', '"active":false').replace('"stopReason":null', '"stopReason":"stalled"');
    const at = (ms: number, text = doc) => buildPanelModel({ band: band(), activity: act(), now: ms, forgeExecution: text, forgeExecTasks: {}, forgeLive: {} }).execution!;
    const a = at(now), b = at(now + 5 * 3600_000);
    // lastStepAt 11:58 − startedAt 11:00.
    expect(a.elapsedSeconds).toBe(58 * 60);
    expect(b.elapsedSeconds).toBe(58 * 60);
    expect(b.slots[0].taskSeconds).toBe(a.slots[0].taskSeconds);
    expect(b.slots[0].seconds).toBe(a.slots[0].seconds);
    // A last step a minute ahead of this reader's clock: the clock stops at now, not past it.
    const ahead = doc.replace('"lastStepAt":"2026-10-12T11:58:00.000Z"', '"lastStepAt":"2026-10-12T12:01:00.000Z"');
    expect(at(now, ahead).elapsedSeconds).toBe(3600);
    // 25 hours later it is no longer drawn.
    expect(buildPanelModel({ band: band(), activity: act(), now: now + 25 * 3600_000, forgeExecution: doc, forgeExecTasks: {}, forgeLive: {} }).execution).toBeNull();
  });
  it('a closed execution is not drawn', () => {
    const closed = execDoc.replace('"active":true', '"active":false').replace('"stopReason":null', '"stopReason":"stalled","closedAt":"2026-10-12T11:59:00.000Z","closedBy":"close"');
    expect(buildPanelModel({ band: band(), activity: act(), now, forgeExecution: closed, forgeExecTasks: {}, forgeLive: {} }).execution).toBeNull();
  });
  it('a coordinator waiting 20 minutes on a long agent is alive and its task is not orphaned', () => {
    const stale = execDoc.replace('"lastStepAt":"2026-10-12T11:58:00.000Z"', '"lastStepAt":"2026-10-12T11:40:00.000Z"');
    const signal = (ended: boolean) => ({ s1: JSON.stringify({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'SubagentStart', ts: '2026-10-12T11:40:00.000Z', agents: [{ id: 'a1', type: 'forge:forge-review-correctness', since: '2026-10-12T11:40:00.000Z' }], ended }) });
    const m = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: stale, forgeExecTasks: {}, forgeLive: signal(false) });
    expect(m.execution).toMatchObject({ coordinator: { liveness: 'alive' }, orphans: [] });
    expect(m.execution!.slots[0].liveness).toBe('alive');
    const ended = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: stale, forgeExecTasks: {}, forgeLive: signal(true) });
    expect(ended.execution).toMatchObject({ coordinator: { liveness: 'stopped' }, orphans: ['T4'] });
  });
  it('lists a manual task of this run after the slots, with its own liveness', () => {
    const pubDoc = JSON.stringify({ task: 'T9', runId: 'r1', stage: 'implement', status: 'running', agent: null, round: 1, since: '2026-10-12T11:50:00.000Z', updatedAt: T0, leaseUntil: '2026-10-12T12:05:00.000Z', by: 'M1', mode: 'manual' });
    const m = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: execDoc, forgeExecTasks: { T9: pubDoc }, forgeLive: {} });
    expect(m.execution!.manual).toEqual([{ task: 'T9', title: null, stage: 'implement', seconds: 600, liveness: 'alive', by: 'M1' }]);
    expect(m.execution!.slots.map(s => s.task)).toEqual(['T4']);
  });
  it('adds the run time, each slot task time and the finished tasks with their seconds', () => {
    const doc = JSON.parse(execDoc);
    doc.tasks.T2.finishedAt = '2026-10-12T11:32:00.000Z';
    doc.tasks.T3 = { ...doc.tasks.T2, branch: 'task/T3', startedAt: '2026-10-12T11:50:00.000Z', finishedAt: '2026-10-12T12:30:00.000Z' };
    const m = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: JSON.stringify(doc), forgeExecTasks: {}, forgeLive: {} });
    expect(m.execution!.elapsedSeconds).toBe(3600);
    expect(m.execution!.slots[0].taskSeconds).toBe(1200);
    // T3 finished 30 min in the future: dropped on read.
    expect(m.execution!.finished).toEqual([{ task: 'T2', seconds: 1320 }]);
  });
  it('drops a finished task whose finishedAt is before its start, and never lists a running one', () => {
    const doc = JSON.parse(execDoc);
    doc.tasks.T2.finishedAt = '2026-10-12T11:05:00.000Z';
    doc.tasks.T4.finishedAt = '2026-10-12T11:50:00.000Z';
    const m = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: JSON.stringify(doc), forgeExecTasks: {}, forgeLive: {} });
    expect(m.execution!.finished).toEqual([]);
  });
  it('the band key ignores the execution timing seconds', () => {
    const doc = JSON.parse(execDoc);
    doc.tasks.T2.finishedAt = '2026-10-12T11:32:00.000Z';
    const base = buildPanelModel({ band: band(), activity: act(), now, forgeExecution: JSON.stringify(doc), forgeExecTasks: {}, forgeLive: {} });
    const x = base.execution!;
    const mk = (secs: number): PanelModel => ({ ...base, execution: { ...x, elapsedSeconds: secs, finished: [{ task: 'T2', seconds: secs }], slots: x.slots.map(s => ({ ...s, taskSeconds: secs })) } });
    expect(JSON.stringify(mk(10))).not.toBe(JSON.stringify(mk(99)));
    expect(bandKey(mk(10))).toBe(bandKey(mk(99)));
    expect(bandKey(mk(10))).not.toBe(bandKey({ ...mk(10), execution: { ...mk(10).execution!, integrated: 5 } }));
  });
  it('is null without a file, with junk, or for a migrated execution', () => {
    expect(buildPanelModel({ band: band(), activity: act(), now }).execution).toBeNull();
    expect(buildPanelModel({ band: band(), activity: act(), now, forgeExecution: '{oops' }).execution).toBeNull();
    expect(buildPanelModel({ band: band(), activity: act(), now, forgeExecution: execDoc.replace('"active":true', '"active":false').replace('"stopReason":null', '"stopReason":"migrated"') }).execution).toBeNull();
  });
});

describe('buildPanelModel usage', () => {
  const base = { band: NONE_BAND, activity: act(), now: 100_000 };
  const U = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const session = () => {
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', effort: 'high', usage: U(1_000_000, 0) });
    recordStep(s, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'medium', usage: U(1_000_000, 0) });
    labelLoop(s, 'a1', 'forge:forge-impl', 'T1');
    return s;
  };
  it('has no usage, main model or subagent models without steps', () => {
    const m = buildPanelModel(base);
    expect(m.usage).toBeNull();
    expect(m.mainModel).toBeNull();
  });
  it('gives the main model and effort, and each subagent row its loop model', () => {
    const m = buildPanelModel({
      ...base, usage: { session: session(), run: null, officialUsd: 6 },
      activity: { ...base.activity, subagents: [{ id: 'a1', type: 'forge:forge-impl', since: base.now }] },
    });
    expect(m.mainModel).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
    expect(m.subagents[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
  });
  it('gives the session active time with the turn in progress, and the time since start', () => {
    const s = session();
    s.startedAt = 10_000;
    closeTurn(s, 20_000, 50_000);
    const m = buildPanelModel({ ...base, activity: act({ turnSince: 90_000 }), usage: { session: s, run: null, officialUsd: null } });
    expect(m.usage!.time).toEqual({ activeSeconds: 40, activePartial: false, sinceStartSeconds: 90, session: null });
  });
  it('in a run, sums the sessions, counts since the run start, and keeps this session apart', () => {
    const s = session();
    s.startedAt = 40_000;
    closeTurn(s, 40_000, 50_000);
    const run = newUsage(0);
    run.startedAt = 4_000;
    run.activeMs = 70_000;
    run.activePartial = true;
    expect(usageTime(s, run, 95_000, 100_000)).toEqual({
      activeSeconds: 75, activePartial: true, sinceStartSeconds: 96, session: { activeSeconds: 15, sinceStartSeconds: 60 },
    });
  });
  it('has no time since start before the start is read, and never a negative one', () => {
    const s = session();
    expect(usageTime(s, null, null, 100_000).sinceStartSeconds).toBeNull();
    s.startedAt = 200_000;
    expect(usageTime(s, null, 300_000, 100_000)).toMatchObject({ activeSeconds: 0, sinceStartSeconds: null });
  });
  it('summarizes the session, with the /cost check and drift', () => {
    const m = buildPanelModel({ ...base, usage: { session: session(), run: null, officialUsd: 6, officialOwnUsd: 6 } });
    expect(m.usage).toMatchObject({ scope: 'session', tokens: 2_000_000, partial: false, sessionPartial: false, officialUsd: 6, drift: false, session: null, pricesAsOf: '2026-10-12' });
    expect(m.usage!.costUsd).toBeCloseTo(6);
    expect(m.usage!.groups.map(g => g.id)).toEqual(['main', 'impl']);
    expect(buildPanelModel({ ...base, usage: { session: session(), run: null, officialUsd: 9, officialOwnUsd: 6 } }).usage!.drift).toBe(true);
  });
  it('compares /cost with the own cost snapshotted when /cost was read, not the live cost', () => {
    // Live cost is $6; at the last /cost read it was $3.9 against /cost $4: no drift although live differs by 50 %.
    expect(buildPanelModel({ ...base, usage: { session: session(), run: null, officialUsd: 4, officialOwnUsd: 3.9 } }).usage!.drift).toBe(false);
    // Live cost matches /cost, the snapshot did not: drift.
    expect(buildPanelModel({ ...base, usage: { session: session(), run: null, officialUsd: 6, officialOwnUsd: 3 } }).usage!.drift).toBe(true);
    expect(buildPanelModel({ ...base, usage: { session: session(), run: null, officialUsd: 6, officialOwnUsd: null } }).usage!.drift).toBe(false);
  });
  it('gives no drift when the session is partial', () => {
    const s = session();
    recordStep(s, { agentId: 'x', model: 'mystery-1', usage: U(1000, 0) });
    const u = buildPanelModel({ ...base, usage: { session: s, run: null, officialUsd: 20, officialOwnUsd: 6 } }).usage!;
    expect(u.sessionPartial).toBe(true);
    expect(u.drift).toBe(false);
  });
  it('shows the run when there is one, with the session line', () => {
    const run = newUsage(0);
    recordStep(run, { model: 'claude-opus-5-5', usage: U(3_000_000, 0) });
    const m = buildPanelModel({ ...base, usage: { session: session(), run, officialUsd: null } });
    expect(m.usage).toMatchObject({ scope: 'run', tokens: 3_000_000, session: { tokens: 2_000_000 } });
  });
});

describe('buildPanelModel roadmap recent done', () => {
  it('copies the roadmap recent done tasks, at most 3', () => {
    const rd = [{ id: 'T1', minutes: 22, estimateMin: 30 }, { id: 'T2', minutes: 5 }, { id: 'T3', minutes: 9 }, { id: 'T4', minutes: 1 }];
    const b = band();
    if (b.mode !== 'work') throw new Error('fixture: band() is a work band');
    expect(buildPanelModel({ band: { ...b, recentDone: rd }, activity: act(), now: 0 }).waypoint!.recentDone).toEqual(rd.slice(0, 3));
    expect(buildPanelModel({ band: b, activity: act(), now: 0 }).waypoint!.recentDone).toEqual([]);
  });
});

describe('buildPanelModel finished subagents', () => {
  it('lists fresh finished subagents with their seconds, clipped, without the internal time', () => {
    const now = 1_000_000;
    const m = buildPanelModel({
      band: NONE_BAND, now,
      activity: act({ finished: [
        { id: 'a1', type: 'forge:forge-impl', description: 'd'.repeat(120), model: 'claude-sonnet-5-5', seconds: 95, at: now - 1000 },
        { id: 'a2', type: 'Explore', seconds: 5, at: now - FINISHED_TTL_MS - 1 },
      ] }),
    });
    expect(m.subagentsDone).toEqual([{ id: 'a1', type: 'forge:forge-impl', description: 'd'.repeat(80), model: 'claude-sonnet-5-5', seconds: 95 }]);
    expect(buildPanelModel({ band: NONE_BAND, now, activity: act() }).subagentsDone).toEqual([]);
  });

  it('the band key ignores the finished subagents (the band shows no times)', () => {
    const now = 1_000_000;
    const a = buildPanelModel({ band: NONE_BAND, now, activity: act() });
    const b = buildPanelModel({ band: NONE_BAND, now, activity: act({ finished: [{ id: 'x', type: 'Explore', seconds: 3, at: now }] }) });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(bandKey(a)).toBe(bandKey(b));
  });

  it('the band key ignores the usage time and the forge timing, but not other changes', () => {
    const base = buildPanelModel({ band: NONE_BAND, now: 1_000_000, activity: act() });
    const forge = { task: 't', path: 'small', phase: 'implement', agent: null, validators: [], verdict: null, round: null, cap: null, brief: null, accepted: [], briefs: null };
    const usage = { rows: [], total: 1 } as unknown as NonNullable<PanelModel['usage']>;
    const mk = (secs: number, time: number, extra: object = {}) => ({
      ...base, ...extra,
      forge: { ...forge, timing: { taskSeconds: secs, done: false, stages: [{ name: 'implement', seconds: secs, live: true }] } },
      usage: { ...usage, time: { activeSeconds: time, activePartial: false, sinceStartSeconds: time, session: null } },
    }) as PanelModel;
    expect(bandKey(mk(10, 5))).toBe(bandKey(mk(99, 77)));
    expect(bandKey(mk(10, 5))).not.toBe(bandKey(mk(10, 5, { tool: { name: 'x' } })));
  });
});

describe('buildPanelModel decisions', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const base = { band: NONE_BAND, activity: act(), now };
  const doc = (o: Record<string, unknown> = {}) => JSON.stringify({
    ts: '2026-10-13T11:50:00Z', scope: 'orders', count: 2, autonomy: 'auto', last: [],
    lastMajor: { n: 7, point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', ts: '2026-10-13T11:50:00Z' }, ...o,
  });
  it('summarizes the automatic decisions of the last day', () => {
    expect(buildPanelModel({ ...base, forgeDecisions: doc() }).decisions).toEqual({ count: 2, autonomy: 'auto', lastMajor: 'diseño aprobado (v4)' });
    expect(buildPanelModel({ ...base, forgeDecisions: doc({ lastMajor: null }) }).decisions?.lastMajor).toBeNull();
  });
  it('is null when absent, stale, empty, corrupt or oversized', () => {
    expect(buildPanelModel(base).decisions).toBeNull();
    expect(buildPanelModel({ ...base, forgeDecisions: doc({ ts: '2026-10-12T11:00:00Z' }) }).decisions).toBeNull();
    expect(buildPanelModel({ ...base, forgeDecisions: doc({ count: 0 }) }).decisions).toBeNull();
    expect(buildPanelModel({ ...base, forgeDecisions: '{"ts":' }).decisions).toBeNull();
    expect(buildPanelModel({ ...base, forgeDecisions: doc() + ' '.repeat(16 * 1024) }).decisions).toBeNull();
  });
});
