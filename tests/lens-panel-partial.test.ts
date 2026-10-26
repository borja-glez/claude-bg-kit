// w8 M3: «/lens live» went unanswered in a session with subagents working. Nothing in the panel's model, its cards or the
// band built from them may throw on what such a session reads: several live agents and forge's files caught half written
// (an execution, a live signal, a task's public file, statuses, a job) or holding odd values.
import { describe, it, expect } from 'vitest';
import { buildPanelModel, bandKey, type Activity } from '../src/lens/model.js';
import { buildCards, cardAlt, type CardTexts } from '../src/lens/cards.js';
import { cardSvg } from '../src/lens/svg.js';
import { headline } from '../src/lens/view.js';
import { lensBand, bandSubject } from '../src/lens/lens-band.js';
import { statusText, spinnerText, modeLabels, surfaceEvents } from '../src/lens/surfaces.js';
import { newUsage, recordStep, labelLoop } from '../src/lens/usage.js';
import { linkSpawn, syncListed, type AgentLink } from '../src/lens/links.js';
import { noneBand } from '../src/mod/model.js';

// Any text the cards ask for: a function where they call one, a table where they index one, else its own name.
const CALLED = new Set([
  'hoursLeft', 'effortLevel', 'forgeCosts', 'forgeSaves', 'autoDecisions', 'acceptedInRound', 'waitingOn', 'needsN', 'subagentsN', 'photoTasks', 'moreRows',
  'toastAccepted', 'toastVerdict', 'toastRound', 'toastIntegrated', 'runFinished', 'runStopped',
]);
const T = new Proxy({}, {
  get: (_t, k) => {
    const key = String(k);
    if (key === 'stage' || key === 'needKind') return new Proxy({}, { get: (_x, s) => String(s) });
    return CALLED.has(key) ? (...a: unknown[]) => `${key}(${a.join(',')})` : key;
  },
}) as unknown as CardTexts;

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const SESSION = 'conv-1';
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const TASKS = ['T001', 'T002', 'T003'];
const status = (task: string, over: object = {}) => JSON.stringify({
  ts: at(-1), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [{ name: 'test', ok: true }], verdict: null, round: 1, cap: 3,
  taskStartedAt: at(-10), stageSince: at(-1), stages: { implement: 30 }, doneAt: null, lastAt: at(-1), session: SESSION, runId: 'r1', project: 'shop', ...over,
});
const FILES = {
  forgeStatuses: [status('T001'), status('T002', { phase: 'review' }), status('T003', { phase: 'validate' })],
  forgeExecution: JSON.stringify({
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
    coordinator: 'main', hookSession: SESSION, active: true, stopReason: null, stallReason: null, startedAt: at(-60), lastStepAt: at(-1), lastBlockStep: null, sleepUntil: null,
    tasks: Object.fromEntries(TASKS.map((t, i) => [t, { status: 'running', stage: i ? 'review' : 'implement', round: i, worktree: '/w', branch: `task/${t}`, executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: at(-20), stageSince: at(-3), updatedAt: at(-1), detail: null, title: `Task ${t}` }])),
  }),
  forgeExecTasks: Object.fromEntries(TASKS.slice(0, 2).map(t => [t, JSON.stringify({ task: t, runId: 'r1', stage: 'implement', status: 'running', mode: 'subagents', by: SESSION, since: at(-5), updatedAt: at(-1), leaseUntil: at(10), agent: 'forge-impl', round: 0 })])),
  forgeLive: { [SESSION]: JSON.stringify({ sessionId: SESSION, role: 'coordinator', ts: at(-1), runId: 'r1', task: null, event: 'SubagentStart', agents: [{ id: 'a1', type: 'forge:forge-impl', since: at(-5) }, { id: 'a2', type: 'forge:forge-review-correctness', since: at(-3) }] }) },
  forgeJobs: [JSON.stringify({ name: 'validate-T001-1-42', cmd: 'validate', task: 'T001-1', pid: 42, startedAt: at(-2), out: 'x.json', session: SESSION })],
  forgeDecisions: JSON.stringify({ ts: at(-1), scope: 'T001', count: 2, autonomy: 'auto', last: [], lastMajor: { n: 4, point: 'design-approve', what: 'x', chosen: 'approve', ts: at(-1) } }),
};

// Four agents: three implementers on the run's tasks, one Explore under the first, and a workflow's agent.
function links(): AgentLink[] {
  const known = new Set(TASKS);
  let l: AgentLink[] = [];
  TASKS.forEach((t, i) => { l = linkSpawn(l, { id: `a${i + 1}`, type: 'forge:forge-impl', description: `implement ${t}`, prompt: `forge-task: ${t}-1 @shop`, parentId: null, workflow: null, now: NOW - 60_000 }, known); });
  l = linkSpawn(l, { id: 'a4', type: 'Explore', description: 'look', prompt: 'look around', parentId: 'a1', workflow: null, now: NOW - 30_000 }, known);
  l = linkSpawn(l, { id: 'w1', type: 'general-purpose', description: 'wf', prompt: 'x', parentId: null, workflow: { runId: 'wf_1', index: 1 }, now: NOW - 30_000 }, known);
  return syncListed(l, ['a1', 'a2', 'a3', 'a4'].map(id => ({ id, type: 'forge:forge-impl', description: 'd', status: 'running', parentId: id === 'a4' ? 'a1' : null })), NOW, known);
}

function build(files: Record<string, unknown>) {
  const usage = newUsage(NOW - 3600_000);
  recordStep(usage, { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 } });
  for (const id of ['a1', 'a2', 'a3', 'a4']) {
    labelLoop(usage, id, 'forge:forge-impl', 'd');
    recordStep(usage, { agentId: id, model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  }
  const activity: Activity = {
    tool: { name: 'Bash', since: NOW - 1000 }, turnSince: NOW - 5000, todos: undefined, ccTasks: [],
    subagents: ['a1', 'a2', 'a3', 'a4'].map(id => ({ id, type: 'forge:forge-impl', since: NOW - 60_000, status: 'running' })),
  };
  const m = buildPanelModel({
    band: noneBand(), ...files, activity, now: NOW, usage: { session: usage, run: null, officialUsd: 1, officialOwnUsd: 1 },
    sessionId: SESSION, links: links(), ownTasks: ['T001-1'], wakeAt: null, focusAgent: 'a2',
  } as Parameters<typeof buildPanelModel>[0]);
  bandKey(m);
  for (const card of buildCards(m, T, NOW)) { cardAlt(card); cardSvg(card, 400); }
  headline(m);
  lensBand(m, T as never, 4);
  bandSubject(m);
  statusText(m, T as never, 'owner');
  spinnerText(m, T as never);
  modeLabels(m);
  surfaceEvents(m, m, 'owner', T as never);
  return m;
}

// Each forge file of FILES, with a way to put another text in its place.
function eachFile(): { label: string; text: string; put: (s: string) => Record<string, unknown> }[] {
  return Object.entries(FILES).flatMap(([key, value]) => {
    if (typeof value === 'string') return [{ label: key, text: value, put: (s: string) => ({ ...FILES, [key]: s }) }];
    if (Array.isArray(value)) return value.map((v, i) => ({ label: `${key}[${i}]`, text: v, put: (s: string) => ({ ...FILES, [key]: value.map((x, j) => (j === i ? s : x)) }) }));
    return Object.entries(value).map(([k, v]) => ({ label: `${key}.${k}`, text: v, put: (s: string) => ({ ...FILES, [key]: { ...value, [k]: s } }) }));
  });
}

describe('the panel with several agents and forge files half written or odd (w8 M3)', () => {
  it('builds, with the run, its tasks and the agents', () => {
    const m = build(FILES);
    expect(m.execution?.slots.map(s => s.task)).toEqual(TASKS);
    expect(m.activities.filter(a => a.kind === 'forge').map(a => a.task).sort()).toEqual(TASKS);
    expect(m.subagents).toHaveLength(4);
  });

  it('never throws on a file cut at any length', () => {
    const failures: string[] = [];
    for (const f of eachFile()) {
      for (let n = 0; n < f.text.length; n++) {
        try { build(f.put(f.text.slice(0, n))); } catch (err) { failures.push(`${f.label} cut at ${n}: ${(err as Error).message}`); }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('never throws on a field of any depth holding an odd value', () => {
    const ODD = [null, -1, '', [], {}, 'x', 1e20];
    const failures: string[] = [];
    for (const f of eachFile()) {
      const paths: string[][] = [];
      const walk = (o: unknown, p: string[]) => {
        if (p.length) paths.push(p);
        if (o && typeof o === 'object') for (const k of Object.keys(o)) walk((o as Record<string, unknown>)[k], [...p, k]);
      };
      walk(JSON.parse(f.text), []);
      for (const p of paths) {
        for (const odd of ODD) {
          const doc = JSON.parse(f.text);
          let o = doc;
          for (const k of p.slice(0, -1)) o = o[k];
          o[p.at(-1)!] = odd;
          try { build(f.put(JSON.stringify(doc))); } catch (err) { failures.push(`${f.label}.${p.join('.')} = ${JSON.stringify(odd)}: ${(err as Error).message}`); }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
