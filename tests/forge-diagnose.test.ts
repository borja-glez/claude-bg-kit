import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { KIND_ORDER, sortTimeline, type Entry, type Finding, type StepRow } from '../src/forge/diagnose-rules.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { DIAG_NOW, DIAG_SUBAGENT, writeDiagnoseFixture } from './fixtures/diagnose.js';
import { walk } from './helpers/files.js';
import { TX_AT as at, jsonl, toolResult, toolUse, userText } from './helpers/transcript.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const put = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
const steps = (rows: StepRow[]) => Object.fromEntries(rows.map(r => [`${r.step}${r.brief === null ? '' : `#${r.brief}`}`, r.state]));
const seen = (f: Finding[]) => f.map(x => [x.kind, x.step ?? null, x.brief ?? null, x.ts, x.at]);

describe('forge diagnose (A6)', () => {
  let root: string, cfg: string, t: string, sub: string;
  beforeAll(() => {
    root = tmp('diag-');
    cfg = tmp('diag-cfg-');
    ({ transcript: t, subagent: sub } = writeDiagnoseFixture(root, cfg));
  });
  const diag = (args: string[], over: { now?: string; cfg?: string } = {}) =>
    run(['diagnose', ...args], { cwd: root, now: () => new Date(over.now ?? DIAG_NOW), env: { CLAUDE_CONFIG_DIR: over.cfg ?? cfg } });
  const OUT = '.forge/work/fix-login/review-prep-2.json';

  it('gives the known diagnosis of the fixture: its findings in time order, each cited', () => {
    const r = diag(['--task', 'fix-login']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(Object.keys(out)).toEqual(['scope', 'now', 'window', 'findings', 'waiting', 'tasks', 'usage', 'coverage', 'sources', 'timeline']);
    expect(out.scope).toEqual({ task: 'fix-login', project: null });
    expect(out.window).toEqual({ from: at(0.5), to: at(75) });
    expect(seen(out.findings)).toEqual([
      ['missing-step', 'begin', null, at(0.5), [`${t}:2`, '.forge/ledger.jsonl:1']],
      ['compact-drift', null, null, at(6), [`${t}:7`, `${t}:4`, `${t}:8`]],
      ['out-of-order', 'reviewers', 1, at(15), [`${t}:12`, `${t}:13`, '.forge/ledger.jsonl:4']],
      ['failed', 'review-close', 1, at(29), [`${t}:16`]],
      ['failed', 'review-prep', 2, at(55), [`${t}:24`, OUT]],
      ['degraded', 'reviewers', 2, at(60), [`${t}:26`, `${t}:24`, OUT]],
      ['degraded', 'review-close', 2, at(69), [`${t}:28`, '.forge/ledger.jsonl:7', `${t}:26`]],
    ]);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({ task: 'fix-login', project: null, path: 'medium' });
    expect(steps(out.tasks[0].steps)).toEqual({ begin: 'missing', triage: 'ok', 'prep#1': 'ok', 'impl#1': 'ok', 'review-prep#1': 'ok', 'reviewers#1': 'out-of-order',
      'review-close#1': 'ok', 'prep#2': 'ok', 'impl#2': 'ok', 'review-prep#2': 'failed', 'reviewers#2': 'degraded', 'review-close#2': 'degraded', done: 'pending' });
  });
  it('waiting, usage once per message.id with the subagents, coverage, sources and a sorted, cited timeline of the scope only', () => {
    const out = JSON.parse(diag(['--task', 'fix-login']).stdout);
    expect(out.waiting).toEqual([{ at: `${t}:30`, ts: at(75), tool: 'Agent', forge: null, minutes: 45 }]);
    expect(out.usage).toEqual({
      transcripts: [
        { file: t, agentId: null, usageLines: 3, messages: 2, tokens: { input: 11, output: 7, cacheRead: 100, cacheWrite: 20, cacheWrite1h: 20 } },
        { file: sub, agentId: 'a1', usageLines: 1, messages: 1, tokens: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } },
      ],
      total: { input: 14, output: 11, cacheRead: 100, cacheWrite: 20, cacheWrite1h: 20 },
    });
    // The three agents without a transcript of their own, and the review-close whose reviewers' end is unknown.
    expect(out.coverage).toHaveLength(4);
    for (const id of ['a2', 'a3', 'a4']) expect(out.coverage.filter((c: string) => new RegExp(`\\b${id}\\b`).test(c)), id).toHaveLength(1);
    expect(out.sources.map((s: { kind: string }) => s.kind)).toEqual(expect.arrayContaining(['ledger', 'out', 'transcript', 'subagent', 'meta']));
    expect(out.sources.find((s: { file: string }) => s.file === t)).toMatchObject({ kind: 'transcript', bytes: statSync(t).size, lines: 30, truncated: false });
    expect(out.timeline).toHaveLength(23);
    expect(out.timeline.every((e: Entry) => e.ts && e.at)).toBe(true);
    expect(out.timeline.some((e: Entry) => e.task === 'other' || e.at === '.forge/ledger.jsonl:2')).toBe(false);
    expect(out.timeline.map((e: Entry) => e.at)).toEqual(sortTimeline(out.timeline).map(e => e.at));
    expect(out.timeline.filter((e: Entry) => e.source === 'subagent').map((e: Entry) => e.at)).toEqual([`${sub}:2`]);
  });
  it('a call waits from 10 minutes on: at 5 it is not listed, at 10 it is (Review Focus 1)', () => {
    expect(JSON.parse(diag(['--task', 'fix-login'], { now: at(80) }).stdout).waiting).toEqual([]);
    expect(JSON.parse(diag(['--task', 'fix-login'], { now: at(85) }).stdout).waiting).toEqual([{ at: `${t}:30`, ts: at(75), tool: 'Agent', forge: null, minutes: 10 }]);
  });
  it('without a transcript: only what the ledger and the files show, the steps only a transcript witnesses unverified, and the session in coverage (Review Focus 5)', () => {
    const out = JSON.parse(diag(['--task', 'fix-login'], { cfg: tmp('diag-none-') }).stdout);
    expect(seen(out.findings)).toEqual([['failed', 'review-prep', 2, at(56), [OUT]]]);
    expect(steps(out.tasks[0].steps)).toMatchObject({ begin: 'unverified', 'impl#1': 'unverified', 'reviewers#1': 'unverified', 'review-prep#2': 'failed', 'review-close#2': 'ok' });
    expect(out.coverage.filter((c: string) => /\bs1\b/.test(c))).toHaveLength(1);
    expect(out.usage.transcripts).toEqual([]);
  });
  it('--transcript reads that file instead of looking the session up, and follows its subagents beside it', () => {
    const out = JSON.parse(diag(['--task', 'fix-login', '--transcript', t], { cfg: tmp('diag-none-') }).stdout);
    expect(out.findings.map((f: Finding) => f.kind)).toEqual(['missing-step', 'compact-drift', 'out-of-order', 'failed', 'failed', 'degraded', 'degraded']);
    expect(out.usage.transcripts.map((u: { agentId: string | null }) => u.agentId)).toEqual([null, 'a1']);
  });
  it('follows subagents SPAWN_DEPTH_MAX levels deep: a chain of 4 nested Agent calls reads three and notes the fourth as not followed', () => {
    const r = tmp('diag-deep-');
    const c = tmp('diag-deep-cfg-');
    const { transcript, subagent } = writeDiagnoseFixture(r, c);
    const dir = path.dirname(subagent);
    const spawn = (n: number, child: string) => [
      toolUse(at(13), `n${n}`, 'Agent', { subagent_type: 'forge:forge-impl', description: `Nested ${n}`, prompt: 'forge-task: fix-login-1\nGo.' }),
      toolResult(at(13), `n${n}`, { text: 'Async agent launched successfully.', toolUseResult: { isAsync: true, status: 'async_launched', agentId: child } }),
    ];
    const lines = (child: string | null, n: number) => [userText(at(8), 'forge-task: fix-login-1\nGo.'), ...(child ? spawn(n, child) : [])];
    // main -> a1 -> b1 -> c1 -> d1 (levels 1 to 4)
    put(subagent, jsonl([...DIAG_SUBAGENT, ...spawn(1, 'b1')]));
    put(path.join(dir, 'agent-b1.jsonl'), jsonl(lines('c1', 2)));
    put(path.join(dir, 'agent-c1.jsonl'), jsonl(lines('d1', 3)));
    put(path.join(dir, 'agent-d1.jsonl'), jsonl(lines(null, 4)));
    const out = JSON.parse(run(['diagnose', '--task', 'fix-login', '--transcript', transcript], { cwd: r, now: () => new Date(DIAG_NOW), env: { CLAUDE_CONFIG_DIR: c } }).stdout);
    expect(out.usage.transcripts.map((u: { agentId: string | null }) => u.agentId)).toEqual([null, 'a1', 'b1', 'c1']);
    expect(out.coverage).toContain('agents launched by agent c1 are not followed: more than 3 levels deep');
    expect(out.coverage.filter((x: string) => /not followed/.test(x))).toHaveLength(1);
  });
  it('exits 2 without one scope, with both, with an unsafe id, for a task or a run forge has no record of, and with a --transcript that is not a .jsonl file', () => {
    put(path.join(root, 'notes.txt'), 'x');
    for (const args of [[], ['--task', 'fix-login', '--execution', 'r1'], ['--task', '../x'], ['--task', 'nothing'], ['--execution', 'nope'],
      ['--task', 'fix-login', '--transcript', 'notes.txt']]) {
      const r = diag(args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stdout, args.join(' ')).toBe('');
    }
  });
  it('--execution: the tasks of that run, on the large path, from execution.json and the events that carry its runId', () => {
    const r = tmp('diag-exec-');
    const R = 'shop-20261024T100000000Z';
    put(path.join(r, '.forge', 'ledger.jsonl'), [
      { ts: at(1), kind: 'triage', task: 'T001', project: 'shop', path: 'medium', runId: R, session: 's9' },
      { ts: at(2), kind: 'phase', task: 'T001-1', project: 'shop', phase: 'implement', brief: 1, base: 'abc', runId: R, session: 's9' },
      { ts: at(3), kind: 'triage', task: 'T002', project: 'shop', path: 'small' },
    ].map(e => JSON.stringify(e)).join('\n') + '\n');
    const exec: ExecutionState = {
      runId: R, kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main',
      hookSession: 'h9', active: true, stopReason: null, stallReason: null, startedAt: at(0), lastStepAt: null, lastBlockStep: null, sleepUntil: null,
      closedAt: null, closedBy: null,
      tasks: { T001: { status: 'running', stage: 'implement', round: 1, worktree: path.join(r, '.claude', 'worktrees', 'task-T001'), branch: 'task/T001',
        executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: at(1), stageSince: at(1), updatedAt: at(5), detail: null } },
    };
    put(path.join(r, '.forge', 'execution.json'), JSON.stringify(exec));
    const res = run(['diagnose', '--execution', R], { cwd: r, now: () => new Date(DIAG_NOW), env: { CLAUDE_CONFIG_DIR: tmp('diag-exec-cfg-') } });
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.scope).toEqual({ execution: R });
    expect(out.tasks.map((x: { task: string; project: string | null; path: string }) => [x.task, x.project, x.path])).toEqual([['T001', 'shop', 'large']]);
    expect(out.timeline.map((e: Entry) => e.at)).toEqual(['.forge/execution.json', '.forge/ledger.jsonl:1', '.forge/ledger.jsonl:2', '.forge/execution.json']);
    for (const s of ['s9', 'h9']) expect(out.coverage.filter((c: string) => new RegExp(`\\b${s}\\b`).test(c)), s).toHaveLength(1);
  });
  it('--task T001 sees only the events of its project: those of --project, else of the project the ledger gives T001 now (D-08, Review Focus 3)', () => {
    const r = tmp('diag-d08-');
    put(path.join(r, '.forge', 'ledger.jsonl'), [
      { ts: at(1), kind: 'triage', task: 'T001', project: 'shop', path: 'medium' },
      { ts: at(2), kind: 'phase', task: 'T001-1', project: 'shop', phase: 'implement', brief: 1, base: 'abc' },
      { ts: at(3), kind: 'triage', task: 'T001', project: 'garden', path: 'small' },
      { ts: at(4), kind: 'verdict', task: 'T001-1', action: 'accept' },
      { ts: at(5), kind: 'triage', task: 'T001', path: 'trivial' },
    ].map(e => JSON.stringify(e)).join('\n') + '\n');
    const of = (...more: string[]) => {
      const res = run(['diagnose', '--task', 'T001', ...more], { cwd: r, now: () => new Date(DIAG_NOW), env: { CLAUDE_CONFIG_DIR: tmp('diag-d08-cfg-') } });
      expect(res.code, more.join(' ')).toBe(0);
      const out = JSON.parse(res.stdout);
      return [out.scope.project, out.timeline.map((e: Entry) => e.at)];
    };
    expect(of('--project', 'shop')).toEqual(['shop', ['.forge/ledger.jsonl:1', '.forge/ledger.jsonl:2']]);
    // The verdict without a project is garden's: the last triage of T001 before it was garden's.
    expect(of('--project', 'garden')).toEqual(['garden', ['.forge/ledger.jsonl:3', '.forge/ledger.jsonl:4']]);
    // Without --project, resolveProject: the last triage of T001 is a loose one.
    expect(of()).toEqual([null, ['.forge/ledger.jsonl:5']]);
  });
  it('reads only: nothing under the checkout or the config folder changes or appears, also with a dead job, an old swarm.json and no .forge/.gitignore (Review Focus 4)', () => {
    const r = tmp('diag-ro-');
    const c = tmp('diag-ro-cfg-');
    const { transcript } = writeDiagnoseFixture(r, c);
    put(path.join(r, '.forge', 'jobs', 'prep-fix-login-1-999999.json'), JSON.stringify({ name: 'prep-fix-login-1-999999', cmd: 'prep', task: 'fix-login-1', pid: 999999,
      startedAt: at(1), out: '.forge/work/fix-login/prep-1.json', session: 's1' }));
    put(path.join(r, '.forge', 'swarm.json'), '{}\n');
    const snap = () => [r, c].flatMap(d => walk(d).map(f => `${path.relative(d, f)}|${statSync(f).size}|${statSync(f).mtimeMs}`)).sort();
    const before = snap();
    for (const args of [['--task', 'fix-login'], ['--execution', 'nope'], ['--task', 'fix-login', '--transcript', transcript]]) {
      run(['diagnose', ...args], { cwd: r, now: () => new Date(DIAG_NOW), env: { CLAUDE_CONFIG_DIR: c } });
    }
    expect(snap()).toEqual(before);
  });
  it('the reader, the diagnosis and the command name no writer', () => {
    const WRITERS = /\b(?:writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|mkdirSync|utimesSync|copyFileSync|writeJsonAtomic|forgeDir|appendEvent|appendPhase|readExecution|liveJobs|executionHolding|updateExecution|withJob)\b/;
    for (const f of ['src/forge/transcript-file.ts', 'src/forge/diagnose.ts', 'src/forge/diagnose-transcript.ts', 'src/forge/diagnose-sources.ts',
      'src/forge/diagnose-rules.ts', 'src/forge/cli/commands/diagnose.ts']) {
      expect(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), f).not.toMatch(WRITERS);
    }
  });
});

describe('the forge:diagnose skill and the READMEs (A6)', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('the skill has its frontmatter, stays short, and names the two scopes, every kind of finding and the parts of the output', () => {
    const md = read('plugins/forge/skills/diagnose/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: diagnose\r?\ndescription: .+\r?\n---\r?\n/);
    expect(Buffer.byteLength(md)).toBeLessThan(6000);
    for (const w of ['`FORGE` = `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`', 'FORGE diagnose --task <id>', 'FORGE diagnose --execution <runId>', '--transcript <file>',
      ...KIND_ORDER.map(k => `\`${k}\``), '`waiting`', '`tasks`', '`usage`', '`coverage`', '`sources`', '`timeline`']) expect(md, w).toContain(w);
  });
  it('the forge READMEs list /forge:diagnose and the diagnose command, in English and in Spanish', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      expect(md, f).toContain('| `/forge:diagnose <task> \\| --execution <runId>` |');
      expect(md, f).toContain('- `diagnose (--task id [--project p] | --execution runId) [--transcript f]` - ');
    }
  });
});
